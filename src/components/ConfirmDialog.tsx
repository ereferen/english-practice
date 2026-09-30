import { useEffect, useRef, type ReactNode } from "react";
import { setShortcutsSuppressed } from "../app/useKeyboardShortcuts";
import styles from "./ConfirmDialog.module.css";

interface Props {
  /** 見出し。破壊的操作なら何を消すのかを一言で。 */
  title: string;
  /** 何が消えて何が残るかの説明（Issue #150）。 */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破壊的操作は danger（赤）、通常は primary。 */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Issue #150: 削除確認だけブラウザ標準の `window.confirm` を使っていて
 * アプリ内モーダル（ShortcutHelp / SetupWizard）と見た目が切れていた。
 * ここに共通の確認ダイアログを置き、`.modal-overlay` + `.card` で
 * 世界観を揃える。Esc / オーバーレイクリックでキャンセル、初期フォーカスは
 * キャンセル側（破壊的操作の誤爆防止）。
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel = "削除する",
  cancelLabel = "キャンセル",
  tone = "danger",
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setShortcutsSuppressed(true);
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setShortcutsSuppressed(false);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      className="modal-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`card ${styles.modal}`}
      >
        <h2 className={styles.modalTitle}>{title}</h2>
        {children ? <div className={styles.body}>{children}</div> : null}
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            className="ghost"
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
