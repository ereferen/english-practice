import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, Action } from "../app/types";
import { generateQuizzesForLesson, pickLesson } from "../content/loader";
import { buildSessionQuizItems } from "../domain/session";
import { partOfSpeechLabel } from "../domain/partOfSpeech";
import { speak } from "../domain/speech";
import { useSpeechSupport } from "../domain/useSpeechSupport";
import type { LocalProgressStore } from "../storage/localProgress";
import { useKeyboardShortcuts } from "../app/useKeyboardShortcuts";
import styles from "./FlashScreen.module.css";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  localProgress: LocalProgressStore;
  deckId: string;
  lessonId: string;
  /** Issue #194: 誤答語だけをやり直すときの対象語（未指定ならレッスン全語） */
  focusWordIds?: string[];
}

/**
 * Issue #168 / #187: 品詞ラベルは domain/partOfSpeech に一本化した
 * （会話抽出パネル・デッキ単語一覧と表記を揃えるため）。
 */

export default function FlashScreen({
  state,
  dispatch,
  localProgress,
  deckId,
  lessonId,
  focusWordIds,
}: Props) {
  const deck = state.decks.find((d) => d.deckId === deckId);
  const lessonWithDeck = deck ? pickLesson(deck, lessonId) : undefined;
  // Issue #134: tell the user BEFORE they press 「クイズへ」 when the lesson
  // yields no quiz items — finding out after the click is a dead end.
  const quizItemCount = useMemo(() => {
    if (!deck) return 0;
    const quizzes = generateQuizzesForLesson(deck, lessonId);
    // Issue #194: 誤答語のやり直しでは、対象語ぶんだけを数える。
    const scoped =
      focusWordIds && focusWordIds.length > 0
        ? quizzes.filter((q) => focusWordIds.includes(q.wordId))
        : quizzes;
    return buildSessionQuizItems(scoped, { shuffle: false }).length;
  }, [deck, lessonId, focusWordIds]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Issue #45: brief gold-rim pulse while the card face changes.
  const [flipping, setFlipping] = useState(false);
  const learnedRef = useRef<Set<string>>(new Set());
  // Issue #124: which words in this lesson session were already revealed,
  // so navigating 前へ/次へ restores the correct face; also drives the
  // flip-gate on 「次の語」.
  const flippedRef = useRef<Set<string>>(new Set());
  const [shake, setShake] = useState(false);
  // Issue #83: when the environment has no TTS voices, the audio button
  // must say so instead of silently doing nothing.
  const speechAvail = useSpeechSupport();
  const [ttsNotice, setTtsNotice] = useState(false);
  // Issue #132: the header 進捗 button used to navigate away and destroy the
  // session. It now opens an in-place panel: current position + words seen
  // in THIS session, with the global record reachable explicitly.
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const [pendingProgressNav, setPendingProgressNav] = useState(false);

  const handleSpeak = (text: string) => {
    const played = speak(text);
    if (!played) {
      setTtsNotice(true);
      window.setTimeout(() => setTtsNotice(false), 2500);
    }
  };

  const toggleFlip = () => {
    // Issue #75: once the user has revealed the answer, count the word as
    // learned immediately. Previously only 「次の語」 recorded it, so
    // pressing 戻る lost all visible progress (学習率 0% complaint).
    if (!flipped) markCurrentLearned();
    const next = !flipped;
    if (next && word) flippedRef.current.add(word.wordId);
    setFlipped(next);
    setFlipping(true);
    // Issue #94: matches the paperFlip animation (320ms) so the rim glow
    // persists for the full sweep.
    window.setTimeout(() => setFlipping(false), 320);
  };

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    learnedRef.current = new Set();
    flippedRef.current = new Set();
  }, [deckId, lessonId]);

  const lesson = lessonWithDeck?.lesson;
  // Issue #194: 誤答語だけのやり直しでは、対象語のカードだけをめくる。
  const focusIds =
    focusWordIds && focusWordIds.length > 0 ? new Set(focusWordIds) : null;
  const words = (lesson?.words ?? []).filter(
    (w) => !focusIds || focusIds.has(w.wordId),
  );
  const word = words[Math.min(index, Math.max(words.length - 1, 0))];
  const isLast = words.length > 0 && index === words.length - 1;
  // 誤答語のやり直し中は、カード後のクイズも同じ語だけに絞る。
  const quizFocus = focusIds ? focusWordIds : undefined;
  // Issue #192: 会話から拾った文法訂正は「語のカード」ではなく「訂正文のカード」として
  // 見せる。表=✗自分の文 / 裏=✓訂正文＋解説＋ノート（読み・品詞・例文リストは出さない）。
  const isGrammarCorrection =
    word?.tags?.includes("grammar-correction") ?? false;

  /** Mark the current word as learned (idempotent per render cycle). */
  const markCurrentLearned = () => {
    if (!word) return;
    const id = word.wordId;
    if (learnedRef.current.has(id)) return;
    learnedRef.current.add(id);
    localProgress.markLearned({
      deckId,
      wordId: id,
      learnedAt: new Date().toISOString(),
    });
  };

  /** Jump to a word index, restoring the face (front/back) it had earlier
   *  in this session (issue #124: 前へ/次へ navigation). */
  const goTo = (nextIndex: number) => {
    setIndex(nextIndex);
    const target = words[nextIndex];
    const wasFlipped = target ? flippedRef.current.has(target.wordId) : false;
    setFlipped(wasFlipped);
  };

  // Issue #124: 「次の語」 requires the card to have been flipped at least
  // once — otherwise users could consume a whole lesson without ever
  // seeing a meaning. An unflipped card shakes and says why.
  const requestFlipFirst = () => {
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  };

  // Issue #149: the gate itself is right, but the button used to look fully
  // enabled while the hint vanished after 0.5s — it read as "broken". The
  // button now renders disabled/unavailable until the card is revealed, and
  // the hint stays on screen instead of timing out.
  const canAdvance = flipped || (word ? flippedRef.current.has(word.wordId) : false);

  // Issue #203: 語数不足のレッスンで「クイズへ」を押すと、クイズ画面が
  // 問題ゼロで即座に戻ってきて「何も起きない＋カードが表に戻る」ように見えていた。
  // 押せないことを見た目で示し、補充問題の生成導線へ 1 クリックで送る。
  const quizReady = quizItemCount > 0;

  const handleNext = () => {
    if (!lesson) return;
    if (!canAdvance) {
      requestFlipFirst();
      return;
    }
    markCurrentLearned();
    if (isLast) {
      if (quizReady) {
        dispatch({
          type: "go",
          screen: { name: "quiz", deckId, lessonId, focusWordIds: quizFocus },
        });
      }
    } else {
      goTo(index + 1);
    }
  };

  const handlePrev = () => {
    if (index === 0) return;
    goTo(index - 1);
  };

  // Issue #124: 「最初からやり直す」 on the last card restarts the pass so
  // the lesson doubles as a quick morning review.
  const handleRestart = () => {
    flippedRef.current = new Set();
    setIndex(0);
    setFlipped(false);
  };

  // Keyboard shortcuts (issue #9, #124: ← goes back).
  useKeyboardShortcuts({
    " ": toggleFlip,
    Enter: toggleFlip,
    ArrowRight: handleNext,
    ArrowLeft: handlePrev,
    n: handleNext,
    N: handleNext,
    s: () => word && handleSpeak(word.term),
    S: () => word && handleSpeak(word.term),
    Escape: () =>
      dispatch({ type: "go", screen: { name: "deckHome", deckId } }),
  });

  if (!deck || !lesson) {
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

  return (
    <div className="container">
      <div className="nav-header">
        <h2>
          フラッシュカード ({index + 1}/{words.length})
        </h2>
        {/* Issue #75: one clearly-labelled exit button (was 中断, which
            confused users looking for 戻る — aborting keeps learned words). */}
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
          data-testid="flash-progress-button"
        >
          進捗
        </button>
      </div>

      {/* Issue #194: 誤答語だけのカード復習であることを明示する */}
      {focusIds && words.length > 0 && (
        <p className={styles.sessionInfoList} role="status">
          誤答した語（{words.length} 語）だけをカードで確認しています
        </p>
      )}

      {/* Issue #132: session-scoped progress, shown without leaving the card */}
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
              フラッシュカード {index + 1}/{words.length} 枚目
            </li>
            <li>
              このセッションで意味を確認した語: {learnedRef.current.size} 語
            </li>
          </ul>
          {pendingProgressNav ? (
            <>
              <p className={styles.sessionInfoWarn} role="alert">
                ⚠ 「学習の記録」を開くとこのフラッシュカードは閉じます（
                {index + 1}/{words.length}
                から再開はできません）。このセッションを続けますか？
              </p>
              <div className={styles.actions}>
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
            <div className={styles.actions}>
              <button
                className="primary"
                onClick={() => setShowSessionInfo(false)}
              >
                カードに戻る
              </button>
              <button
                className="ghost"
                onClick={() => setPendingProgressNav(true)}
                data-testid="flash-open-record"
              >
                学習の記録を開く
              </button>
            </div>
          )}
        </div>
      )}

      <div
        onClick={toggleFlip}
        role="button"
        tabIndex={0}
        aria-label="カードをめくる"
        data-flipping={flipping ? "true" : undefined}
        data-shake={shake ? "true" : undefined}
        className={`card flash-card ${styles.flipCard}`}
      >
        {!flipped ? (
          <>
            {/* Issue #72: the front shows ONLY the term. Reading + meaning
                stay hidden so users can self-test before flipping. */}
            {/* Issue #192: 文法訂正は「自分の間違えた文」だと分かるよう ✗ を付ける。 */}
            {isGrammarCorrection ? (
              <div
                className={`flash-term ${styles.grammarFront}`}
                data-testid="grammar-front"
              >
                <span className={styles.crossMark}>✗</span> {word.term}
              </div>
            ) : (
              <div className={`flash-term ${styles.term}`}>{word.term}</div>
            )}
            <div className={styles.flipHint} aria-hidden="true">
              クリック / Space でめくる
            </div>
          </>
        ) : isGrammarCorrection ? (
          <>
            {/* Issue #192: カード裏も抽出パネルと同じ3段組
                （✓ 訂正文 / 解説 / ノート）。読み・品詞バッジ・例文リストは出さない。 */}
            {word.examples[0]?.en && (
              <div
                className={styles.grammarCorrected}
                data-testid="grammar-corrected"
              >
                <span className={styles.checkMark}>✓</span> {word.examples[0].en}
              </div>
            )}
            <div className={styles.meaning}>{word.meaning}</div>
            {word.note && <p className={styles.note}>ノート: {word.note}</p>}
          </>
        ) : (
          <>
            {/* Issue #191: 読み未設定（"—" プレースホルダ）なら行ごと出さない。 */}
            {word.reading && word.reading !== "—" && (
              <div className={styles.readingBack}>{word.reading}</div>
            )}
            <div className={styles.meaning}>{word.meaning}</div>
            {partOfSpeechLabel(word.partOfSpeech) && (
              <div className={`badge-gold ${styles.partOfSpeech}`}>
                {partOfSpeechLabel(word.partOfSpeech)}
              </div>
            )}
            <div className={styles.examples}>
              {word.examples.map((ex, i) => (
                <div key={i} className={styles.example}>
                  <div>{ex.en}</div>
                  {ex.ja && <div className={styles.exampleJa}>{ex.ja}</div>}
                </div>
              ))}
            </div>
            {word.note && <p className={styles.note}>ノート: {word.note}</p>}
          </>
        )}
      </div>

      <div className={`flash-actions ${styles.actions}`}>
        <button
          className="ghost"
          onClick={handlePrev}
          disabled={index === 0}
          title="前へ (←)"
        >
          ← 前へ
        </button>
        <button
          className={styles.audioButton}
          onClick={() => handleSpeak(word.term)}
          title={
            speechAvail === "ready"
              ? "発音再生 (S)"
              : "このブラウザは音声未対応（TTSボイス0個）"
          }
        >
          {speechAvail === "ready" ? "🔊" : "🔇"} 音声再生
        </button>
        {ttsNotice && (
          <span className={styles.ttsNotice} role="status" aria-live="polite">
            このブラウザは音声未対応です（TTSボイスがありません）
          </span>
        )}
        {isLast && (
          <button className="ghost" onClick={handleRestart}>
            最初からやり直す
          </button>
        )}
        <button
          className={`primary ${styles.nextButton}`}
          onClick={handleNext}
          disabled={!canAdvance || (isLast && !quizReady)}
          data-testid="flash-next-button"
          title={isLast && !quizReady ? "語数が足りないためクイズを作れません" : undefined}
        >
          {isLast ? "クイズへ" : "次の語"}
        </button>
      </div>
      {/* Issue #134: pressing クイズへ used to land on a bare "クイズがありません"
          dead end. Say it up front, with the one action that unlocks a quiz.
          Issue #203: その場で次の一手を押せるようにボタンを並べる。 */}
      {isLast && !quizReady && (
        <div className={styles.quizUnavailable} data-testid="quiz-unavailable">
          <p role="status">
            ⚠ このレッスンはクイズを作れる語数に足りていません（4語以上必要）。
          </p>
          <button
            className="ghost"
            data-testid="quiz-unavailable-generate"
            onClick={() =>
              dispatch({ type: "go", screen: { name: "deckHome", deckId } })
            }
          >
            ✨ LLMで補充問題を生成（デッキ画面へ）
          </button>
        </div>
      )}
      {!canAdvance && (
        <p
          className={styles.flipGate}
          role={shake ? "alert" : "status"}
          data-testid="flip-gate-hint"
        >
          ⚠ 先にカードをめくって意味を確認しましょう（クリック / Space）
        </p>
      )}
    </div>
  );
}
