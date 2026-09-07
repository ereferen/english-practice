import { useEffect, useRef, useState, useCallback } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import {
  type ChatMessage,
  type ConversationConfig,
  createUserMessage,
  createAssistantMessage,
  sendChatMessageStream,
} from "../domain/conversation";
import { speak } from "../domain/speech";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function ConversationScreen({
  dispatch,
  storage,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ConversationConfig | null>(null);
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
      const cfg: ConversationConfig = {
        apiEndpoint: settings.llmApiEndpoint,
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
      };
      if (!cfg.apiEndpoint || cfg.apiEndpoint === "http://localhost:11434/v1") {
        setConfigError(
          "⚠ APIエンドポイントが未設定です。設定画面からLLMのエンドポイントを指定してください。",
        );
      } else {
        setConfigError(null);
      }
      setConfig(cfg);
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
    if (!text || !config) return;

    const userMsg = createUserMessage(text);
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);
    setStreamingContent("");

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const fullContent = await sendChatMessageStream(
        updated,
        config,
        (chunk) => {
          setStreamingContent((prev) => prev + chunk);
        },
        controller.signal,
      );
      const assistantMsg = createAssistantMessage(fullContent);
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingContent("");

      // Auto-speak the response
      speak(fullContent);
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
  }, [input, config, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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
    <div className="container" style={{ display: "flex", flexDirection: "column", height: "100vh", padding: "0.5rem" }}>
      {/* Header */}
      <div className="nav-header" style={{ padding: "0.5rem 1rem" }}>
        <h2 style={{ margin: 0 }}>英会話</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className="ghost"
            onClick={handleClear}
            disabled={messages.length === 0}
            style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
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
        <div
          className="card"
          style={{
            color: "var(--color-danger)",
            fontSize: "0.875rem",
            margin: "0 0.5rem 0.5rem",
            padding: "0.75rem",
          }}
        >
          {configError}
        </div>
      )}

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {messages.length === 0 && !streamingContent && (
          <div
            className="card"
            style={{
              textAlign: "center",
              color: "var(--color-muted)",
              marginTop: "2rem",
            }}
          >
            <p>英語でメッセージを送って会話を始めましょう！</p>
            <p style={{ fontSize: "0.875rem" }}>
              例: "Hi! How are you?", "What did you do today?"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
            }}
          >
            <div
              className="card"
              style={{
                margin: 0,
                padding: "0.75rem 1rem",
                background:
                  msg.role === "user"
                    ? "var(--color-primary-dark)"
                    : "var(--color-surface)",
                color:
                  msg.role === "user" ? "#fff" : "var(--color-text)",
                borderRadius: "var(--radius)",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
            </div>
            {msg.role === "assistant" && (
              <button
                className="ghost"
                onClick={() => handleSpeak(msg.content)}
                style={{
                  fontSize: "0.75rem",
                  padding: "0.2rem 0.5rem",
                  marginTop: "0.25rem",
                }}
                title="音声再生"
              >
                🔊 読み上げ
              </button>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {streamingContent && (
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "85%",
            }}
          >
            <div
              className="card"
              style={{
                margin: 0,
                padding: "0.75rem 1rem",
                background: "var(--color-surface)",
                borderRadius: "var(--radius)",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
              }}
            >
              {streamingContent}
              <span className="cursor-blink" style={{ animation: "blink 1s step-end infinite" }}>▍</span>
            </div>
          </div>
        )}

        {/* Loading dots when no streaming content yet */}
        {loading && !streamingContent && (
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "85%",
            }}
          >
            <div
              className="card"
              style={{
                margin: 0,
                padding: "0.75rem 1rem",
                background: "var(--color-surface)",
                borderRadius: "var(--radius)",
              }}
            >
              <span className="loading-dots">考え中...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.75rem 0.5rem",
          borderTop: "1px solid var(--color-surface-2)",
          background: "var(--color-bg)",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="英語でメッセージを入力..."
          disabled={loading || !config}
          style={{
            flex: 1,
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-surface-2)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: "1rem",
            outline: "none",
          }}
        />
        {loading ? (
          <button
            className="danger"
            onClick={handleStop}
            style={{ whiteSpace: "nowrap" }}
          >
            停止
          </button>
        ) : (
          <button
            className="primary"
            onClick={sendMessage}
            disabled={!input.trim() || !config}
            style={{ whiteSpace: "nowrap" }}
          >
            送信
          </button>
        )}
      </div>
    </div>
  );
}