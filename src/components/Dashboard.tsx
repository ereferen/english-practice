import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type {
  ImprovementAction,
  StorageProvider,
  SessionRecord,
} from "../storage/types";
import { allWords } from "../content/loader";
import { providersFromSettings } from "../domain/llm";
import {
  analyzeWeaknessWithLlm,
  buildWeaknessInput,
} from "../domain/weaknessAnalysis";
import type { WeaknessReport } from "../domain/weaknessAnalysis";
import {
  buildSrsOptimizationInput,
  proposeSrsParamsWithLlm,
  proposalToParams,
  isNoopProposal,
  SRS_OPTIMIZATION_MIN_ANSWERS,
} from "../domain/srsOptimization";
import type { SrsProposal } from "../domain/srsOptimization";
import {
  makeSrsApplyRecord,
  resolveSrsRollback,
} from "../domain/improvements";
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
  // issue #17: SRS最適化提案（承認するまで Settings には書かない）
  const [srsProposal, setSrsProposal] = useState<SrsProposal | null>(null);
  const [srsOptimizing, setSrsOptimizing] = useState(false);
  const [srsError, setSrsError] = useState<string | null>(null);
  const [srsApplied, setSrsApplied] = useState(false);
  const [srsProposalModel, setSrsProposalModel] = useState("");
  // issue #20: 改善アクションの履歴（承認→適用→ロールバックの監査ログ）
  const [improvements, setImprovements] = useState<ImprovementAction[]>([]);

  const reloadImprovements = async () => {
    setImprovements(await storage.listImprovementActions(20));
  };

  // Issue #16: 分析対象期間の開始日（表示用）
  const [windowStart] = useState(() => daysAgoDate(new Date(), 30));

  useEffect(() => {
    let mounted = true;
    (async () => {
      const list = await storage.listSessions(50);
      if (!mounted) return;
      setSessions(list);
      await reloadImprovements();
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

  const handleOptimizeSrs = async () => {
    setSrsOptimizing(true);
    setSrsError(null);
    setSrsApplied(false);
    try {
      const settings = await storage.loadSettings();
      const providers = providersFromSettings(settings);
      if (providers.length === 0) {
        throw new Error(
          "LLMが設定されていません。設定画面からAPIエンドポイントとモデルを登録してください。",
        );
      }
      const answers = await storage.listAnswersSince(windowStart);
      const input = buildSrsOptimizationInput({
        answers,
        params: settings.srsParams,
        today: new Date().toISOString().slice(0, 10),
      });
      const proposal = await proposeSrsParamsWithLlm({ providers, input });
      if (isNoopProposal(proposal, settings.srsParams)) {
        setSrsProposal(null);
        setSrsError(
          `現在のSRSパラメータは最適のようです（${proposal.rationale}）`,
        );
      } else {
        setSrsProposal(proposal);
        setSrsProposalModel(providers[0]?.label ?? "unknown");
      }
    } catch (e) {
      setSrsProposal(null);
      setSrsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSrsOptimizing(false);
    }
  };

  const handleApplySrsProposal = async () => {
    if (!srsProposal) return;
    try {
      const settings = await storage.loadSettings();
      // issue #20: 適用と監査ログ書き込みをセットで（previous スナップショット付き）
      const record = makeSrsApplyRecord({
        proposal: srsProposal,
        previous: settings.srsParams,
        model: srsProposalModel || "unknown",
      });
      await storage.saveSettings({ srsParams: proposalToParams(srsProposal) });
      await storage.saveImprovementAction(record);
      setSrsApplied(true);
      setSrsProposal(null);
      await reloadImprovements();
    } catch (e) {
      setSrsError(e instanceof Error ? e.message : String(e));
    }
  };

  // issue #20: 履歴からのロールバック（resolveSrsRollback が安全条件を検証）
  const handleRollback = async (target: ImprovementAction) => {
    setSrsError(null);
    try {
      const settings = await storage.loadSettings();
      const result = resolveSrsRollback(
        improvements,
        target.id,
        settings.srsParams,
      );
      if (!result.ok) {
        setSrsError(result.reason);
        return;
      }
      await storage.saveSettings({ srsParams: result.restore });
      await storage.saveImprovementAction({
        ...target,
        rolledBackAt: new Date().toISOString(),
      });
      await reloadImprovements();
    } catch (e) {
      setSrsError(e instanceof Error ? e.message : String(e));
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

      {/* Issue #17: SRSパラメータ最適化（提案→承認） */}
      <h3>SRS最適化</h3>
      <div className="card">
        <p className={styles.reportEmpty}>
          直近{SRS_OPTIMIZATION_MIN_ANSWERS}
          回以上の回答データから、復習間隔の調整案をLLMに提案させます。
          適用は「承認」を押したときだけ。
        </p>
        {srsOptimizing && (
          <div className={styles.reportEmpty}>
            <span className="loading-dots">提案生成中...</span>
          </div>
        )}
        {!srsOptimizing && srsError && (
          <div className={styles.reportError}>
            <span>{srsError}</span>
            <button
              className="ghost"
              onClick={() => setSrsError(null)}
              aria-label="SRSエラーを閉じる"
            >
              とじる
            </button>
          </div>
        )}
        {!srsOptimizing && srsApplied && (
          <p>✅ SRSパラメータを適用しました。今後の復習間隔に反映されます。</p>
        )}
        {!srsOptimizing && srsProposal && (
          <div className={styles.report}>
            <p className={styles.reportSummary}>{srsProposal.rationale}</p>
            <p>
              復習間隔:{" "}
              {srsProposal.intervalDays
                .map((d, i) => `L${i}=${d}日`)
                .join(" / ")}
              {" · "}
              L3誤答の降格先: L{srsProposal.level3WrongDemotesTo}（信頼度:{" "}
              {srsProposal.confidence}）
            </p>
            <div className={styles.sessionRow}>
              <button
                className="primary"
                onClick={() => void handleApplySrsProposal()}
              >
                承認して適用
              </button>
              <button className="ghost" onClick={() => setSrsProposal(null)}>
                却下
              </button>
            </div>
          </div>
        )}
        {!srsOptimizing && !srsProposal && (
          <button
            className={`primary ${styles.analyzeButton}`}
            onClick={() => void handleOptimizeSrs()}
          >
            {srsApplied ? "もう一度提案させる" : "SRS調整案を出してもらう"}
          </button>
        )}
      </div>

      {/* Issue #20: 改善履歴（承認→適用→ロールバックの監査ログ） */}
      <h3>改善履歴</h3>
      <div className="card">
        {improvements.length === 0 && (
          <p className={styles.reportEmpty}>
            まだ改善の適用履歴はありません。SRS最適化で提案を承認すると、
            ここに根拠・モデル・ロールバック先が記録されます。
          </p>
        )}
        {improvements.map((a) => (
          <div key={a.id} className={styles.sessionRow}>
            <div>
              <span className="badge">
                {a.category === "srs-params" ? "SRSパラメータ" : a.category}
              </span>{" "}
              {a.rationale}
              <div className={styles.sessionMeta}>
                {a.appliedAt.slice(0, 16).replace("T", " ")} · {a.model} ·{" "}
                間隔 {a.applied.intervalDays.join("/")}日 · 従来{" "}
                {a.previous.intervalDays.join("/")}日 に戻せる
              </div>
            </div>
            {a.rolledBackAt ? (
              <span className="badge">ロールバック済み</span>
            ) : (
              <button
                className="ghost"
                onClick={() => void handleRollback(a)}
              >
                ロールバック
              </button>
            )}
          </div>
        ))}
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
