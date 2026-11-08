import { useState } from "react";
import type { Word } from "../content/schema";
import { speak } from "../domain/speech";
import { visibleExamples } from "../domain/examples";
import { useSpeechSupport } from "../domain/useSpeechSupport";
import styles from "./QuizScreen.module.css";

interface Props {
  word: Word;
}

/**
 * Issue #182 / #210: 解答後に出題語の読み・意味・例文を1行で見せる共通ブロック。
 * クイズと復習セッションで同じ情報量になるよう、両画面から使う。
 *
 * Issue #246: 答え合わせだけ読み上げボタンが無く、フラッシュカード裏面や
 * 結果画面の誤答語では鳴るのに、一番「間違えた直後」に耳で確認できない
 * 状態だった。ブロック内に置くことでクイズ／復習の両方に揃う。
 */
export default function AnswerDetail({ word }: Props) {
  const speechAvail = useSpeechSupport();
  const [ttsNotice, setTtsNotice] = useState(false);

  const handleSpeak = () => {
    if (speak(word.term)) return;
    setTtsNotice(true);
    window.setTimeout(() => setTtsNotice(false), 2500);
  };

  return (
    <div className={styles.answerDetail} data-testid="answer-detail">
      <p className={styles.answerWord}>
        {word.term}
        <button
          className={`ghost ${styles.answerSpeak}`}
          data-testid="answer-speak"
          aria-label={`${word.term} の発音を再生`}
          title={
            speechAvail === "ready"
              ? "発音再生"
              : "このブラウザは音声未対応（TTSボイス0個）"
          }
          onClick={handleSpeak}
        >
          {speechAvail === "ready" ? "▶" : "🔇"}
        </button>
        {word.reading && (
          <span className={styles.answerReading}>（{word.reading}）</span>
        )}
        {word.ipa && <span className={styles.answerIpa}>{word.ipa}</span>}
        <span className={styles.answerMeaning}>{word.meaning}</span>
      </p>
      {ttsNotice && (
        <p className={styles.answerTtsNotice} role="status" aria-live="polite">
          このブラウザは音声未対応です（TTSボイスがありません）
        </p>
      )}
      {visibleExamples(word)
        .slice(0, 1)
        .map((ex, i) => (
          <div key={i} className={styles.answerExample}>
            <div>{ex.en}</div>
            {ex.ja && <div className={styles.answerExampleJa}>{ex.ja}</div>}
          </div>
        ))}
      {word.note && <p className={styles.answerNote}>ノート: {word.note}</p>}
    </div>
  );
}
