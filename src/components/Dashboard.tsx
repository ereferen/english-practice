import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider, SessionRecord } from "../storage/types";
import { allWords } from "../content/loader";
import { providersFromSettings } from "../domain/llm";
import {
  analyzeWeaknessWithLlm,
  buildWeaknessInput,
} from "../domain/weaknessAnalysis";
import type { WeaknessReport } from "../domain/weaknessAnalysis";
import styles from "./Dashboard.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

const STRENGTH_LABEL: Record<
  WeaknessReport["categories"][number]["strength"],
  string
> = {
  weak: "苦手",
  average: "普通",
  strong: "得意",
};

function daysAgoDate(today: Date, days: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export default function Dashboard({ state, dispatch, storage }: Props) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [report, setReport] = useState<WeaknessReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Issue #16: 分析対象期間の開始日（表示用）
  const [windowStart] = useState(() => daysAgoDate(new Date(), 30));

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
  const scored = sessions.filter((s) => s.scoreRate !== null);
  const avgScore =
    scored.length > 0
      ? Math.round(
          (scored.reduce((a, s) => a + (s.scoreRate ?? 0), 0) / scored.length) *
            100,
        )
      : 0;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const settings = await storage.loadSettings();
      const providers = providersFromSettings(settings);
      if (providers.length === 0) {
        throw new Error(
          "LLMが設定されていません。設定画面からAPIエンドポイントとモデルを登録してください。",
        );
      }
      const answers = await storage.listAnswersSince(windowStart);
      if (answers.length < 10) {
        throw new Error(
          `分析には直近30日で少なくとも10回の回答が必要です（現在 ${answers.length} 回）。`,
        );
      }
      const input = buildWeaknessInput({
        answers,
        decks: state.decks,
        today: new Date().toISOString().slice(0, 10),
      });
      const result = await analyzeWeaknessWithLlm({ providers, input });
      setReport(result);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

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

      <div className="card">
        <div className="card-grid stats-grid">
          <div>
            <div className="badge">登録語数</div>
            <div className={styles.statValue}>{totalWords} 語</div>
          </div>
          <div>
            <div className="badge">セッション数</div>
            <div className={styles.statValue}>{totalSessions} 回</div>
          </div>
          <div>
            <div className="badge">平均正答率</div>
            <div className={styles.statValue}>{avgScore}%</div>
          </div>
        </div>
      </div>

      {/* Issue #16: 弱点レポート */}
      <h3>弱点レポート</h3>
      <div className="card">
        {!report && !analyzing && !analyzeError && (
          <div className={styles.reportEmpty}>
            <span>直近30日の回答データから苦手パターンを分析できます。</span>
            <button
              className={`primary ${styles.analyzeButton}`}
              onClick={() => void handleAnalyze()}
            >
              今すぐ分析
            </button>
          </div>
        )}
        {analyzing && (
          <div className={styles.reportEmpty}>
            <span className="loading-dots">分析中...</span>
          </div>
        )}
        {analyzeError && !analyzing && (
          <div className={styles.reportError}>
            <span>{analyzeError}</span>
            <button
              className="ghost"
              onClick={() => setAnalyzeError(null)}
              aria-label="エラーを閉じる"
            >
              とじる
            </button>
          </div>
        )}
        {report && !analyzing && (
          <div className={styles.report}>
            <p className={styles.reportSummary}>{report.summary}</p>
            <ul className={styles.reportCategories}>
              {report.categories.map((c) => (
                <li key={c.category}>
                  <span
                    className={
                      "badge " +
                      (c.strength === "weak"
                        ? styles.badgeWeak
                        : c.strength === "strong"
                          ? styles.badgeStrong
                          : "")
                    }
                  >
                    {STRENGTH_LABEL[c.strength]}
                  </span>{" "}
                  <strong>{c.category}</strong> — {c.advice}
                </li>
              ))}
            </ul>
            {report.recommendedFocus.length > 0 && (
              <p className={styles.reportFocus}>
                特に復習したい語: {report.recommendedFocus.join(", ")}
              </p>
            )}
            <button
              className="ghost"
              onClick={() => void handleAnalyze()}
              disabled={analyzing}
            >
              再分析
            </button>
          </div>
        )}
      </div>

      <h3>最近のセッション</h3>
      {sessions.length === 0 && (
        <p className="card">まだ学習履歴がありません</p>
      )}
      {sessions.slice(0, 10).map((s) => (
        <div key={s.id} className="card">
          <div className={styles.sessionRow}>
            <span>{s.startedAt.slice(0, 10)}</span>
            <span>
              {s.scoreRate !== null ? `${Math.round(s.scoreRate * 100)}%` : "-"}
            </span>
          </div>
          <div className={styles.sessionMeta}>
            {state.decks.find((d) => d.deckId === s.deckId)?.title ?? s.deckId}{" "}
            ·{" "}
            {state.decks
              .find((d) => d.deckId === s.deckId)
              ?.lessons.find((l) => l.lessonId === s.lessonId)?.title ??
              s.lessonId}
          </div>
        </div>
      ))}
    </div>
  );
}
