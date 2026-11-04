import { useEffect, useRef } from "react";
import type { WordMeaning } from "../domain/wordLookup";
import { partOfSpeechLabel } from "../domain/partOfSpeech";
import styles from "./WordPopover.module.css";

export type WordPopoverStatus = "loading" | "ready" | "error";
export type WordAddState = "idle" | "saved" | "exists";

interface Props {
  term: string;
  status: WordPopoverStatus;
  meaning: WordMeaning | null;
  error: string | null;
  errorDetails?: string | null;
  /** 既存デッキで見つかったときのデッキ名（LLM を使っていない目印） */
  fromDeck?: string | null;
  canSpeak: boolean;
  addState: WordAddState;
  addError?: string | null;
  addDisabledReason?: string | null;
  onSpeak: () => void;
  onAdd: () => void;
  onClose: () => void;
}

/**
 * Issue #245: 相手メッセージ中の語をタップしたときに出る語義パネル。
 * 位置計算をせずメッセージ直下に流し込む（モバイルで画面外に出ない）。
 * 語義は既存デッキ → LLM の順で解決済みのものを親から受け取る。
 */
export default function WordPopover({
  term,
  status,
  meaning,
  error,
  errorDetails,
  fromDeck,
  canSpeak,
  addState,
  addError,
  addDisabledReason,
  onSpeak,
  onAdd,
  onClose,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // 開いた直後に閉じるボタンへフォーカスを移す（キーボードで抜けられるように）
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const posLabel = meaning?.partOfSpeech
    ? partOfSpeechLabel(meaning.partOfSpeech)
    : "";

  return (
    <div
      className={styles.popover}
      role="dialog"
      aria-label={`「${term}」の意味`}
      data-testid="word-popover"
    >
      <div className={styles.head}>
        <span className={styles.term}>{meaning?.term || term}</span>
        {meaning?.reading && (
          <span className={styles.reading}>/{meaning.reading}/</span>
        )}
        {posLabel && <span className={styles.pos}>{posLabel}</span>}
        {canSpeak && (
          <button
            type="button"
            className={`ghost ${styles.iconButton}`}
            onClick={onSpeak}
            title="発音を再生"
            aria-label="発音を再生"
          >
            🔊
          </button>
        )}
        <button
          ref={closeRef}
          type="button"
          className={`ghost ${styles.iconButton} ${styles.closeButton}`}
          onClick={onClose}
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>

      {fromDeck && (
        <p className={styles.source}>📚 既存デッキ「{fromDeck}」にあります</p>
      )}

      {status === "loading" && (
        <p className={styles.loading} role="status">
          意味を調べています…
        </p>
      )}

      {status === "error" && (
        <div className={styles.error}>
          <p>{error ?? "意味を取得できませんでした。"}</p>
          {errorDetails && (
            <details className={styles.details}>
              <summary>詳しく（技術情報）</summary>
              <pre>{errorDetails}</pre>
            </details>
          )}
        </div>
      )}

      {status === "ready" && meaning && (
        <>
          <p className={styles.meaning}>{meaning.meaning}</p>
          {meaning.example && (
            <p className={styles.example}>
              {meaning.example}
              {meaning.exampleJa && (
                <span className={styles.exampleJa}>{meaning.exampleJa}</span>
              )}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className="primary"
              onClick={onAdd}
              disabled={addState !== "idle" || Boolean(addDisabledReason)}
              title={addDisabledReason ?? undefined}
            >
              {addState === "saved"
                ? "✓ デッキに追加しました"
                : addState === "exists"
                  ? "✓ 追加済み"
                  : "＋ デッキに追加"}
            </button>
            {addDisabledReason && (
              <span className={styles.hint}>{addDisabledReason}</span>
            )}
          </div>
          {addError && <p className={styles.error}>{addError}</p>}
        </>
      )}
    </div>
  );
}
