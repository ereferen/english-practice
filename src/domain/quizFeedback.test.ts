import { describe, expect, it } from "vitest";
import { buildWrongAnswerFeedback } from "./quizFeedback";

const libraryQuiz = {
  choices: [
    { choiceId: "c1", text: "weather" },
    { choiceId: "c2", text: "travel" },
    { choiceId: "c3", text: "library" },
    { choiceId: "c4", text: "water" },
  ],
  answerChoiceId: "c3",
  explanation:
    "library は「図書館」。water (水) と綴りが似ていて混同しやすい。",
};

describe("buildWrongAnswerFeedback", () => {
  it("選んだ誤答と正解を一文目に出す（#257）", () => {
    const fb = buildWrongAnswerFeedback(libraryQuiz, "c2");
    expect(fb.selectedLine).toBe("「travel」を選びました。正解は「library」です。");
  });

  it("選んでいない語を名指しする解説は出さない（#257）", () => {
    const fb = buildWrongAnswerFeedback(libraryQuiz, "c2");
    expect(fb.explanation).toBeUndefined();
  });

  it("解説が選んだ語についてなら残す", () => {
    const fb = buildWrongAnswerFeedback(libraryQuiz, "c4");
    expect(fb.explanation).toContain("water");
  });

  it("解説がどの選択肢も名指ししていなければ残す", () => {
    const fb = buildWrongAnswerFeedback(
      { ...libraryQuiz, explanation: "library は「図書館」。場所を表す名詞。" },
      "c2",
    );
    expect(fb.explanation).toContain("場所を表す名詞");
  });

  it("選択肢が分からないときは選択行を出さず解説はそのまま", () => {
    const fb = buildWrongAnswerFeedback(libraryQuiz, undefined);
    expect(fb.selectedLine).toBeUndefined();
    expect(fb.explanation).toContain("water");
  });

  it("部分一致では誤判定しない（water / watermelon）", () => {
    const quiz = {
      choices: [
        { choiceId: "c1", text: "watermelon" },
        { choiceId: "c2", text: "travel" },
        { choiceId: "c3", text: "library" },
        { choiceId: "c4", text: "weather" },
      ],
      answerChoiceId: "c3",
      explanation: "library は「図書館」。water (水) と綴りが似ていて混同しやすい。",
    };
    const fb = buildWrongAnswerFeedback(quiz, "c2");
    expect(fb.explanation).toBeDefined();
  });
});
