import { describe, expect, it } from "vitest";
import type { Quiz } from "../content/schema";
import {
  buildSessionQuizItems,
  isAbortedSession,
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

  // Issue #228: 会話から抽出したデッキは 1 語に 2 問（穴埋め＋意味）を持つため、
  // 4 語のレッスンが 7 問になっていた。onePerWord で語数ぶんに揃う。
  it("onePerWord keeps a single quiz per word", () => {
    const twoForW1: Quiz[] = [
      quiz,
      { ...quiz, quizId: "q1b", type: "fill-blank" },
      { ...quiz, quizId: "q2", wordId: "w2" },
      { ...quiz, quizId: "q2b", wordId: "w2", type: "fill-blank" },
      { ...quiz, quizId: "q3", wordId: "w3" },
    ];
    const items = buildSessionQuizItems(twoForW1, { onePerWord: true });
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.wordId))).toEqual(
      new Set(["w1", "w2", "w3"]),
    );
  });

  it("onePerWord is off by default", () => {
    const twoForW1: Quiz[] = [quiz, { ...quiz, quizId: "q1b" }];
    expect(buildSessionQuizItems(twoForW1)).toHaveLength(2);
  });

  // Issue #229: 回答 0 件の「開いてすぐ戻った」セッションを履歴から外す判定。
  it("isAbortedSession flags zero-answer records only", () => {
    expect(
      isAbortedSession({
        scoreRate: 0,
        startedAt: "2026-10-27T00:00:00.000Z",
        endedAt: "2026-10-27T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isAbortedSession({
        scoreRate: 0,
        startedAt: "2026-10-27T00:00:00.000Z",
        endedAt: "2026-10-27T00:02:00.000Z",
      }),
    ).toBe(false);
    expect(
      isAbortedSession({
        scoreRate: 0.5,
        startedAt: "2026-10-27T00:00:00.000Z",
        endedAt: "2026-10-27T00:02:00.000Z",
      }),
    ).toBe(false);
    expect(
      isAbortedSession({
        scoreRate: null,
        startedAt: "2026-10-27T00:00:00.000Z",
        endedAt: null,
      }),
    ).toBe(false);
  });
});
