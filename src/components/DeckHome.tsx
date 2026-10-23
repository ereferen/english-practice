import { useEffect, useState } from "react";
import type { AppState, Action } from "../app/types";
import type { StorageProvider, ReviewState } from "../storage/types";
import type { Deck, Word } from "../content/schema";
import { allWords } from "../content/loader";
import { systemClock } from "../domain/srs";
import { computeProgress } from "../domain/progress";
import {
  editDeckWord,
  isOwnDeck,
  removeDeckWord,
  renameDeck,
  type ManualWordInput,
} from "../domain/manualDeck";
import { localProgress } from "../storage/localProgress";
import {
  PART_OF_SPEECH_LABELS,
  partOfSpeechFromInput,
  partOfSpeechLabel,
} from "../domain/partOfSpeech";
import ConfirmDialog from "./ConfirmDialog";
import { LLM_REQUIRED_TOOLTIP, llmReadiness } from "../domain/llm";
import styles from "./DeckHome.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  storage: StorageProvider;
  deckId: string;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function DeckHome({ state, dispatch, storage, deckId }: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [goal, setGoal] = useState(10);
  // Issue #209: LLM未設定のまま「補充問題を生成」を押してエラー画面に飛ぶのを
  // 防ぐ。英会話と同じ判定（接続テスト成功済みか）を共有する。
  const [llmReady, setLlmReady] = useState(false);

  // Issue #181: 自分のデッキを後から直す（名前変更・語の編集・語の削除）。
  const [titleDraft, setTitleDraft] = useState("");
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [wordDraft, setWordDraft] = useState<ManualWordInput>({
    term: "",
    meaning: "",
    example: "",
  });
  const [wordError, setWordError] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [pendingDeleteWord, setPendingDeleteWord] = useState<Word | null>(null);
  const [confirmDeleteDeck, setConfirmDeleteDeck] = useState(false);

  useEffect(() => {
    setTitleDraft(deck?.title ?? "");
  }, [deck?.deckId, deck?.title]);

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
      setLlmReady(llmReadiness(settings).ready);
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

  const editable = isOwnDeck(deck);
  const words = deck.lessons[0]?.words ?? [];

  /** 編集結果を保存し、一覧の deck も差し替える（自分のデッキのみ呼ぶ）。 */
  const persistDeck = async (next: Deck) => {
    const now = new Date().toISOString();
    await storage.saveUserDeck({
      deckId: next.deckId,
      deck: next,
      sourceTurns: 0,
      createdAt: now,
      updatedAt: now,
    });
    dispatch({
      type: "setDecks",
      decks: state.decks.map((d) => (d.deckId === next.deckId ? next : d)),
    });
  };

  const handleRename = async () => {
    setDeckError(null);
    const next = renameDeck(deck, titleDraft);
    if (next.title === deck.title) return;
    try {
      await persistDeck(next);
    } catch (e) {
      setDeckError(message(e));
    }
  };

  const startEditWord = (w: Word) => {
    setWordError(null);
    setEditingWordId(w.wordId);
    setWordDraft({
      term: w.term,
      meaning: w.meaning,
      example: w.examples[0]?.en ?? "",
      // Issue #191: "—" はプレースホルダ（＝未設定）なので空欄で見せる。
      reading: w.reading && w.reading !== "—" ? w.reading : "",
      partOfSpeech: w.partOfSpeech,
    });
  };

  const handleSaveWord = async (wordId: string) => {
    setWordError(null);
    const result = editDeckWord(deck, wordId, wordDraft);
    if (!result.ok) {
      setWordError(result.error);
      return;
    }
    try {
      await persistDeck(result.deck);
      setEditingWordId(null);
    } catch (e) {
      setWordError(message(e));
    }
  };

  const handleDeleteWord = async (target: Word) => {
    setPendingDeleteWord(null);
    setWordError(null);
    const result = removeDeckWord(deck, target.wordId);
    if (!result.ok) {
      setWordError(result.error);
      return;
    }
    try {
      await persistDeck(result.deck);
    } catch (e) {
      setWordError(message(e));
    }
  };

  const handleDeleteDeck = async () => {
    setConfirmDeleteDeck(false);
    try {
      await storage.deleteUserDeck(deck.deckId);
    } catch (e) {
      setDeckError(message(e));
      return;
    }
    dispatch({
      type: "setDecks",
      decks: state.decks.filter((d) => d.deckId !== deck.deckId),
    });
    dispatch({ type: "go", screen: { name: "deckList" } });
  };

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
        {/* Issue #189: 「学習率」の定義が画面のどこにも無く、カードをめくった
            だけで100%になり信用しづらかった。何を数えているかを1行で明示する。 */}
        <p className={styles.completionHint} data-testid="completion-hint">
          学習率 = カードを見た語の割合（クイズの正解は含みません）
        </p>
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

      {/* Issue #181: 自分で入れた語は後から直せる。「入れたら最後」をやめる。 */}
      {editable && (
        <div className="card" data-testid="deck-edit-card">
          <h3 className={styles.editHeading}>このデッキを直す</h3>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="deck-title-input">
              デッキ名
            </label>
            <input
              id="deck-title-input"
              className={styles.input}
              value={titleDraft}
              maxLength={60}
              onChange={(e) => setTitleDraft(e.target.value)}
            />
            <button
              className="ghost"
              type="button"
              onClick={handleRename}
              disabled={!titleDraft.trim() || titleDraft.trim() === deck.title}
            >
              名前を変更
            </button>
          </div>

          <h4 className={styles.wordHeading}>登録した単語（{words.length}）</h4>
          <ul className={styles.wordList} data-testid="deck-word-list">
            {words.map((w) =>
              editingWordId === w.wordId ? (
                <li key={w.wordId} className={styles.wordItem}>
                  <div className={styles.editForm}>
                    <input
                      className={styles.input}
                      aria-label="語"
                      value={wordDraft.term}
                      maxLength={80}
                      onChange={(e) =>
                        setWordDraft({ ...wordDraft, term: e.target.value })
                      }
                    />
                    <input
                      className={styles.input}
                      aria-label="意味"
                      value={wordDraft.meaning}
                      maxLength={300}
                      onChange={(e) =>
                        setWordDraft({ ...wordDraft, meaning: e.target.value })
                      }
                    />
                    <input
                      className={styles.input}
                      aria-label="例文"
                      value={wordDraft.example ?? ""}
                      maxLength={300}
                      onChange={(e) =>
                        setWordDraft({ ...wordDraft, example: e.target.value })
                      }
                    />
                    {/* Issue #191: 読み（任意）。未入力ならカード裏に読みを出さない。 */}
                    <input
                      className={styles.input}
                      aria-label="読み"
                      placeholder="読み（任意・カタカナ）"
                      value={wordDraft.reading ?? ""}
                      maxLength={80}
                      onChange={(e) =>
                        setWordDraft({ ...wordDraft, reading: e.target.value })
                      }
                    />
                    <select
                      className={styles.input}
                      aria-label="品詞"
                      value={wordDraft.partOfSpeech ?? ""}
                      onChange={(e) =>
                        setWordDraft({
                          ...wordDraft,
                          partOfSpeech: partOfSpeechFromInput(e.target.value),
                        })
                      }
                    >
                      <option value="">品詞（任意）</option>
                      {Object.entries(PART_OF_SPEECH_LABELS)
                        .filter(([, label]) => label)
                        .map(([pos, label]) => (
                          <option key={pos} value={pos}>
                            {label}
                          </option>
                        ))}
                    </select>
                    <div className={styles.wordActions}>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => setEditingWordId(null)}
                      >
                        キャンセル
                      </button>
                      <button
                        className="primary"
                        type="button"
                        onClick={() => handleSaveWord(w.wordId)}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </li>
              ) : (
                <li key={w.wordId} className={styles.wordItem}>
                  <span className={styles.wordText}>
                    <span className={styles.wordHead}>
                      <strong>{w.term}</strong>
                      {/* Issue #187: 読みと品詞が無いと何を覚えるのか分からない */}
                      {w.reading && w.reading !== "—" && (
                        <span className={styles.wordReading}>{w.reading}</span>
                      )}
                      {partOfSpeechLabel(w.partOfSpeech) && (
                        <span className={styles.wordPos}>
                          {partOfSpeechLabel(w.partOfSpeech)}
                        </span>
                      )}
                    </span>
                    <span className={styles.wordMeaning}>{w.meaning}</span>
                  </span>
                  <span className={styles.wordActions}>
                    <button
                      className="ghost"
                      type="button"
                      aria-label={`${w.term} を編集`}
                      onClick={() => startEditWord(w)}
                    >
                      編集
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      aria-label={`${w.term} を削除`}
                      onClick={() => setPendingDeleteWord(w)}
                    >
                      削除
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>

          {wordError && <p className={styles.errorText}>{wordError}</p>}
          {deckError && <p className={styles.errorText}>{deckError}</p>}

          <button
            className="danger"
            type="button"
            onClick={() => setConfirmDeleteDeck(true)}
          >
            このデッキを削除
          </button>
        </div>
      )}

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
                  disabled={!llmReady}
                  title={llmReady ? undefined : LLM_REQUIRED_TOOLTIP}
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
                  disabled={!llmReady}
                  title={llmReady ? undefined : LLM_REQUIRED_TOOLTIP}
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
              {!llmReady && (
                <p className={styles.llmHint} data-testid="deck-llm-hint">
                  補充問題・苦手語トレーニングはLLMの設定が必要です。
                  <button
                    type="button"
                    className={styles.llmHintLink}
                    onClick={() =>
                      dispatch({ type: "go", screen: { name: "settings" } })
                    }
                  >
                    設定を開く
                  </button>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {pendingDeleteWord && (
        <ConfirmDialog
          title={`「${pendingDeleteWord.term}」を削除しますか？`}
          confirmLabel="削除する"
          onCancel={() => setPendingDeleteWord(null)}
          onConfirm={() => handleDeleteWord(pendingDeleteWord)}
        >
          <p>
            この語と意味・例文をデッキから消します。学習履歴は残りますが一覧からは
            見えなくなります。
          </p>
        </ConfirmDialog>
      )}

      {confirmDeleteDeck && (
        <ConfirmDialog
          title={`「${deck.title}」を削除しますか？`}
          confirmLabel="デッキを削除"
          onCancel={() => setConfirmDeleteDeck(false)}
          onConfirm={handleDeleteDeck}
        >
          <p>このデッキの語と、このデッキについた復習履歴をまとめて削除します。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
