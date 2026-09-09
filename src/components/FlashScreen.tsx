import { useEffect, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import { pickLesson } from "../content/loader";
import { speak } from "../domain/speech";
import type { LocalProgressStore } from "../storage/localProgress";
import { useKeyboardShortcuts } from "../app/useKeyboardShortcuts";
import styles from "./FlashScreen.module.css";

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
  // Issue #45: brief gold-rim pulse while the card face changes.
  const [flipping, setFlipping] = useState(false);
  const learnedRef = useRef<Set<string>>(new Set());

  const toggleFlip = () => {
    // Issue #75: once the user has revealed the answer, count the word as
    // learned immediately. Previously only 「次の語」 recorded it, so
    // pressing 戻る lost all visible progress (学習率 0% complaint).
    if (!flipped) markCurrentLearned();
    setFlipped((f) => !f);
    setFlipping(true);
    window.setTimeout(() => setFlipping(false), 180);
  };

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
    " ": toggleFlip,
    Enter: toggleFlip,
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
        {/* Issue #75: one clearly-labelled exit button (was 中断, which
            confused users looking for 戻る — aborting keeps learned words). */}
        <button
          className="ghost"
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          戻る
        </button>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "progress" } })}
        >
          進捗
        </button>
      </div>

      <div
        onClick={toggleFlip}
        role="button"
        tabIndex={0}
        aria-label="カードをめくる"
        data-flipping={flipping ? "true" : undefined}
        className={`card flash-card ${styles.flipCard}`}
      >
        {!flipped ? (
          <>
            {/* Issue #72: the front shows ONLY the term. Reading + meaning
                stay hidden so users can self-test before flipping. */}
            <div className={`flash-term ${styles.term}`}>{word.term}</div>
            <div className={styles.flipHint} aria-hidden="true">
              クリック / Space でめくる
            </div>
          </>
        ) : (
          <>
            <div className={styles.readingBack}>{word.reading}</div>
            <div className={styles.meaning}>{word.meaning}</div>
            {word.partOfSpeech && (
              <div className={`badge-gold ${styles.partOfSpeech}`}>
                {word.partOfSpeech}
              </div>
            )}
            <div className={styles.examples}>
              {word.examples.map((ex, i) => (
                <div key={i} className={styles.example}>
                  <div>{ex.en}</div>
                  {ex.ja && <div className={styles.exampleJa}>{ex.ja}</div>}
                </div>
              ))}
            </div>
            {word.note && <p className={styles.note}>ノート: {word.note}</p>}
          </>
        )}
      </div>

      <div className={`flash-actions ${styles.actions}`}>
        <button className={styles.audioButton} onClick={() => speak(word.term)}>
          音声再生
        </button>
        <button className={`primary ${styles.nextButton}`} onClick={handleNext}>
          {isLast ? "クイズへ" : "次の語"}
        </button>
      </div>
    </div>
  );
}
