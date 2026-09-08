import { describe, expect, it } from "vitest";
import type { Choice, Quiz } from "../content/schema";
import {
  buildSessionQuizItems,
  isCorrect,
  scoreRate,
  wrongWordIds,
} from "./session";

function makeQuiz(
  answerChoiceId: string,
  choices: Choice[] = [
    { choiceId: "c1", text: "a" },
    { choiceId: "c2", text: "b" },
    { choiceId: "c3", text: "c" },
    { choiceId: "c4", text: "d" },
  ],
): Quiz {
  return {
    quizId: "q1",
    type: "choose-meaning",
    wordId: "w1",
    prompt: "prompt",
    choices,
    answerChoiceId,
  };
}

describe("isCorrect", () => {
  it("returns true when choiceId matches answerChoiceId", () => {
    const item = buildSessionQuizItems([makeQuiz("c2")])[0];
    expect(isCorrect(item, "c2")).toBe(true);
  });

  it("returns false when choiceId does not match", () => {
    const item = buildSessionQuizItems([makeQuiz("c2")])[0];
    expect(isCorrect(item, "c1")).toBe(false);
  });
});

describe("scoreRate", () => {
  it("returns 0 for empty answers", () => {
    expect(scoreRate([])).toBe(0);
  });

  it("returns 1 for all correct", () => {
    const answers = [
      { correct: true },
      { correct: true },
      { correct: true },
    ] as never[];
    expect(scoreRate(answers)).toBe(1);
  });

  it("returns 0 for all wrong", () => {
    const answers = [{ correct: false }, { correct: false }] as never[];
    expect(scoreRate(answers)).toBe(0);
  });

  it("rounds to 2 decimals for partial scores", () => {
    const answers = [
      { correct: true },
      { correct: false },
      { correct: true },
    ] as never[];
    expect(scoreRate(answers)).toBe(0.67);
  });
});

describe("wrongWordIds", () => {
  it("returns empty array when all answers are correct", () => {
    const answers = [
      { wordId: "w1", correct: true },
      { wordId: "w2", correct: true },
    ] as never[];
    expect(wrongWordIds(answers)).toEqual([]);
  });

  it("returns unique wrong word ids preserving first appearance order", () => {
    const answers = [
      { wordId: "w1", correct: false },
      { wordId: "w1", correct: true },
      { wordId: "w2", correct: false },
      { wordId: "w2", correct: false },
      { wordId: "w3", correct: false },
    ] as never[];
    expect(wrongWordIds(answers)).toEqual(["w1", "w2", "w3"]);
  });
});
