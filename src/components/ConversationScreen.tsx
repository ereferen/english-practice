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
import { speak } from "../domain/speech";
import styles from "./ConversationScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function ConversationScreen({ dispatch, storage }: Props) {
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
        setSpeakingId(assistantMsg.id);
        speak(result.content, () => setSpeakingId(null));
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
    }
  };

  const handleSpeak = (id: string, text: string) => {
    // Issue #47: gold rune-caption indicator while the utterance plays
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
              "chat-bubble-wrap" + (msg.role === "user" ? " user" : "")
            }
          >
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
                title="音声再生"
              >
                🔊 読み上げ
              </button>
            )}
            {msg.role === "assistant" && speakingId === msg.id && (
              <span className={styles.speakingBadge} aria-live="polite">
                ♪ 読み上げ中
              </span>
            )}
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
