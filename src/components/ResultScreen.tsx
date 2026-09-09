import { useEffect } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import type { AnswerRecord } from "../domain/session";
import { scoreRate, wrongWordIds } from "../domain/session";
import { nextReviewState, systemClock } from "../domain/srs";
import { wordById } from "../content/loader";
import { speak } from "../domain/speech";
import { uuid } from "../domain/uuid";
import { localProgress } from "../storage/localProgress";
import styles from "./ResultScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  deckId: string;
  lessonId: string;
  answers: AnswerRecord[];
}

export default function ResultScreen({
  state,
  dispatch,
  storage,
  deckId,
  lessonId,
  answers,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);

  useEffect(() => {
    if (!deck) return;
    const endedAt = new Date().toISOString();
    const sessionId = uuid();
    storage
      .startSession({
        id: sessionId,
        deckId,
        lessonId,
        startedAt: endedAt,
        endedAt,
        kind: "learn",
        scoreRate: scoreRate(answers),
      })
      .catch(() => {});

    // Persist to localStorage progress store (survives page reload)
    localProgress.recordSession({
      askedCount: answers.length,
      correctCount: answers.filter((a) => a.correct).length,
      answeredAt: endedAt,
    });
    localProgress.saveQuizResults(
      deckId,
      lessonId,
      answers.map((a) => ({
        quizId: a.quizId,
        wordId: a.wordId,
        correct: a.correct,
      })),
    );

    (async () => {
      for (const a of answers) {
        const existing = await storage.loadReview(deckId, a.wordId);
        const updated = nextReviewState(existing, a.correct, systemClock);
        await storage.saveReview({
          deckId,
          wordId: a.wordId,
          level: updated.level,
          lastResult: updated.lastResult,
          lastSeenAt: updated.lastSeenAt,
          dueAt: updated.dueAt,
          correctStreak: updated.correctStreak,
          wrongTotal: updated.wrongTotal,
        });
      }
    })().catch(() => {});
  }, [deck, deckId, lessonId, answers, storage]);

  if (!deck) {
    return (
      <div className="container">
        <p>デッキが見つかりません</p>
        <button
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
        >
          ホームへ
        </button>
      </div>
    );
  }

  const rate = scoreRate(answers);
  const elapsedSec = Math.round(
    answers.reduce((sum, a) => sum + a.latencyMs, 0) / 1000,
  );
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const sessionTime = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
  const wrongIds = wrongWordIds(answers);
  const wrongWords = wrongIds
    .map((id) => wordById(deck, id))
    .filter((w): w is NonNullable<typeof w> => Boolean(w));

  return (
    <div className="container wide">
      <div
        className={`card result-summary motion-zoom-in ${styles.summaryCard}`}
      >
        <h2>セッション完了</h2>
        <div className="result-rate">{Math.round(rate * 100)}%</div>
        <p>
          正解 {answers.filter((a) => a.correct).length} / {answers.length} 問
        </p>
        <p className="result-time">セッション時間 {sessionTime}</p>
      </div>

      {wrongWords.length > 0 && (
        <div className="card">
          <h3>誤答した語</h3>
          <ul className="wrong-words-grid">
            {wrongWords.map((w) => (
              <li key={w.wordId} className="wrong-word">
                <strong>{w.term}</strong>
                <span className="wrong-word-meaning">{w.meaning}</span>
                <button
                  className="ghost"
                  aria-label={`${w.term} の発音を再生`}
                  onClick={() => speak(w.term)}
                >
                  ▶
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="result-actions">
        <button
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          className={styles.actionButton}
        >
          ホームへ
        </button>
        <button
          className={`primary ${styles.actionButton}`}
          onClick={() => dispatch({ type: "go", screen: { name: "progress" } })}
        >
          進捗を見る
        </button>
        <button
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
          className={styles.actionButton}
        >
          デッキへ
        </button>
      </div>
    </div>
  );
}
