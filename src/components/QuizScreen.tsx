import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider } from "../storage/types";
import { generateQuizzesForLesson, pickLesson } from "../content/loader";
import { buildSessionQuizItems, isCorrect } from "../domain/session";
import type { AnswerRecord } from "../domain/session";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  deckId: string;
  lessonId: string;
}

export default function QuizScreen({
  state,
  dispatch,
  storage,
  deckId,
  lessonId,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const lessonWithDeck = deck ? pickLesson(deck, lessonId) : undefined;
  const [startedAt] = useState(() => new Date().toISOString());
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const askedAtRef = useRef<number>(Date.now());

  const items = useMemo(() => {
    if (!deck) return [];
    const quizzes = generateQuizzesForLesson(deck, lessonId);
    return buildSessionQuizItems(quizzes, { shuffle: true });
  }, [deck, lessonId]);

  useEffect(() => {
    askedAtRef.current = Date.now();
  }, [index]);

  if (!deck || !lessonWithDeck) {
    return (
      <div className="container">
        <p>レッスンが見つかりません</p>
        <button
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          戻る
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container">
        <p>クイズがありません。デッキに4語以上必要です。</p>
        <button
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          戻る
        </button>
      </div>
    );
  }

  const current = items[index];
  const isLast = index === items.length - 1;

  const handleChoose = async (choiceId: string) => {
    if (showFeedback) return;
    const correct = isCorrect(current, choiceId);
    const latencyMs = Date.now() - askedAtRef.current;
    const record: AnswerRecord = {
      quizId: current.quizId,
      wordId: current.wordId,
      choiceId,
      correct,
      latencyMs,
    };
    setAnswers((prev) => [...prev, record]);
    setLastCorrect(correct);
    setShowFeedback(true);

    await storage.recordAnswer({
      id: crypto.randomUUID(),
      sessionId: `${deckId}-${lessonId}-${startedAt}`,
      wordId: current.wordId,
      askedAt: new Date().toISOString(),
      correct,
      latencyMs,
    });
  };

  const handleNext = () => {
    if (isLast) {
      dispatch({
        type: "finishQuiz",
        deckId,
        lessonId,
        answers,
      });
    } else {
      setIndex((i) => i + 1);
      setShowFeedback(false);
      setLastCorrect(null);
    }
  };

  return (
    <div className="container">
      <div className="nav-header">
        <h2>
          クイズ ({index + 1}/{items.length})
        </h2>
        <button
          className="ghost"
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          中断
        </button>
        <button
          className="ghost"
          onClick={() => dispatch({ type: "go", screen: { name: "progress" } })}
        >
          進捗
        </button>
      </div>

      <div className="card">
        <p className="quiz-prompt" style={{ marginBottom: "1rem" }}>
          {current.prompt}
        </p>
        <div className="choice-grid">
          {current.choices.map((choice, idx) => {
            const isAnswer =
              showFeedback && choice.choiceId === current.answerChoiceId;
            const isWrongPick =
              showFeedback &&
              lastCorrect === false &&
              choice.choiceId === answers[answers.length - 1]?.choiceId;
            return (
              <button
                key={choice.choiceId}
                disabled={showFeedback}
                onClick={() => handleChoose(choice.choiceId)}
                aria-label={`選択肢 ${idx + 1}: ${choice.text}`}
                className={[
                  isAnswer ? "choice-correct" : "",
                  isWrongPick ? "choice-wrong" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  background: isAnswer
                    ? "var(--color-success)"
                    : isWrongPick
                      ? "var(--color-danger)"
                      : undefined,
                  color: isAnswer || isWrongPick ? "#0f172a" : undefined,
                }}
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
          {current.explanation && !lastCorrect && <p>{current.explanation}</p>}
          <button
            className="primary"
            onClick={handleNext}
            style={{ width: "100%" }}
          >
            {isLast ? "結果を見る" : "次へ"}
          </button>
        </div>
      )}
    </div>
  );
}
