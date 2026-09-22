import { useEffect, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import { pickLesson } from "../content/loader";
import { speak } from "../domain/speech";
import { useSpeechSupport } from "../domain/useSpeechSupport";
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
  // Issue #124: which words in this lesson session were already revealed,
  // so navigating 前へ/次へ restores the correct face; also drives the
  // flip-gate on 「次の語」.
  const flippedRef = useRef<Set<string>>(new Set());
  const [shake, setShake] = useState(false);
  // Issue #83: when the environment has no TTS voices, the audio button
  // must say so instead of silently doing nothing.
  const speechAvail = useSpeechSupport();
  const [ttsNotice, setTtsNotice] = useState(false);

  const handleSpeak = (text: string) => {
    const played = speak(text);
    if (!played) {
      setTtsNotice(true);
      window.setTimeout(() => setTtsNotice(false), 2500);
    }
  };

  const toggleFlip = () => {
    // Issue #75: once the user has revealed the answer, count the word as
    // learned immediately. Previously only 「次の語」 recorded it, so
    // pressing 戻る lost all visible progress (学習率 0% complaint).
    if (!flipped) markCurrentLearned();
    const next = !flipped;
    if (next && word) flippedRef.current.add(word.wordId);
    setFlipped(next);
    setFlipping(true);
    // Issue #94: matches the paperFlip animation (320ms) so the rim glow
    // persists for the full sweep.
    window.setTimeout(() => setFlipping(false), 320);
  };

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    learnedRef.current = new Set();
    flippedRef.current = new Set();
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

  /** Jump to a word index, restoring the face (front/back) it had earlier
   *  in this session (issue #124: 前へ/次へ navigation). */
  const goTo = (nextIndex: number) => {
    setIndex(nextIndex);
    const target = words[nextIndex];
    const wasFlipped = target ? flippedRef.current.has(target.wordId) : false;
    setFlipped(wasFlipped);
  };

  // Issue #124: 「次の語」 requires the card to have been flipped at least
  // once — otherwise users could consume a whole lesson without ever
  // seeing a meaning. An unflipped card shakes and says why.
  const requestFlipFirst = () => {
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  };

  const handleNext = () => {
    if (!lesson) return;
    if (!flipped && !(word && flippedRef.current.has(word.wordId))) {
      requestFlipFirst();
      return;
    }
    markCurrentLearned();
    if (isLast) {
      dispatch({ type: "go", screen: { name: "quiz", deckId, lessonId } });
    } else {
      goTo(index + 1);
    }
  };

  const handlePrev = () => {
    if (index === 0) return;
    goTo(index - 1);
  };

  // Issue #124: 「最初からやり直す」 on the last card restarts the pass so
  // the lesson doubles as a quick morning review.
  const handleRestart = () => {
    flippedRef.current = new Set();
    setIndex(0);
    setFlipped(false);
  };

  // Keyboard shortcuts (issue #9, #124: ← goes back).
  useKeyboardShortcuts({
    " ": toggleFlip,
    Enter: toggleFlip,
    ArrowRight: handleNext,
    ArrowLeft: handlePrev,
    n: handleNext,
    N: handleNext,
    s: () => word && handleSpeak(word.term),
    S: () => word && handleSpeak(word.term),
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
        data-shake={shake ? "true" : undefined}
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
        <button
          className="ghost"
          onClick={handlePrev}
          disabled={index === 0}
          title="前へ (←)"
        >
          ← 前へ
        </button>
        <button
          className={styles.audioButton}
          onClick={() => handleSpeak(word.term)}
          title={
            speechAvail === "ready"
              ? "発音再生 (S)"
              : "このブラウザは音声未対応（TTSボイス0個）"
          }
        >
          {speechAvail === "ready" ? "🔊" : "🔇"} 音声再生
        </button>
        {ttsNotice && (
          <span className={styles.ttsNotice} role="status" aria-live="polite">
            このブラウザは音声未対応です（TTSボイスがありません）
          </span>
        )}
        {isLast && (
          <button className="ghost" onClick={handleRestart}>
            最初からやり直す
          </button>
        )}
        <button className={`primary ${styles.nextButton}`} onClick={handleNext}>
          {isLast ? "クイズへ" : "次の語"}
        </button>
      </div>
      {shake && (
        <p className={styles.flipGate} role="alert">
          ⚠ 先にカードをめくって意味を確認しましょう（クリック / Space）
        </p>
      )}
    </div>
  );
}
