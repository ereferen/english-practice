import { useEffect, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import { pickLesson } from "../content/loader";
import { speak } from "../domain/speech";
import type { LocalProgressStore } from "../storage/localProgress";
import { useKeyboardShortcuts } from "../app/useKeyboardShortcuts";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  localProgress: LocalProgressStore;
  deckId: string;
  lessonId: string;
}

export default function FlashScreen({
  state,
  dispatch,
  localProgress,
  deckId,
  lessonId,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const lessonWithDeck = deck ? pickLesson(deck, lessonId) : undefined;
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const learnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    learnedRef.current = new Set();
  }, [deckId, lessonId]);

  const lesson = lessonWithDeck?.lesson;
  const words = lesson?.words ?? [];
  const word = words[Math.min(index, Math.max(words.length - 1, 0))];
  const isLast = lesson ? index === lesson.words.length - 1 : false;

  /** Mark the current word as learned (idempotent per render cycle). */
  const markCurrentLearned = () => {
    if (!word) return;
    const id = word.wordId;
    if (learnedRef.current.has(id)) return;
    learnedRef.current.add(id);
    localProgress.markLearned({
      deckId,
      wordId: id,
      learnedAt: new Date().toISOString(),
    });
  };

  const handleNext = () => {
    if (!lesson) return;
    markCurrentLearned();
    if (isLast) {
      dispatch({ type: "go", screen: { name: "quiz", deckId, lessonId } });
    } else {
      setIndex((i) => i + 1);
      setFlipped(false);
    }
  };

  // Keyboard shortcuts (issue #9): flip, next, audio, abort.
  useKeyboardShortcuts({
    " ": () => lesson && setFlipped((f) => !f),
    Enter: () => lesson && setFlipped((f) => !f),
    ArrowRight: handleNext,
    n: handleNext,
    N: handleNext,
    s: () => word && speak(word.term),
    S: () => word && speak(word.term),
    Escape: () =>
      dispatch({ type: "go", screen: { name: "deckHome", deckId } }),
  });

  if (!deck || !lesson) {
    return (
      <div className="container">
        <p>レッスンが見つかりません</p>
        <button
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          戻る
        </button>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="nav-header">
        <h2>
          フラッシュカード ({index + 1}/{lesson.words.length})
        </h2>
        <button
          className="ghost"
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          中断
        </button>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "progress" } })}
        >
          進捗
        </button>
      </div>

      <div
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-label="カードをめくる"
        className="card flash-card"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        {!flipped ? (
          <>
            <div
              className="flash-term"
              style={{ fontWeight: 700, marginBottom: "0.5rem" }}
            >
              {word.term}
            </div>
            <div style={{ color: "var(--color-muted)" }}>{word.reading}</div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                marginBottom: "0.5rem",
              }}
            >
              {word.meaning}
            </div>
            {word.partOfSpeech && (
              <div className="badge" style={{ marginBottom: "0.75rem" }}>
                {word.partOfSpeech}
              </div>
            )}
            <div style={{ width: "100%", textAlign: "left" }}>
              {word.examples.map((ex, i) => (
                <div key={i} style={{ marginBottom: "0.5rem" }}>
                  <div>{ex.en}</div>
                  {ex.ja && (
                    <div
                      style={{
                        color: "var(--color-muted)",
                        fontSize: "0.875rem",
                      }}
                    >
                      {ex.ja}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {word.note && (
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>
                ノート: {word.note}
              </p>
            )}
          </>
        )}
      </div>

      <div
        className="flash-actions"
        style={{ display: "flex", gap: "0.75rem" }}
      >
        <button onClick={() => speak(word.term)} style={{ flex: 1 }}>
          音声再生
        </button>
        <button className="primary" onClick={handleNext} style={{ flex: 2 }}>
          {isLast ? "クイズへ" : "次の語"}
        </button>
      </div>
    </div>
  );
}
