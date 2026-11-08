/**
 * Issue #257: 誤答ノートが選んだ選択肢を見ていなかった。
 *
 * デッキの `explanation` は「この語でよくある間違い」を1つだけ書いた固定文
 * なので、別の選択肢を選んでも同じ語を名指ししてしまう（library の問題で
 * travel を選んだのに「water と綴りが似ていて混同しやすい」と出る）。
 *
 * ここでは「実際に何を選んだか」を一文目に必ず出し、固定の解説は
 * 選んでいない選択肢を名指ししているときだけ落とす。純関数なので
 * クイズ（QuizScreen）と復習（ReviewSession）の両方から使える。
 */

import type { Choice } from "../content/schema";
import type { QuizItem } from "./session";

export interface WrongAnswerFeedback {
  /** どの選択肢を選んだか + 正解は何か（選択が分かるときだけ）。 */
  selectedLine?: string;
  /** デッキ作者の解説。誤解を招くときは undefined。 */
  explanation?: string;
}

/** 英単語としての一致（部分一致で `water` が `watermelon` に当たらないように）。 */
function mentionsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(text);
}

/**
 * 誤答時のフィードバックを組み立てる。
 * `chosenChoiceId` が無い（記録が読めない）ときは選択行を出さず、解説もそのまま。
 */
export function buildWrongAnswerFeedback(
  quiz: Pick<QuizItem, "choices" | "answerChoiceId" | "explanation">,
  chosenChoiceId: string | undefined,
): WrongAnswerFeedback {
  const answer = quiz.choices.find((c) => c.choiceId === quiz.answerChoiceId);
  const chosen: Choice | undefined = chosenChoiceId
    ? quiz.choices.find((c) => c.choiceId === chosenChoiceId)
    : undefined;

  const selectedLine =
    chosen && answer && chosen.choiceId !== answer.choiceId
      ? `「${chosen.text}」を選びました。正解は「${answer.text}」です。`
      : undefined;

  let explanation = quiz.explanation?.trim() || undefined;
  if (explanation && chosen && answer) {
    const namedElsewhere = quiz.choices.some(
      (c) =>
        c.choiceId !== chosen.choiceId &&
        c.choiceId !== answer.choiceId &&
        mentionsTerm(explanation as string, c.text),
    );
    if (namedElsewhere) explanation = undefined;
  }

  return {
    ...(selectedLine ? { selectedLine } : {}),
    ...(explanation ? { explanation } : {}),
  };
}
