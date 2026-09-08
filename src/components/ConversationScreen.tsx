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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || providers.length === 0) return;

    const userMsg = createUserMessage(text);
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
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

      // Auto-speak the response
      speak(result.content);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      const errMsg = e instanceof Error ? e.message : String(e);
      setStreamingContent("");
      setMessages((prev) => [
        ...prev,
        createAssistantMessage(`⚠ エラー: ${errMsg}`),
      ]);
    } finally {
      setLoading(false);
      controllerRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, providers, messages]);

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

  const handleSpeak = (text: string) => {
    speak(text);
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

      {/* Config warning */}
      {configError && (
        <div className={`card ${styles.configWarning}`}>{configError}</div>
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
                msg.role === "user" ? styles.bubbleUser : ""
              }`}
            >
              {msg.content}
            </div>
            {msg.role === "assistant" && (
              <button
                className={`ghost ${styles.speakButton}`}
                onClick={() => handleSpeak(msg.content)}
                title="音声再生"
              >
                🔊 読み上げ
              </button>
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
          <button
            className={`danger ${styles.sendButton}`}
            onClick={handleStop}
          >
            停止
          </button>
        ) : (
          <button
            className={`primary ${styles.sendButton}`}
            onClick={sendMessage}
            disabled={!input.trim() || providers.length === 0}
          >
            送信
          </button>
        )}
      </div>
    </div>
  );
}
