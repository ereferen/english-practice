import { useEffect } from "react";
import { setShortcutsSuppressed } from "../app/useKeyboardShortcuts";

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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "1rem",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "32rem",
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          margin: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <h2 style={{ margin: 0 }}>キーボードショートカット</h2>
          <button className="ghost" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {SHORTCUTS.map((sec) => (
          <div key={sec.section} style={{ marginBottom: "0.75rem" }}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.25rem" }}>
              {sec.section}
            </h3>
            <dl style={{ margin: 0 }}>
              {sec.items.map(([key, desc]) => (
                <div
                  key={key + desc}
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    padding: "0.15rem 0",
                  }}
                >
                  <dt
                    style={{
                      minWidth: "7.5rem",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                    }}
                  >
                    {key}
                  </dt>
                  <dd style={{ margin: 0, fontSize: "0.9rem" }}>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>
          入力フィールドにフォーカス中はショートカットは無効になります。
        </p>
      </div>
    </div>
  );
}
