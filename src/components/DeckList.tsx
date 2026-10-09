import { useEffect, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { Deck } from "../content/schema";
import { deckSchema } from "../content/schema";
import { CONVERSATION_DECK_ID } from "../domain/conversationExtract";
import {
  MANUAL_DECK_ID,
  buildManualDeck,
  mergeIntoManualDeck,
  parseManualWords,
} from "../domain/manualDeck";
import type { StorageProvider } from "../storage/types";
import { storage as defaultStorage } from "../storage/dexieProvider";
import { setShortcutsSuppressed } from "../app/useKeyboardShortcuts";
import styles from "./DeckList.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  /** 保存先（テストで差し替え可能にするため prop。既定はアプリ本体の storage）。 */
  storage?: StorageProvider;
}

const LEVELS: Deck["level"][] = ["beginner", "intermediate", "advanced"];
const LEVEL_LABEL: Record<Deck["level"], string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
};

/** Issue #151: 自分の会話から出た語が一番復習価値が高いのに、一覧の末尾に沈んでいた。 */
function isOwnDeck(deck: Deck): boolean {
  return deck.source === "conversation" || deck.deckId === CONVERSATION_DECK_ID;
}

/** Issue #178: 手動で足した語のデッキ（source: "manual"）。 */
function isManualDeck(deck: Deck): boolean {
  return deck.deckId === MANUAL_DECK_ID || deck.source === "manual";
}

export default function DeckList({
  state,
  dispatch,
  storage = defaultStorage,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<Deck["level"]>("intermediate");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自分のデッキ（会話抽出・手動追加）をサンプルより上に出す。安定ソートで元順を保つ。
  const ownDecks = state.decks.filter((d) => isOwnDeck(d) || isManualDeck(d));
  const sampleDecks = state.decks.filter(
    (d) => !isOwnDeck(d) && !isManualDeck(d),
  );

  useEffect(() => {
    if (!adding) return;
    setShortcutsSuppressed(true);
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAdding(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setShortcutsSuppressed(false);
      window.removeEventListener("keydown", onKey);
    };
  }, [adding]);

  const openAdd = () => {
    setText("");
    setError(null);
    setAdding(true);
  };

  const handleSave = async () => {
    const parsed = parseManualWords(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const now = new Date().toISOString();
    const existing = state.decks.find((d) => d.deckId === MANUAL_DECK_ID);
    const built = existing
      ? mergeIntoManualDeck(existing, parsed.words, { now, level }).deck
      : buildManualDeck(parsed.words, { now, level });

    // ユーザー入力も素で保存しない（既存方針: deckSchema で検証）。
    const validated = deckSchema.safeParse(built);
    if (!validated.success) {
      setError(
        `デッキ検証に失敗しました: ${validated.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 2)
          .join(" / ")}`,
      );
      return;
    }
    const deck = validated.data;
    const updatedDecks = existing
      ? state.decks.map((d) => (d.deckId === MANUAL_DECK_ID ? deck : d))
      : [...state.decks, deck];

    try {
      await storage.saveUserDeck({
        deckId: deck.deckId,
        deck,
        sourceTurns: 0,
        createdAt: now,
        updatedAt: now,
      });
      dispatch({ type: "setDecks", decks: updatedDecks });
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const renderDeck = (deck: Deck) => (
    <button
      key={deck.deckId}
      className="menu-item"
      onClick={() =>
        dispatch({
          type: "go",
          screen: { name: "deckHome", deckId: deck.deckId },
        })
      }
    >
      <span className={styles.deckTitle}>{deck.title}</span>
      <span className={styles.deckMeta}>
        {deck.level} · {deck.lessons.length} レッスン
      </span>
    </button>
  );

  return (
    <div className="container">
      <div className="nav-header">
        <h2>デッキ一覧</h2>
        <div className={styles.navActions}>
          <button className="primary" onClick={openAdd}>
            単語を追加
          </button>
          <button
            className="ghost"
            onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          >
            戻る
          </button>
        </div>
      </div>

      {ownDecks.length > 0 && (
        <>
          <h3 className={styles.groupTitle}>自分のデッキ</h3>
          <div className="card-grid">{ownDecks.map(renderDeck)}</div>
        </>
      )}

      <h3 className={styles.groupTitle}>
        {ownDecks.length > 0 ? "サンプル" : "デッキ"}
      </h3>
      <div className="card-grid">{sampleDecks.map(renderDeck)}</div>

      {adding && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="単語を追加"
          onClick={() => setAdding(false)}
          className="modal-overlay"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`card ${styles.modal}`}
          >
            <h2 className={styles.modalTitle}>単語を追加</h2>
            <p className={styles.modalHint}>
              1行に1語。<code>語, 意味, 例文(任意)</code> の順で、カンマ or
              タブ区切り。例:{" "}
              <code>commute, 通勤する, I commute by train.</code>
            </p>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "commute, 通勤する\nresilient, 粘り強い, She is resilient."
              }
            />
            <label className={styles.levelRow}>
              レベル
              <select
                className={styles.select}
                value={level}
                onChange={(e) => setLevel(e.target.value as Deck["level"])}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className={styles.errorText}>{error}</p>}
            <div className={styles.actions}>
              <button
                className="ghost"
                type="button"
                onClick={() => setAdding(false)}
              >
                キャンセル
              </button>
              <button className="primary" type="button" onClick={handleSave}>
                追加する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
