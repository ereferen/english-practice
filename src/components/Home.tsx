import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import { systemClock } from "../domain/srs";
import { computeProgress, dailyGoalRate } from "../domain/progress";
import { allWords } from "../content/loader";
import styles from "./Home.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
}

export default function Home({ state, dispatch, storage }: Props) {
  const [due, setDue] = useState(0);
  // Issue #114: deck-by breakdown of due reviews ("どのデッキに何語溜まってるか")
  const [dueBreakdown, setDueBreakdown] = useState<
    { deckId: string; count: number }[]
  >([]);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [goal, setGoal] = useState(10);
  const [streak, setStreak] = useState(0);
  // issue #20: 未承認の改善提案数（Self-Improve有効時のみバッジ表示）
  const [pendingProposals, setPendingProposals] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const settings = await storage.loadSettings();
      const today = systemClock.today();
      const reviews = await storage.loadDueReviews(null, today);
      const count = await storage.countAnswersSince(`${today}T00:00:00.000Z`);
      const sessions = await storage.listSessions(200);
      const dates = sessions.map((s) => s.startedAt.slice(0, 10));
      let proposals = 0;
      if (settings.selfImproveEnabled) {
        proposals = (await storage.listProposals("pending")).length;
      }
      if (!mounted) return;
      setPendingProposals(proposals);
      setDue(reviews.length);
      // Issue #82: remember which deck owns most due reviews so the card
      // can jump straight to it.
      const byDeck = new Map<string, number>();
      for (const r of reviews) {
        byDeck.set(r.deckId, (byDeck.get(r.deckId) ?? 0) + 1);
      }
      // Issue #114: keep the per-deck breakdown (sorted desc) so the card can
      // show which deck holds the most due words.
      setDueBreakdown(
        Array.from(byDeck.entries())
          .map(([deckId, count]) => ({ deckId, count }))
          .sort((a, b) => b.count - a.count),
      );
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

  // Issue #82/#114: the "今日の復習" card is the answer to "what next?" —
  // when reviews are due, clicking it starts the cross-deck review session
  // directly (previously it only jumped to the top due deck's detail page,
  // which left aki stuck at the lesson list). With nothing due it goes to
  // the deck list as before.
  const handleReviewShortcut = () => {
    if (due > 0) {
      dispatch({ type: "go", screen: { name: "review" } });
    } else {
      dispatch({ type: "go", screen: { name: "deckList" } });
    }
  };
  const topDeckTitle = (() => {
    const top = dueBreakdown[0];
    if (!top) return null;
    return state.decks.find((d) => d.deckId === top.deckId)?.title ?? null;
  })();

  return (
    <div className="container">
      <div className="card">
        <h1>English Practice</h1>
        <p>ローカルに学習・復習・進捗を保存する英語学習アプリ</p>
        {pendingProposals > 0 && (
          <button
            type="button"
            className="badge"
            title="保留中の改善提案があります — ダッシュボードで承認/却下できます"
            onClick={() =>
              dispatch({ type: "go", screen: { name: "dashboard" } })
            }
          >
            ✨ 新しい改善提案があります（{pendingProposals}）
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-grid stats-grid">
          <button
            type="button"
            className={styles.statButton}
            onClick={handleReviewShortcut}
            title={
              due > 0
                ? "期限切れ語だけの復習セッションをすぐ開始"
                : "本日の復習はありません — デッキ一覧へ"
            }
          >
            <div className="badge">今日の復習</div>
            <div className={styles.statValue}>{due} 語</div>
            {/* Issue #108: name the number — SRS due cards vs. today's answers */}
            <div
              className={styles.statCaption}
              title="SRSで復習期限が来ている語の数"
            >
              復習期限中の語
            </div>
            {/* Issue #114: breakdown — which deck holds the due words */}
            {due > 0 && topDeckTitle && (
              <div
                className={styles.statCaption}
                data-testid="review-breakdown"
              >
                押すと復習開始 — 最多: {topDeckTitle} {dueBreakdown[0]?.count}語
                {dueBreakdown.length > 1
                  ? ` ほか ${dueBreakdown.length - 1} デッキ`
                  : ""}
              </div>
            )}
          </button>
          <div>
            <div className="badge">目標達成率</div>
            <div className={styles.statValue}>
              {Math.round(dailyGoalRate(summary) * 100)}%
            </div>
            {/* Issue #108: show the numerator/denominator so 100% has a meaning */}
            <div className={styles.statCaption}>
              今日 {summary.todayAnswered} / 目標 {summary.dailyGoalWords} 回答
            </div>
          </div>
          <div>
            <div className="badge">連続学習日</div>
            <div className={styles.statValue}>{streak} 日</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="menu-grid">
          <button
            className={`menu-item ${styles.menuButton}`}
            onClick={() =>
              dispatch({ type: "go", screen: { name: "deckList" } })
            }
          >
            デッキを選ぶ
          </button>
          <button
            className={`menu-item ${styles.menuButton}`}
            onClick={() =>
              dispatch({ type: "go", screen: { name: "dashboard" } })
            }
          >
            進捗ダッシュボード
          </button>
          <button
            className={`menu-item ${styles.menuButton}`}
            onClick={() =>
              dispatch({ type: "go", screen: { name: "conversation" } })
            }
          >
            英会話
          </button>
          <button
            className={`menu-item ${styles.menuButton}`}
            onClick={() =>
              dispatch({ type: "go", screen: { name: "settings" } })
            }
          >
            設定
          </button>
        </div>
      </div>
    </div>
  );
}
