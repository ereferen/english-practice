import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider, SessionRecord } from "../storage/types";
import { allWords } from "../content/loader";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function Dashboard({ state, dispatch, storage }: Props) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const list = await storage.listSessions(50);
      if (!mounted) return;
      setSessions(list);
    })();
    return () => {
      mounted = false;
    };
  }, [storage]);

  const totalWords = state.decks.reduce(
    (acc, d) => acc + allWords(d).length,
    0,
  );
  const totalSessions = sessions.length;
  const avgScore =
    sessions.filter((s) => s.scoreRate !== null).length > 0
      ? Math.round(
          (sessions
            .filter((s) => s.scoreRate !== null)
            .reduce((a, s) => a + (s.scoreRate ?? 0), 0) /
            sessions.filter((s) => s.scoreRate !== null).length || 0) * 100,
        )
      : 0;

  return (
    <div className="container">
      <div className="nav-header">
        <h2>進捗ダッシュボード</h2>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
        >
          戻る
        </button>
      </div>

      <div
        className="card"
        style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}
      >
        <div>
          <div className="badge">登録語数</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {totalWords} 語
          </div>
        </div>
        <div>
          <div className="badge">セッション数</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {totalSessions} 回
          </div>
        </div>
        <div>
          <div className="badge">平均正答率</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{avgScore}%</div>
        </div>
      </div>

      <h3>最近のセッション</h3>
      {sessions.length === 0 && (
        <p className="card">まだ学習履歴がありません</p>
      )}
      {sessions.slice(0, 10).map((s) => (
        <div key={s.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{s.startedAt.slice(0, 10)}</span>
            <span>
              {s.scoreRate !== null ? `${Math.round(s.scoreRate * 100)}%` : "-"}
            </span>
          </div>
          <div style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>
            {state.decks.find((d) => d.deckId === s.deckId)?.title ?? s.deckId}{" "}
            · {s.lessonId}
          </div>
        </div>
      ))}
    </div>
  );
}
