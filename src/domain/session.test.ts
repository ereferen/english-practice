import { describe, expect, it } from "vitest";
import type { Quiz } from "../content/schema";
import {
  buildSessionQuizItems,
  isCorrect,
  scoreRate,
  wrongWordIds,
} from "./session";

const quiz: Quiz = {
  quizId: "q1",
  type: "choose-meaning",
  wordId: "w1",
  prompt: "apple",
  choices: [
    { choiceId: "a", text: "apple" },
    { choiceId: "b", text: "banana" },
    { choiceId: "c", text: "cherry" },
    { choiceId: "d", text: "date" },
  ],
  answerChoiceId: "a",
  explanation: "apple is apple",
};

describe("session scoring", () => {
  it("isCorrect returns true for correct choice", () => {
    const item = buildSessionQuizItems([quiz])[0];
    expect(isCorrect(item, "a")).toBe(true);
    expect(isCorrect(item, "b")).toBe(false);
  });

  it("scoreRate rounds to 2 decimals", () => {
    expect(
      scoreRate([
        { correct: true },
        { correct: false },
        { correct: true },
      ] as never),
    ).toBe(0.67);
  });

  it("wrongWordIds returns unique wrong word ids", () => {
    const answers = [
      { wordId: "w1", correct: false },
      { wordId: "w1", correct: true },
      { wordId: "w2", correct: false },
    ] as never;
    expect(wrongWordIds(answers)).toEqual(["w1", "w2"]);
  });

  it("buildSessionQuizItems preserves choices", () => {
    const items = buildSessionQuizItems([quiz]);
    expect(items).toHaveLength(1);
    expect(items[0].choices).toHaveLength(4);
  });
});
