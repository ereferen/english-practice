import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { GeneratedQuizSource, StorageProvider } from "../storage/types";
import { generateQuizzesForLesson, pickLesson } from "../content/loader";
import { buildSessionQuizItems, isCorrect } from "../domain/session";
import { uuid } from "../domain/uuid";
import type { AnswerRecord } from "../domain/session";
import {
  canGenerateToday,
  generateQuizzesWithLlm,
} from "../domain/quizGeneration";
import { providersFromSettings } from "../domain/llm";
import { systemClock } from "../domain/srs";
import { useKeyboardShortcuts } from "../app/useKeyboardShortcuts";
import styles from "./QuizScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  deckId: string;
  lessonId: string;
  /** LLM生成クイズモード（issue #15）。未指定なら静的デッキ内クイズ */
  gen?: GeneratedQuizSource;
}

export default function QuizScreen({
  state,
  dispatch,
  storage,
  deckId,
  lessonId,
  gen,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const lessonWithDeck = deck ? pickLesson(deck, lessonId) : undefined;
  const [startedAt] = useState(() => new Date().toISOString());
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const askedAtRef = useRef<number>(Date.now());
  // Issue #132: 進捗 in the header must answer "where am I in this session?"
  // without tearing the session down.
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const [pendingProgressNav, setPendingProgressNav] = useState(false);

  // LLM生成モード用の状態
  const [genPhase, setGenPhase] = useState<"idle" | "loading" | "ready">(
    gen ? "loading" : "ready",
  );
  const [genError, setGenError] = useState<string | null>(null);
  // Issue #116: empty-condition (no weak words yet) is a normal state, not a
  // generation failure — it gets a neutral card without the 設定を開く CTA.
  const [genNeutral, setGenNeutral] = useState(false);
  const [genQuizzes, setGenQuizzes] = useState<
    ReturnType<typeof buildSessionQuizItems>
  >([]);

  const items = useMemo(() => {
    if (!deck || gen) return []; // 生成モードは genQuizzes を使う
    const quizzes = generateQuizzesForLesson(deck, lessonId);
    return buildSessionQuizItems(quizzes, { shuffle: true });
  }, [deck, lessonId, gen]);

  useEffect(() => {
    askedAtRef.current = Date.now();
  }, [index]);

  useEffect(() => {
    if (!gen || !deck) return;
    let cancelled = false;
    setGenPhase("loading");
    setGenError(null);
    setGenNeutral(false);
    (async () => {
      // Issue #107: the whole preparation pipeline (settings load, weak-word
      // query, generation) must be guarded. A throw anywhere below used to
      // leave genPhase stuck at "loading" → infinite spinner with no way
      // out but キャンセル.
      try {
        const settings = await storage.loadSettings();
        const providers = providersFromSettings(settings);
        if (providers.length === 0) {
          if (!cancelled)
            setGenError(
              "LLMが設定されていません。設定画面からAPIエンドポイントとモデルを登録してください。",
            );
          if (!cancelled) setGenPhase("idle");
          return;
        }
        // 頻度制御: 同一レッスンの当日生成が上限を超えたら警告
        const history = await storage.listGeneratedQuizzes(deckId, lessonId);
        if (!canGenerateToday(history, deckId, lessonId, systemClock.today())) {
          if (!cancelled)
            setGenError(
              "本日の生成回数の上限に達しました。時間をおいてから再試行してください。",
            );
          if (!cancelled) setGenPhase("idle");
          return;
        }
        let focusWordIds: string[] | undefined;
        if (gen === "llm-wrong-focus") {
          const weak = await storage.loadWeakWords(200);
          const lessonWordIds = new Set(
            deck.lessons
              .find((l) => l.lessonId === lessonId)
              ?.words.map((w) => w.wordId) ?? [],
          );
          focusWordIds = weak
            .filter((r) => r.deckId === deckId && lessonWordIds.has(r.wordId))
            .map((r) => r.wordId);
          if (focusWordIds.length === 0) {
            if (!cancelled)
              setGenError(
                "このレッスンに苦手語（誤答2回以上）はまだありません。先に学習・クイズをこなしましょう。",
              );
            // Issue #116: normal empty state, not a failure.
            if (!cancelled) setGenNeutral(true);
            if (!cancelled) setGenPhase("idle");
            return;
          }
        }
        const set = await generateQuizzesWithLlm({
          providers,
          deck,
          lessonId,
          source: gen,
          focusWordIds,
          model: providers[0].model,
        });
        await storage.saveGeneratedQuiz(set);
        if (!cancelled) {
          setGenQuizzes(buildSessionQuizItems(set.quizzes, { shuffle: true }));
          setGenPhase("ready");
        }
      } catch (e) {
        if (!cancelled) setGenError(e instanceof Error ? e.message : String(e));
        if (!cancelled) setGenPhase("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gen, deck, deckId, lessonId, storage]);

  const activeItems = gen ? genQuizzes : items;
  const current = activeItems[index];
  const isLast = index === activeItems.length - 1;

  const handleChooseById = (choiceId: string | undefined) => {
    if (!current || !choiceId || showFeedback) return;
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

    void storage.recordAnswer({
      id: uuid(),
      sessionId: `${deckId}-${lessonId}-${startedAt}`,
      wordId: current.wordId,
      askedAt: new Date().toISOString(),
      correct,
      latencyMs,
    });
  };

  const handleNext = () => {
    if (!current) return;
    if (isLast) {
      dispatch({
        type: "finishQuiz",
        deckId,
        lessonId,
        answers,
        startedAt,
      });
    } else {
      setIndex((i) => i + 1);
      setShowFeedback(false);
      setLastCorrect(null);
    }
  };

  // Keyboard shortcuts (issue #9): 1-4 to answer, Enter/→ to advance, Esc to abort.
  useKeyboardShortcuts({
    "1": () => handleChooseById(current?.choices[0]?.choiceId),
    "2": () => handleChooseById(current?.choices[1]?.choiceId),
    "3": () => handleChooseById(current?.choices[2]?.choiceId),
    "4": () => handleChooseById(current?.choices[3]?.choiceId),
    Enter: () => (showFeedback ? handleNext() : undefined),
    ArrowRight: () => (showFeedback ? handleNext() : undefined),
    Escape: () =>
      dispatch({ type: "go", screen: { name: "deckHome", deckId } }),
  });

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

  if (gen && genPhase === "loading") {
    return (
      <div className="container">
        <div className="card">
          <p aria-live="polite">
            LLMが問題を生成中です…（数十秒かかることがあります）
          </p>
          <button
            className="ghost"
            onClick={() =>
              dispatch({ type: "go", screen: { name: "deckHome", deckId } })
            }
          >
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  if (gen && genPhase === "idle") {
    if (genNeutral) {
      // Issue #116: "no weak words yet" is the normal empty state. Neutral
      // heading, no red error face, no 設定を開く CTA.
      return (
        <div className="container">
          <div className="card">
            <h3>まだ苦手語はありません</h3>
            <p aria-live="polite">{genError}</p>
            <button
              className="primary"
              onClick={() =>
                dispatch({ type: "go", screen: { name: "deckHome", deckId } })
              }
            >
              戻る
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="container">
        <div className="card">
          <h3>生成に失敗しました</h3>
          <p aria-live="polite">{genError ?? "不明なエラー"}</p>
          {/* Issue #107: same recovery path as the conversation screen (#73) */}
          <div className={styles.failureActions}>
            <button
              onClick={() =>
                dispatch({ type: "go", screen: { name: "deckHome", deckId } })
              }
            >
              戻る
            </button>
            <button
              className="ghost"
              onClick={() =>
                dispatch({ type: "go", screen: { name: "settings" } })
              }
            >
              設定を開く
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeItems.length === 0) {
    // Issue #134: this used to be a dead end ("クイズがありません" + 戻る).
    // Say WHY, and point at the one action that actually unlocks a quiz:
    // generating supplemental items from the deck screen.
    return (
      <div className="container">
        <div className="card">
          <h3>クイズがありません</h3>
          <p aria-live="polite">
            クイズには4語以上必要です。このレッスンは現在
            {lessonWithDeck?.lesson.words.length ?? 0}
            語です。
          </p>
          <p className={styles.hint}>
            「✨ LLMで補充問題を生成」を使うと、このデッキに語と問題を追加でき、
            少ない語数のデッキでもそのままクイズを始められます。
          </p>
          <div className={styles.failureActions}>
            <button
              className="primary"
              onClick={() =>
                dispatch({ type: "go", screen: { name: "deckHome", deckId } })
              }
            >
              ✨ デッキ画面で補充問題を生成する
            </button>
            <button
              className="ghost"
              onClick={() =>
                dispatch({ type: "go", screen: { name: "deckHome", deckId } })
              }
            >
              戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="nav-header">
        <h2>
          クイズ{" "}
          <span className={styles.progressCount}>
            ({index + 1}/{activeItems.length})
          </span>
        </h2>
        {/* Issue #75: consistent exit label across study screens */}
        <button
          className="ghost"
          onClick={() =>
            dispatch({ type: "go", screen: { name: "deckHome", deckId } })
          }
        >
          戻る
        </button>
        <button
          className="ghost"
          onClick={() => {
            setShowSessionInfo((v) => !v);
            setPendingProgressNav(false);
          }}
          aria-expanded={showSessionInfo}
          aria-controls="session-info"
          data-testid="quiz-progress-button"
        >
          進捗
        </button>
      </div>

      {/* Issue #132: quiz progress is answered right here — leaving the
          screen used to throw away the whole session. */}
      {showSessionInfo && (
        <div
          className={`card ${styles.sessionInfo}`}
          id="session-info"
          role="status"
          aria-live="polite"
        >
          <h3 className={styles.sessionInfoTitle}>このセッションの進み具合</h3>
          <ul className={styles.sessionInfoList}>
            <li>
              クイズ {index + 1}/{activeItems.length} 問目
            </li>
            <li>
              正答 {answers.filter((a) => a.correct).length}/{answers.length}{" "}
              問（回答済み）
            </li>
          </ul>
          {pendingProgressNav ? (
            <>
              <p className={styles.sessionInfoWarn} role="alert">
                ⚠ 「学習の記録」を開くとこのクイズは閉じます（
                {index + 1}/{activeItems.length}
                問目から再開はできません）。このセッションを続けますか？
              </p>
              <div className={styles.failureActions}>
                <button
                  className="primary"
                  onClick={() => {
                    setPendingProgressNav(false);
                    setShowSessionInfo(false);
                  }}
                >
                  このセッションを続ける
                </button>
                <button
                  className="ghost"
                  onClick={() =>
                    dispatch({ type: "go", screen: { name: "progress" } })
                  }
                >
                  それでも記録を見る
                </button>
              </div>
            </>
          ) : (
            <div className={styles.failureActions}>
              <button
                className="primary"
                onClick={() => setShowSessionInfo(false)}
              >
                クイズに戻る
              </button>
              <button
                className="ghost"
                onClick={() => setPendingProgressNav(true)}
                data-testid="quiz-open-record"
              >
                学習の記録を開く
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <p className={`quiz-prompt ${styles.prompt}`}>{current.prompt}</p>
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
          {current.explanation && !lastCorrect && <p>{current.explanation}</p>}
          <button
            className={`primary ${styles.nextButton}`}
            onClick={handleNext}
          >
            {isLast ? "結果を見る" : "次へ"}
          </button>
        </div>
      )}
    </div>
  );
}
