import { useEffect, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { Deck } from "../content/schema";
import { deckSchema } from "../content/schema";
import {
  MANUAL_DECK_ID,
  buildManualDeck,
  isOwnDeck,
  mergeIntoManualDeck,
  parseManualWords,
} from "../domain/manualDeck";
import type { StorageProvider, ReviewState } from "../storage/types";
import { storage as defaultStorage } from "../storage/dexieProvider";
import { allWords } from "../content/loader";
import { deckListStat, type DeckListStat } from "../domain/progress";
import { systemClock } from "../domain/srs";
import { localProgress } from "../storage/localProgress";
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

export default function DeckList({
  state,
  dispatch,
  storage = defaultStorage,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<Deck["level"]>("intermediate");
  const [error, setError] = useState<string | null>(null);
  // Issue #181: 個別に非表示にしたデッキ（サンプル/自分のデッキ問わず）。
  // 「すべてのデータを削除」以外に消す手段が無かったのを、一覧から外すだけの
  // 軽い非表示で解決する（設定に保存。デッキ本体は消さない）。
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  // Issue #195: 一覧で「どのデッキを今日開くか」を決められるよう、行に語数・学習率・
  // 今日の復習数を出す。数字は deckHome と同じ計算（review + localStorage）。
  const [stats, setStats] = useState<Record<string, DeckListStat>>({});
  const decks = state.decks;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const today = systemClock.today();
      const flash = localProgress.load().learnedWords;
      const next: Record<string, DeckListStat> = {};
      for (const deck of decks) {
        try {
          const words = allWords(deck);
          const reviews = (
            await Promise.all(
              words.map((w) => storage.loadReview(deck.deckId, w.wordId)),
            )
          ).filter((r): r is ReviewState => Boolean(r));
          const flashLearned = flash.filter(
            (w) => w.deckId === deck.deckId,
          ).length;
          next[deck.deckId] = deckListStat(
            words.length,
            reviews,
            today,
            flashLearned,
          );
        } catch {
          // 取得できないデッキは数字なしで出す（一覧自体は壊さない）。
        }
      }
      if (mounted) setStats(next);
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, [decks, storage]);

  // 自分のデッキ（会話抽出・手動追加）をサンプルより上に出す。安定ソートで元順を保つ。
  const ownDecks = state.decks.filter(
    (d) => isOwnDeck(d) && !hiddenIds.includes(d.deckId),
  );
  const sampleDecks = state.decks.filter(
    (d) => !isOwnDeck(d) && !hiddenIds.includes(d.deckId),
  );
  const hiddenDecks = state.decks.filter((d) => hiddenIds.includes(d.deckId));

  useEffect(() => {
    let mounted = true;
    // storage をモック差し替えしたテストでも落ちないよう、同期例外も拾う。
    Promise.resolve()
      .then(() => storage.loadSettings())
      .then((s) => {
        if (!mounted) return;
        const ids = (s as { hiddenDeckIds?: string[] }).hiddenDeckIds ?? [];
        setHiddenIds(ids);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [storage]);

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

  const setHidden = (deckId: string, hide: boolean) => {
    const next = hide
      ? Array.from(new Set([...hiddenIds, deckId]))
      : hiddenIds.filter((id) => id !== deckId);
    setHiddenIds(next);
    Promise.resolve()
      .then(() => storage.saveSettings({ hiddenDeckIds: next }))
      .catch(() => {});
  };

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
      // 追加したデッキが非表示のままだと「追加したのに出てこない」になる。
      if (hiddenIds.includes(deck.deckId)) setHidden(deck.deckId, false);
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const renderDeck = (deck: Deck) => {
    const stat = stats[deck.deckId];
    return (
    <div key={deck.deckId} className={styles.deckRow}>
      <button
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
          {stat && (
            <>
              {" · "}
              {stat.totalWords} 語 · 学習率 {stat.completion}%
            </>
          )}
        </span>
        {/* Issue #195: 復習期限が来ているデッキは一覧で目立たせる
            （朝いちばんに開くデッキが一目で分かる）。 */}
        {stat && stat.dueToday > 0 && (
          <span className={styles.dueBadge}>復習 {stat.dueToday}語</span>
        )}
      </button>
      <button
        className={`ghost ${styles.hideButton}`}
        type="button"
        title="このデッキを一覧から隠す（データは残る）"
        aria-label="このデッキを一覧から隠す"
        onClick={() => setHidden(deck.deckId, true)}
      >
        隠す
      </button>
    </div>
    );
  };

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

      {/* Issue #181: 非表示にしたデッキはここに溜める（戻せる）。 */}
      {hiddenDecks.length > 0 && (
        <>
          <h3 className={styles.groupTitle}>
            非表示のデッキ（{hiddenDecks.length}）
          </h3>
          <div className="card-grid">
            {hiddenDecks.map((deck) => (
              <div key={deck.deckId} className={styles.deckRow}>
                <span className={styles.hiddenTitle}>{deck.title}</span>
                <button
                  className={`ghost ${styles.hideButton}`}
                  type="button"
                  title="一覧に戻す"
                  onClick={() => setHidden(deck.deckId, false)}
                >
                  表示に戻す
                </button>
              </div>
            ))}
          </div>
        </>
      )}

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
              1行に1語。
              <code>語, 意味, 例文(任意), 読み(任意), 品詞(任意)</code>{" "}
              の順で、カンマ or タブ区切り（タブなら位置で厳密に判定）。例:{" "}
              <code>
                {"commute\t通勤する\tI commute by train.\tコミュート\t動詞"}
              </code>
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
