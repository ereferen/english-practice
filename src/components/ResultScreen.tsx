import { useEffect } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import type { AnswerRecord } from "../domain/session";
import { scoreRate, wrongWordIds } from "../domain/session";
import { nextReviewState, systemClock } from "../domain/srs";
import { wordById } from "../content/loader";
import { speak } from "../domain/speech";
import { localProgress } from "../storage/localProgress";

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
    const sessionId = crypto.randomUUID();
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
  const wrongIds = wrongWordIds(answers);
  const wrongWords = wrongIds
    .map((id) => wordById(deck, id))
    .filter((w): w is NonNullable<typeof w> => Boolean(w));

  return (
    <div className="container">
      <div className="card" style={{ textAlign: "center" }}>
        <h2>セッション完了</h2>
        <div style={{ fontSize: "3rem", fontWeight: 700 }}>
          {Math.round(rate * 100)}%
        </div>
        <p>
          正解 {answers.filter((a) => a.correct).length} / {answers.length} 問
        </p>
      </div>

      {wrongWords.length > 0 && (
        <div className="card">
          <h3>誤答した語</h3>
          <ul style={{ paddingLeft: "1.25rem" }}>
            {wrongWords.map((w) => (
              <li key={w.wordId} style={{ marginBottom: "0.5rem" }}>
                <strong>{w.term}</strong> — {w.meaning}
                <button
                  className="ghost"
                  onClick={() => speak(w.term)}
                  style={{ marginLeft: "0.5rem" }}
                >
                  ▶
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          style={{ flex: 1 }}
        >
          ホームへ
        </button>
        <button
          className="primary"
          onClick={() =>
            dispatch({ type: "go", screen: { name: "progress" } })
          }
          style={{ flex: 1 }}
        >
          進捗を見る
        </button>
        <button
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
          style={{ flex: 1 }}
        >
          デッキへ
        </button>
      </div>
    </div>
  );
}
