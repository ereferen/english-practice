import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider, ReviewState } from "../storage/types";
import { allWords } from "../content/loader";
import { systemClock } from "../domain/srs";
import { computeProgress } from "../domain/progress";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  deckId: string;
}

export default function DeckHome({ state, dispatch, storage, deckId }: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [goal, setGoal] = useState(10);

  useEffect(() => {
    if (!deck) return;
    let mounted = true;
    (async () => {
      const settings = await storage.loadSettings();
      const today = systemClock.today();
      const all: ReviewState[] = [];
      for (const w of allWords(deck)) {
        const r = await storage.loadReview(deckId, w.wordId);
        if (r) all.push(r);
      }
      const count = await storage.countAnswersSince(`${today}T00:00:00.000Z`);
      if (!mounted) return;
      setReviews(all);
      setTodayAnswered(count);
      setGoal(settings.dailyGoalWords);
    })();
    return () => {
      mounted = false;
    };
  }, [deck, deckId, storage]);

  if (!deck) {
    return (
      <div className="container">
        <p>デッキが見つかりません</p>
        <button
          onClick={() => dispatch({ type: "go", screen: { name: "deckList" } })}
        >
          戻る
        </button>
      </div>
    );
  }

  const summary = computeProgress(
    allWords(deck).length,
    reviews,
    systemClock.today(),
    todayAnswered,
    goal,
  );
  const completion =
    summary.totalWords > 0
      ? Math.round((summary.learnedWords / summary.totalWords) * 100)
      : 0;

  return (
    <div className="container">
      <div className="nav-header">
        <h2>{deck.title}</h2>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "deckList" } })}
        >
          戻る
        </button>
      </div>

      <div className="card">
        <p>{deck.description}</p>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          <span className="badge">{deck.level}</span>
          <span className="badge">学習率 {completion}%</span>
        </div>
      </div>

      <h3>レッスン一覧</h3>
      {deck.lessons.map((lesson) => (
        <div key={lesson.lessonId} className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>{lesson.title}</strong>
              <p
                style={{
                  color: "var(--color-muted)",
                  fontSize: "0.875rem",
                  margin: 0,
                }}
              >
                {lesson.words.length} 語
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                dispatch({
                  type: "startLesson",
                  deckId,
                  lessonId: lesson.lessonId,
                })
              }
            >
              学習・クイズ
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
