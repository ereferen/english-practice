import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import { buildReviewItems, type ReviewItem } from "../domain/review";
import { isCorrect, scoreRate, type AnswerRecord } from "../domain/session";
import { nextReviewState, systemClock } from "../domain/srs";
import { uuid } from "../domain/uuid";
import { useKeyboardShortcuts } from "../app/useKeyboardShortcuts";
import styles from "./QuizScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  /** Issue #114: 指定時はそのデッキの期限切れ語のみでセッションを組む */
  deckId?: string;
}

/**
 * Issue #114: 「今日の復習」から直入する復習セッション。SRSで復習期限が
 * 来ている語だけをデッキ・レッスンの壁を越えて1問ずつ出題し、回答その
 * つど SRS 状態（saveReview）と AnswerEvent（recordAnswer）へ反映する。
 * 既存の Quiz→Result 導線と違い、完了はその場でサマリ表示する。
 */
export default function ReviewSession({
  state,
  dispatch,
  storage,
  deckId,
}: Props) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [dueTotal, setDueTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [finished, setFinished] = useState(false);
  const [startedAt] = useState(() => new Date().toISOString());
  const askedAtRef = useRef<number>(Date.now());
  const sessionId = useMemo(() => uuid(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = systemClock.today();
      const reviews = await storage.loadDueReviews(deckId ?? null, today);
      if (cancelled) return;
      setDueTotal(reviews.length);
      setItems(buildReviewItems(state.decks, reviews));
    })().catch(() => {
      if (!cancelled) setItems([]);
    });
    return () => {
      cancelled = true;
    };
    // decks are loaded once per screen mount by design (App fetches before render)
  }, [deckId]);

  useEffect(() => {
    askedAtRef.current = Date.now();
  }, [index]);

  const current = items?.[index];
  const isLast = items ? index === items.length - 1 : false;

  // deckId 指定（DeckHome 入口）ならそのデッキ詳細へ、横断セッションならホームへ戻る
  const goBack: Action = deckId
    ? { type: "go", screen: { name: "deckHome", deckId } }
    : { type: "go", screen: { name: "home" } };

  const handleChooseById = (choiceId: string | undefined) => {
    if (!current || !choiceId || showFeedback) return;
    const correct = isCorrect(current.item, choiceId);
    const latencyMs = Date.now() - askedAtRef.current;
    const record: AnswerRecord = {
      quizId: current.item.quizId,
      wordId: current.item.wordId,
      choiceId,
      correct,
      latencyMs,
    };
    setAnswers((prev) => [...prev, record]);
    setLastCorrect(correct);
    setShowFeedback(true);

    void (async () => {
      const settings = await storage.loadSettings();
      const existing = await storage.loadReview(
        current.deckId,
        current.item.wordId,
      );
      const updated = nextReviewState(
        existing,
        correct,
        systemClock,
        settings.srsParams,
      );
      await storage.saveReview({
        deckId: current.deckId,
        wordId: current.item.wordId,
        level: updated.level,
        lastResult: updated.lastResult,
        lastSeenAt: updated.lastSeenAt,
        dueAt: updated.dueAt,
        correctStreak: updated.correctStreak,
        wrongTotal: updated.wrongTotal,
      });
      await storage.recordAnswer({
        id: uuid(),
        sessionId,
        wordId: current.item.wordId,
        askedAt: new Date().toISOString(),
        correct,
        latencyMs,
      });
    })().catch(() => {});
  };

  const handleNext = () => {
    if (!current) return;
    if (isLast) {
      setFinished(true);
      const endedAt = new Date().toISOString();
      const rate = scoreRate([...answers]);
      void storage
        .startSession({
          id: sessionId,
          deckId: current.deckId,
          lessonId: "review",
          startedAt,
          endedAt,
          kind: "review",
          scoreRate: rate,
        })
        .catch(() => {});
    } else {
      setIndex((i) => i + 1);
      setShowFeedback(false);
      setLastCorrect(null);
    }
  };

  useKeyboardShortcuts({
    "1": () => handleChooseById(current?.item.choices[0]?.choiceId),
    "2": () => handleChooseById(current?.item.choices[1]?.choiceId),
    "3": () => handleChooseById(current?.item.choices[2]?.choiceId),
    "4": () => handleChooseById(current?.item.choices[3]?.choiceId),
    Enter: () => (showFeedback ? handleNext() : undefined),
    ArrowRight: () => (showFeedback ? handleNext() : undefined),
    Escape: () => dispatch(goBack),
  });

  if (!items) {
    return (
      <div className="container">
        <div className="card">
          <p aria-live="polite">復習語を準備中です…</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container">
        <div className="card">
          <h2>復習する語はありません</h2>
          <p>
            {dueTotal > 0
              ? "復習期限の語が見つかりましたが、デッキの語と対応づけできませんでした。デッキ一覧から学習を始めましょう。"
              : "今日の復習はすべて終わっています。お疲れさまでした！"}
          </p>
          <button
            className="primary"
            onClick={() =>
              dispatch({ type: "go", screen: { name: "deckList" } })
            }
          >
            デッキ一覧へ
          </button>
        </div>
      </div>
    );
  }

  if (finished) {
    const rate = scoreRate(answers);
    return (
      <div className="container">
        <div className="nav-header">
          <h2>復習セッション完了</h2>
        </div>
        <div className="card">
          <p className="stat-value" data-testid="review-score">
            {Math.round(rate * 100)}%
          </p>
          <p>
            {answers.length} 語中 {answers.filter((a) => a.correct).length}{" "}
            語正解
          </p>
          <div className="menu-grid">
            <button className="menu-item" onClick={() => dispatch(goBack)}>
              戻る
            </button>
            <button
              className="menu-item"
              onClick={() =>
                dispatch({ type: "go", screen: { name: "dashboard" } })
              }
            >
              進捗ダッシュボード
            </button>
          </div>
        </div>
      </div>
    );
  }

  const item = current?.item;
  if (!item) {
    return (
      <div className="container">
        <div className="card">
          <p>復習語の表示に失敗しました。ホームからやり直してください。</p>
          <button
            className="primary"
            onClick={() => dispatch({ type: "go", screen: { name: "home" } })}
          >
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="container">
      <div className="nav-header">
        <h2>
          復習セッション{" "}
          <span className={styles.progressCount}>
            ({index + 1}/{items.length})
          </span>
        </h2>
        <button className="ghost" onClick={() => dispatch(goBack)}>
          やめる
        </button>
      </div>

      <div className="card">
        <p className={`quiz-prompt ${styles.prompt}`}>{item.prompt}</p>
        <div className="choice-grid">
          {item.choices.map((choice, idx) => {
            const isAnswer =
              showFeedback && choice.choiceId === item.answerChoiceId;
            const isWrongPick =
              showFeedback &&
              lastCorrect === false &&
              choice.choiceId === answers[answers.length - 1]?.choiceId;
            return (
              <button
                key={choice.choiceId}
                disabled={showFeedback}
                onClick={() => handleChooseById(choice.choiceId)}
                aria-label={`選択肢 ${idx + 1}: ${choice.text}`}
                aria-current={isAnswer ? "true" : undefined}
                className={[
                  "menu-item",
                  isAnswer ? "choice-correct" : "",
                  isWrongPick ? "choice-wrong" : "",
                  isAnswer ? styles.choiceCorrect : "",
                  isWrongPick ? styles.choiceWrong : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="choice-marker" aria-hidden="true">
                  {isAnswer ? "✓" : isWrongPick ? "✗" : idx + 1}
                </span>
                {choice.text}
              </button>
            );
          })}
        </div>
      </div>

      {showFeedback && (
        <div className="card">
          <p className={lastCorrect ? "correct" : "wrong"} aria-live="polite">
            {lastCorrect ? "○ 正解" : "× 不正解"}
          </p>
          {item.explanation && !lastCorrect && <p>{item.explanation}</p>}
          <button
            className={`primary ${styles.nextButton}`}
            onClick={handleNext}
          >
            {isLast ? "完了する" : "次へ"}
          </button>
        </div>
      )}
    </div>
  );
}
