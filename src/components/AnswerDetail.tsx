import type { Word } from "../content/schema";
import styles from "./QuizScreen.module.css";

interface Props {
  word: Word;
}

/**
 * Issue #182 / #210: 解答後に出題語の読み・意味・例文を1行で見せる共通ブロック。
 * クイズと復習セッションで同じ情報量になるよう、両画面から使う。
 */
export default function AnswerDetail({ word }: Props) {
  return (
    <div className={styles.answerDetail} data-testid="answer-detail">
      <p className={styles.answerWord}>
        {word.term}
        {word.reading && (
          <span className={styles.answerReading}>（{word.reading}）</span>
        )}
        {word.ipa && <span className={styles.answerIpa}>{word.ipa}</span>}
        <span className={styles.answerMeaning}>{word.meaning}</span>
      </p>
      {word.examples.slice(0, 1).map((ex, i) => (
        <div key={i} className={styles.answerExample}>
          <div>{ex.en}</div>
          {ex.ja && <div className={styles.answerExampleJa}>{ex.ja}</div>}
        </div>
      ))}
      {word.note && <p className={styles.answerNote}>ノート: {word.note}</p>}
    </div>
  );
}
