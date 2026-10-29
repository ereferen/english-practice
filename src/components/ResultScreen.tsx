import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import type { AnswerRecord } from "../domain/session";
import { scoreRate, wrongWordIds } from "../domain/session";
import { nextReviewState, systemClock } from "../domain/srs";
import { wordById } from "../content/loader";
import { speak } from "../domain/speech";
import { useSpeechSupport } from "../domain/useSpeechSupport";
import { uuid } from "../domain/uuid";
import { localProgress } from "../storage/localProgress";
import type { LocalProgressStore } from "../storage/localProgress";
import { useCountUp } from "../app/useCountUp";
import styles from "./ResultScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  deckId: string;
  lessonId: string;
  answers: AnswerRecord[];
  /** Issue #105: ISO timestamp of quiz start (wall-clock session time). */
  startedAt?: string;
  /** Issue #96: injectable for tests; defaults to the shared store. */
  progress?: LocalProgressStore;
}

/** Issue #96: rim colour tier by score — gold >= 90%, silver >= 60%,
 *  parchment below. */
function rimTier(rate: number): "gold" | "silver" | "parchment" {
  if (rate >= 0.9) return "gold";
  if (rate >= 0.6) return "silver";
  return "parchment";
}

export default function ResultScreen({
  state,
  dispatch,
  storage,
  deckId,
  lessonId,
  answers,
  startedAt,
  progress = localProgress,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const rate = scoreRate(answers);
  const displayRate = useCountUp(Math.round(rate * 100), 600);
  // Issue #131: 音声が使えない環境で誤答語の ▶ が無反応だと「押せたのか
  // どうか」すら分からない。フラッシュカード／英会話と同じ案内を出す。
  const speechAvail = useSpeechSupport();
  const [ttsNotice, setTtsNotice] = useState(false);

  const handleSpeak = (text: string) => {
    if (speak(text)) return;
    setTtsNotice(true);
    window.setTimeout(() => setTtsNotice(false), 2500);
  };

  // Issue #235: 音声が無い環境では「音声未対応」の案内が静的（ヘッダ下）と
  // 動的（🔇 押下後）の2箇所に同じ文言で出ていた。表示は1箇所にまとめる。
  const showTtsNotice = speechAvail !== "ready" || ttsNotice;

  // Issue #96: compare against the previous best BEFORE this session is
  // recorded (the effect below writes it). No past sessions => no badge.
  const [isRecord, setIsRecord] = useState<boolean | null>(null);

  useEffect(() => {
    if (!deck) return;
    // Issue #229: 1 問も答えずに結果画面へ来た場合（クイズ 0 問のレッスンや
    // 空のセッション）は、0% のセッションとして記録しない。何も答えていない
    // のに履歴とセッション数が増えると、ダッシュボードが「今日サボった」印象
    // だけを残してしまう。
    if (answers.length === 0) return;
    const endedAt = new Date().toISOString();
    // Issue #232: startedAt を endedAt で埋めていたため、全問不正解で完走した
    // 回も `startedAt === endedAt && scoreRate === 0` になり、#229 の「回答0件
    // の中断」判定でダッシュボードから消えていた。実際の開始時刻を残す
    // （呼び出し側が渡さない場合は回答レイテンシ合計から逆算する）。
    const sessionStartedAt =
      startedAt ??
      new Date(
        Date.parse(endedAt) -
          Math.max(1000, answers.reduce((sum, a) => sum + a.latencyMs, 0)),
      ).toISOString();
    try {
      const prev = progress.load();
      const prevBest = prev.sessions.reduce(
        (best, s) =>
          s.askedCount > 0
            ? Math.max(best, s.correctCount / s.askedCount)
            : best,
        -1,
      );
      setIsRecord(prevBest >= 0 && rate > prevBest);
    } catch {
      setIsRecord(null);
    }
    const sessionId = uuid();
    storage
      .startSession({
        id: sessionId,
        deckId,
        lessonId,
        startedAt: sessionStartedAt,
        endedAt,
        kind: "learn",
        scoreRate: scoreRate(answers),
      })
      .catch(() => {});

    // Persist to localStorage progress store (survives page reload)
    progress.recordSession({
      askedCount: answers.length,
      correctCount: answers.filter((a) => a.correct).length,
      answeredAt: endedAt,
    });
    progress.saveQuizResults(
      deckId,
      lessonId,
      answers.map((a) => ({
        quizId: a.quizId,
        wordId: a.wordId,
        correct: a.correct,
      })),
    );

    (async () => {
      // issue #17: ユーザー承認済みの SRS パラメータを復習間隔に反映
      const settings = await storage.loadSettings();
      for (const a of answers) {
        const existing = await storage.loadReview(deckId, a.wordId);
        const updated = nextReviewState(
          existing,
          a.correct,
          systemClock,
          settings.srsParams,
        );
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
  }, [deck, deckId, lessonId, answers, storage, progress, rate]);

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

  // Issue #105: real wall-clock session time. The old sum of per-answer
  // latencies only counted thinking time between options (an 18-question
  // session shown as "4秒"), ignoring prompt reading and navigation.
  const elapsedSec = (() => {
    if (startedAt) {
      const start = Date.parse(startedAt);
      if (!Number.isNaN(start)) {
        return Math.max(0, Math.round((Date.now() - start) / 1000));
      }
    }
    return Math.round(answers.reduce((sum, a) => sum + a.latencyMs, 0) / 1000);
  })();
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
        <div className={`result-rate ${styles[`rim-${rimTier(rate)}`]}`}>
          {displayRate}%
        </div>
        {isRecord && (
          <div className={styles.newRecordBadge} aria-label="自己新記録">
            NEW RECORD
          </div>
        )}
        <p>
          正解 {answers.filter((a) => a.correct).length} / {answers.length} 問
        </p>
        <p className="result-time">セッション時間 {sessionTime}</p>
      </div>

      {wrongWords.length > 0 && (
        <div className="card">
          <h3>誤答した語</h3>
          {showTtsNotice && (
            <p className={styles.ttsNotice} role="status" aria-live="polite">
              このブラウザは音声未対応です（TTSボイスがありません）
            </p>
          )}
          <ul className="wrong-words-grid">
            {wrongWords.map((w) => (
              <li key={w.wordId} className="wrong-word">
                <div className="wrong-word-head">
                  <strong>{w.term}</strong>
                  {w.reading && (
                    <span className={styles.wrongWordReading}>
                      （{w.reading}）
                    </span>
                  )}
                  {w.ipa && (
                    <span className={styles.wrongWordIpa}>{w.ipa}</span>
                  )}
                  <span className="wrong-word-meaning">{w.meaning}</span>
                  <button
                    className="ghost"
                    aria-label={`${w.term} の発音を再生`}
                    title={
                      speechAvail === "ready"
                        ? "発音再生"
                        : "このブラウザは音声未対応（TTSボイス0個）"
                    }
                    onClick={() => handleSpeak(w.term)}
                  >
                    {speechAvail === "ready" ? "▶" : "🔇"}
                  </button>
                </div>
                {/* Issue #235: 答え合わせ画面と揃えて、例文と和訳も出す。
                    誤答語は「今日いちばん覚えたい語」なので、デッキへ
                    戻らないと読み・例文が分からない状態をやめる。 */}
                {w.examples[0] && (
                  <div className={styles.wrongWordExample}>
                    <div>{w.examples[0].en}</div>
                    {w.examples[0].ja && (
                      <div className={styles.wrongWordExampleJa}>
                        {w.examples[0].ja}
                      </div>
                    )}
                  </div>
                )}
                {w.note && (
                  <p className={styles.wrongWordNote}>ノート: {w.note}</p>
                )}
              </li>
            ))}
          </ul>
          {/* Issue #194: 誤答語は「今日いちばん覚えたい語」なのに、ここから
              やり直す導線が無く、カードを全枚めくり直す必要があった。 */}
          <div className={styles.retryActions}>
            <button
              className={`primary ${styles.retryButton}`}
              onClick={() =>
                dispatch({
                  type: "go",
                  screen: {
                    name: "quiz",
                    deckId,
                    lessonId,
                    focusWordIds: wrongIds,
                  },
                })
              }
            >
              🔁 誤答した {wrongIds.length} 語だけをもう一度
            </button>
            <button
              className={`ghost ${styles.retryButton}`}
              onClick={() =>
                dispatch({
                  type: "go",
                  screen: {
                    name: "flash",
                    deckId,
                    lessonId,
                    focusWordIds: wrongIds,
                  },
                })
              }
            >
              🃏 誤答した {wrongIds.length} 語をカードで確認
            </button>
          </div>
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
