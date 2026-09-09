import { useEffect } from "react";
import { setShortcutsSuppressed } from "../app/useKeyboardShortcuts";
import styles from "./ShortcutHelp.module.css";

interface Props {
  onClose: () => void;
}

const SHORTCUTS: { section: string; items: [string, string][] }[] = [
  {
    section: "フラッシュカード",
    items: [
      ["Space / Enter", "カードをめくる"],
      ["→ / n", "次の語"],
      ["s", "音声再生"],
      ["Esc", "中断して戻る"],
    ],
  },
  {
    section: "クイズ",
    items: [
      ["1 - 4", "選択肢を選ぶ"],
      ["Enter / →", "回答を確定・次へ"],
      ["Esc", "中断して戻る"],
    ],
  },
  {
    section: "英会話",
    items: [
      ["Enter", "メッセージ送信"],
      ["Shift+Enter", "改行"],
      ["Esc", "入力をクリア"],
    ],
  },
  {
    section: "全画面共通",
    items: [
      ["h", "ホームに戻る"],
      ["?", "この一覧を表示/非表示"],
    ],
  },
];

export default function ShortcutHelp({ onClose }: Props) {
  // While the help modal is open, disable screen-level shortcuts
  // and let Esc / ? close it.
  useEffect(() => {
    setShortcutsSuppressed(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setShortcutsSuppressed(false);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="キーボードショートカット一覧"
      onClick={onClose}
      className="modal-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`card ${styles.modal}`}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>キーボードショートカット</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {SHORTCUTS.map((sec) => (
          <div key={sec.section} className={styles.section}>
            <h3 className={styles.sectionTitle}>{sec.section}</h3>
            <dl className={styles.list}>
              {sec.items.map(([key, desc]) => (
                <div key={key + desc} className={styles.item}>
                  <dt className={styles.key}>{key}</dt>
                  <dd className={styles.desc}>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p className={styles.footnote}>
          入力フィールドにフォーカス中はショートカットは無効になります。
        </p>
      </div>
    </div>
  );
}
