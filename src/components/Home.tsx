import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import { systemClock } from "../domain/srs";
import { computeProgress, dailyGoalRate } from "../domain/progress";
import { allWords } from "../content/loader";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function Home({ state, dispatch, storage }: Props) {
  const [due, setDue] = useState(0);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [goal, setGoal] = useState(10);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const settings = await storage.loadSettings();
      const today = systemClock.today();
      const reviews = await storage.loadDueReviews(null, today);
      const count = await storage.countAnswersSince(`${today}T00:00:00.000Z`);
      const sessions = await storage.listSessions(200);
      const dates = sessions.map((s) => s.startedAt.slice(0, 10));
      if (!mounted) return;
      setDue(reviews.length);
      setTodayAnswered(count);
      setGoal(settings.dailyGoalWords);
      let streakCount = 0;
      let cursor = today;
      const unique = Array.from(new Set(dates.sort().reverse()));
      for (const d of unique) {
        if (d === cursor) {
          streakCount += 1;
          const prev = new Date(`${cursor}T00:00:00`);
          prev.setDate(prev.getDate() - 1);
          cursor = prev.toISOString().slice(0, 10);
        } else {
          break;
        }
      }
      setStreak(streakCount);
    })();
    return () => {
      mounted = false;
    };
  }, [storage]);

  const totalWords = state.decks.reduce(
    (acc, d) => acc + allWords(d).length,
    0,
  );
  const summary = computeProgress(
    totalWords,
    [],
    systemClock.today(),
    todayAnswered,
    goal,
  );

  return (
    <div className="container">
      <div className="card">
        <h1>English Practice</h1>
        <p>ローカルに学習・復習・進捗を保存する英語学習アプリ</p>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div className="badge">今日の復習</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{due} 語</div>
          </div>
          <div>
            <div className="badge">目標達成率</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {Math.round(dailyGoalRate(summary) * 100)}%
            </div>
          </div>
          <div>
            <div className="badge">連続学習日</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {streak} 日
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <button
          className="primary"
          style={{ width: "100%", marginBottom: "0.75rem" }}
          onClick={() => dispatch({ type: "go", screen: { name: "deckList" } })}
        >
          デッキを選ぶ
        </button>
        <button
          style={{ width: "100%", marginBottom: "0.75rem" }}
          onClick={() =>
            dispatch({ type: "go", screen: { name: "dashboard" } })
          }
        >
          進捗ダッシュボード
        </button>
        <button
          className="primary"
          style={{ width: "100%", marginBottom: "0.75rem" }}
          onClick={() =>
            dispatch({ type: "go", screen: { name: "conversation" } })
          }
        >
          英会話
        </button>
        <button
          style={{ width: "100%" }}
          onClick={() => dispatch({ type: "go", screen: { name: "settings" } })}
        >
          設定
        </button>
      </div>
    </div>
  );
}
