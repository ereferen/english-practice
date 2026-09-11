import { useEffect, useRef, useState, useCallback } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import {
  type ChatMessage,
  SYSTEM_PROMPT,
  createUserMessage,
  createAssistantMessage,
} from "../domain/conversation";
import {
  type LlmProviderConfig,
  providersFromSettings,
  requestLlmChat,
} from "../domain/llm";
import {
  type ExtractedContent,
  CONVERSATION_DECK_ID,
  buildConversationDeck,
  dedupeExtracted,
  extractContentWithLlm,
  mergeIntoConversationDeck,
} from "../domain/conversationExtract";
import { deckSchema } from "../content/schema";
import { speak } from "../domain/speech";
import { useSpeechSupport } from "../domain/useSpeechSupport";
import TalkSprite from "./TalkSprite";
import styles from "./ConversationScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

const TYPE_LABELS: Record<ExtractedContent["type"], string> = {
  vocabulary: "語彙",
  expression: "表現",
  "grammar-correction": "文法訂正",
};

export default function ConversationScreen({
  state,
  dispatch,
  storage,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<LlmProviderConfig[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  // Issue #73: last failed user text + flag so the error card can offer 再送/設定へ
  const [failedSendText, setFailedSendText] = useState<string | null>(null);
  // Issue #47: which message is currently being read aloud (Web Speech)
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Issue #83: TTS availability (no-voices env gets explicit feedback)
  const speechAvail = useSpeechSupport();
  // Issue #19: conversation content extraction (LLM提案 → ユーザー承認でデッキ保存)
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedContent[] | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const extractControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Load config on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const settings = await storage.loadSettings();
      if (!mounted) return;
      const chain = providersFromSettings(settings);
      if (
        chain.length === 0 ||
        chain[0].apiEndpoint === "http://localhost:11434/v1"
      ) {
        setConfigError(
          "⚠ APIエンドポイントが未設定です。設定画面からLLMのエンドポイントを指定してください。",
        );
      } else {
        setConfigError(null);
      }
      setProviders(chain);
    })();
    return () => {
      mounted = false;
    };
  }, [storage]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Cancel on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      extractControllerRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || providers.length === 0) return;

      const userMsg = createUserMessage(text);
      const updated = [...messages, userMsg];
      setMessages(updated);
      setInput("");
      setFailedSendText(null);
      setLoading(true);
      setStreamingContent("");

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const result = await requestLlmChat({
          providers,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...updated.map((m) => ({ role: m.role, content: m.content })),
          ],
          onChunk: (chunk) => {
            setStreamingContent((prev) => prev + chunk);
          },
          signal: controller.signal,
        });
        const assistantMsg = createAssistantMessage(result.content);
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");

        // Auto-speak the response (issue #47: track it for the gold badge)
        // Issue #83: only show the badge if an utterance actually queued.
        if (speak(result.content, () => setSpeakingId(null))) {
          setSpeakingId(assistantMsg.id);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        const rawMsg = e instanceof Error ? e.message : String(e);
        // Issue #73: "Failed to fetch" is developer-speak; tell the user
        // what it plausibly means and what to do next.
        const errMsg = rawMsg.includes("Failed to fetch")
          ? `${rawMsg}\nエンドポイントに到達できませんでした。URL・CORS設定・ネットワークを確認するか、[設定を確認] からやり直してください。`
          : rawMsg;
        setStreamingContent("");
        // Issue #73: remember the failed text so 再送 works without retyping.
        setFailedSendText(text);
        setMessages((prev) => [
          ...prev,
          createAssistantMessage(`⚠ エラー: ${errMsg}`),
        ]);
      } finally {
        setLoading(false);
        controllerRef.current = null;
        inputRef.current?.focus();
      }
    },
    [input, providers, messages],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (e.key === "Escape") {
      setInput("");
    }
  };

  const handleStop = () => {
    controllerRef.current?.abort();
    setLoading(false);
    setStreamingContent("");
  };

  const handleClear = () => {
    if (confirm("会話履歴を削除しますか？")) {
      setMessages([]);
      setStreamingContent("");
      setExtracted(null);
      setExtractError(null);
      setSavedMessage(null);
    }
  };

  // --- Issue #19: 会話ログから学習コンテンツを抽出（提案→承認でデッキ保存） ---

  const handleExtract = useCallback(async () => {
    if (providers.length === 0 || extracting) return;
    setExtracting(true);
    setExtractError(null);
    setSavedMessage(null);
    const controller = new AbortController();
    extractControllerRef.current = controller;
    try {
      const items = await extractContentWithLlm({
        providers,
        messages,
        signal: controller.signal,
      });
      // 既存デッキ（bundled + 会話抽出）の全termと重複チェック
      const existingTerms = state.decks.flatMap((d) =>
        d.lessons.flatMap((l) => l.words.map((w) => w.term)),
      );
      const fresh = dedupeExtracted(items, existingTerms);
      if (fresh.length === 0) {
        setExtracted(null);
        setExtractError(
          items.length > 0
            ? "見つけた語彙はすべて既存デッキにありました。"
            : "この会話から抽出できる項目はありませんでした。",
        );
      } else {
        setExtracted(fresh);
        setChecked(new Set(fresh.map((_, i) => i)));
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
      extractControllerRef.current = null;
    }
  }, [providers, messages, extracting, state.decks]);

  const toggleItem = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleSaveExtracted = useCallback(async () => {
    if (!extracted) return;
    const approved = extracted.filter((_, i) => checked.has(i));
    if (approved.length === 0) return;
    try {
      const now = new Date().toISOString();
      const existingRecord = state.decks.find(
        (d) => d.deckId === CONVERSATION_DECK_ID,
      );
      let deck;
      if (existingRecord) {
        const merged = mergeIntoConversationDeck(existingRecord, approved, {
          now,
        });
        deck = merged.deck;
      } else {
        deck = buildConversationDeck(approved, { now });
      }
      // 保存前にスキーマ再検証（LLM由来データを決して素で入れない）
      const parsed = deckSchema.safeParse(deck);
      if (!parsed.success) {
        setExtractError(
          `デッキ検証に失敗しました: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .slice(0, 2)
            .join(" / ")}`,
        );
        return;
      }
      const updatedDecks = existingRecord
        ? state.decks.map((d) =>
            d.deckId === parsed.data.deckId ? parsed.data : d,
          )
        : [...state.decks, parsed.data];
      await storage.saveUserDeck({
        deckId: parsed.data.deckId,
        deck: parsed.data,
        sourceTurns: messages.length,
        createdAt: now,
        updatedAt: now,
      });
      dispatch({ type: "setDecks", decks: updatedDecks });
      setSavedMessage(
        `✓ ${approved.length} 件を「${parsed.data.title}」に追加しました。`,
      );
      setExtracted(null);
      setExtractError(null);
    } catch (e: unknown) {
      setExtractError(e instanceof Error ? e.message : String(e));
    }
  }, [extracted, checked, state.decks, messages, storage, dispatch]);

  const handleSpeak = (id: string, text: string) => {
    // Issue #47: gold rune-caption indicator while the utterance plays
    // Issue #83: give feedback when the env has no TTS voices
    if (speechAvail !== "ready") {
      setMessages((prev) => [
        ...prev,
        createAssistantMessage(
          "⚠ このブラウザは音声未対応です（TTSボイスがありません）",
        ),
      ]);
      return;
    }
    setSpeakingId(id);
    speak(text, () => setSpeakingId(null));
  };

  return (
    <div className={`container ${styles.root}`}>
      {/* Header */}
      <div className={`nav-header ${styles.navHeader}`}>
        <h2 className={styles.title}>英会話</h2>
        <div className={styles.headerActions}>
          <button
            className={`ghost ${styles.clearButton}`}
            onClick={handleClear}
            disabled={messages.length === 0}
          >
            クリア
          </button>
          <button
            className="ghost"
            onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          >
            戻る
          </button>
        </div>
      </div>

      {/* Config warning (issue #73: direct link to settings) */}
      {configError && (
        <div className={`card ${styles.configWarning}`}>
          <span>{configError}</span>
          <button
            className={`ghost ${styles.settingsLink}`}
            onClick={() =>
              dispatch({ type: "go", screen: { name: "settings" } })
            }
          >
            設定を開く
          </button>
        </div>
      )}

      {/* Messages */}
      <div className={styles.messagesArea}>
        {messages.length === 0 && !streamingContent && (
          <div className={`card ${styles.emptyState}`}>
            <p>英語でメッセージを送って会話を始めましょう！</p>
            <p className={styles.emptyHint}>
              例: "Hi! How are you?", "What did you do today?"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              "chat-bubble-wrap" +
              (msg.role === "user" ? " user" : "") +
              (speakingId === msg.id ? ` ${styles.speakingRow}` : "")
            }
          >
            {/* Issue #85: NPC mouth flaps while the bubble is read aloud */}
            {msg.role === "assistant" && speakingId === msg.id && (
              <TalkSprite />
            )}
            <div className={styles.bubbleColumn}>
              <div
                className={`card ${styles.bubble} ${
                  msg.role === "assistant" ? styles.bubbleNpc : ""
                } ${msg.role === "user" ? styles.bubbleUser : ""} ${
                  speakingId === msg.id ? styles.speaking : ""
                }`}
              >
                {msg.content}
              </div>
              {msg.role === "assistant" && (
                <button
                  className={`ghost ${styles.speakButton}`}
                  onClick={() => handleSpeak(msg.id, msg.content)}
                  title={
                    speechAvail === "ready"
                      ? "音声再生"
                      : "このブラウザは音声未対応（TTSボイス0個）"
                  }
                >
                  {speechAvail === "ready" ? "🔊" : "🔇"} 読み上げ
                </button>
              )}
              {msg.role === "assistant" && speakingId === msg.id && (
                <span className={styles.speakingBadge} aria-live="polite">
                  ♪ 読み上げ中
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {streamingContent && (
          <div className="chat-bubble-wrap">
            <div className={`card ${styles.bubble}`}>
              {streamingContent}
              <span className={`cursor-blink ${styles.cursorBlink}`}>▍</span>
            </div>
          </div>
        )}

        {/* Loading dots when no streaming content yet */}
        {loading && !streamingContent && (
          <div className="chat-bubble-wrap">
            <div className={`card ${styles.loadingBubble}`}>
              <span className="loading-dots">考え中...</span>
            </div>
          </div>
        )}

        {/* Issue #73: after a send failure, offer 再送 without retyping */}
        {failedSendText && !loading && (
          <div className={styles.retryBar}>
            <button
              className={`primary ${styles.retryButton}`}
              onClick={() => sendMessage(failedSendText)}
            >
              再送
            </button>
            <span className={styles.retryHint}>
              「{failedSendText}」を再送信
            </span>
            <button
              className={`ghost ${styles.retrySettingsButton}`}
              onClick={() =>
                dispatch({ type: "go", screen: { name: "settings" } })
              }
            >
              設定を確認
            </button>
          </div>
        )}

        {/* Issue #19: 会話終了後に抽出 → 承認した項目だけユーザーデッキへ */}
        {!loading && messages.filter((m) => m.role === "user").length >= 2 && (
          <div className={styles.extractBar}>
            <button
              className={`ghost ${styles.extractButton}`}
              onClick={handleExtract}
              disabled={extracting || providers.length === 0}
            >
              {extracting ? "抽出中..." : "🔍 この会話から学ぶ"}
            </button>
            {savedMessage && (
              <span className={styles.savedHint}>{savedMessage}</span>
            )}
          </div>
        )}

        {extractError && (
          <div className={`card ${styles.configWarning}`}>
            <span>⚠ {extractError}</span>
          </div>
        )}

        {extracted && !extracting && (
          <div className={`card ${styles.extractPanel}`} aria-live="polite">
            <h3 className={styles.extractTitle}>
              {extracted.length} 件の学習項目を見つけました —
              追加する項目にチェックしてください
            </h3>
            <ul className={styles.extractList}>
              {extracted.map((item, i) => (
                <li key={`${item.term}-${i}`} className={styles.extractItem}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked.has(i)}
                      onChange={() => toggleItem(i)}
                    />
                    <span className={styles.extractType}>
                      {TYPE_LABELS[item.type]}
                    </span>
                    <span className={styles.extractTerm}>{item.term}</span>
                    <span className={styles.extractMeaning}>
                      {item.meaning}
                    </span>
                  </label>
                  {item.example && (
                    <p className={styles.extractExample}>
                      {item.type === "grammar-correction" &&
                      item.correctedVersion
                        ? `✓ ${item.correctedVersion}`
                        : item.example}
                    </p>
                  )}
                  {item.explanation && (
                    <p className={styles.extractNote}>{item.explanation}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className={styles.extractActions}>
              <button
                className={`primary ${styles.saveAllButton}`}
                onClick={handleSaveExtracted}
                disabled={checked.size === 0}
              >
                チェックした {checked.size} 件をデッキに追加
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setExtracted(null);
                  setExtractError(null);
                }}
              >
                却下
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={styles.inputBar}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="英語でメッセージを入力..."
          disabled={loading || providers.length === 0}
          className={styles.chatInput}
        />
        {loading ? (
          <button className={styles.sendButton} onClick={handleStop}>
            停止
          </button>
        ) : (
          <button
            className={`primary ${styles.sendButton}`}
            onClick={() => sendMessage()}
            disabled={!input.trim() || providers.length === 0}
          >
            送信
          </button>
        )}
      </div>
    </div>
  );
}
