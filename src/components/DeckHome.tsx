import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider, ReviewState } from "../storage/types";
import { allWords } from "../content/loader";
import { systemClock } from "../domain/srs";
import { computeProgress } from "../domain/progress";
import { localProgress } from "../storage/localProgress";
import styles from "./DeckHome.module.css";

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
  // Issue #106: 学習率は Dexie の review.level>0 と、localStorage に積まれる
  // フラッシュ学習済み語（markLearned）の和集合で数える。以前は review 側
  // だけを見ていたため、SRS 保存が失敗/未完了だとリロード後に 0% へ逆戻りし、
  // localStorage 側のホーム/ダッシュボード数値と食い違っていた。
  const flashLearned = localProgress
    .load()
    .learnedWords.filter((w) => w.deckId === deckId).length;
  const learnedWords = Math.max(summary.learnedWords, flashLearned);
  const completion =
    summary.totalWords > 0
      ? Math.round((learnedWords / summary.totalWords) * 100)
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
        <div className={styles.metaRow}>
          <span className="badge">{deck.level}</span>
          <span className="badge-gold">学習率 {completion}%</span>
        </div>
        {/* Issue #114: direct entry into a review session for this deck's
            due words — previously the only path was per-lesson 学習・クイズ. */}
        {summary.dueToday > 0 && (
          <button
            className="primary"
            data-testid="deck-review-button"
            onClick={() =>
              dispatch({ type: "go", screen: { name: "review", deckId } })
            }
          >
            このデッキの復習（{summary.dueToday}語）
          </button>
        )}
        {/* Issue #48: DESIGN.md progress-track (amber fill on inset rail) */}
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={completion}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="学習率"
        >
          <div className="progress-fill" style={{ width: `${completion}%` }} />
        </div>
      </div>

      <h3>レッスン一覧</h3>
      <div className="card-grid">
        {deck.lessons.map((lesson) => (
          <div key={lesson.lessonId} className="card">
            <div className={styles.lessonRow}>
              <div>
                <strong>{lesson.title}</strong>
                <p className={styles.lessonCount}>{lesson.words.length} 語</p>
              </div>
              <button
                className="menu-item menu-item--compact"
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
              <div className={styles.genRow}>
                <button
                  className="ghost"
                  onClick={() =>
                    dispatch({
                      type: "startGeneratedQuiz",
                      deckId,
                      lessonId: lesson.lessonId,
                      gen: "llm-supplement",
                    })
                  }
                >
                  ✨ LLMで補充問題を生成
                </button>
                <button
                  className="ghost"
                  onClick={() =>
                    dispatch({
                      type: "startGeneratedQuiz",
                      deckId,
                      lessonId: lesson.lessonId,
                      gen: "llm-wrong-focus",
                    })
                  }
                >
                  🎯 苦手語集中トレーニング
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
