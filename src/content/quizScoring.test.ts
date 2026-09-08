import { describe, expect, it } from "vitest";
import type { Deck } from "./schema";
import { generateQuizzesForLesson } from "./loader";
import { buildSessionQuizItems, isCorrect, scoreRate } from "../domain/session";

const deck: Deck = {
  schemaVersion: "1.0",
  deckId: "score-test",
  level: "beginner",
  title: "score test",
  lessons: [
    {
      lessonId: "l1",
      title: "L1",
      words: [
        {
          wordId: "apple",
          term: "apple",
          reading: "アップル",
          meaning: "りんご",
          examples: [{ en: "I eat an apple." }],
        },
        {
          wordId: "banana",
          term: "banana",
          reading: "バナナ",
          meaning: "バナナ",
          examples: [{ en: "I eat a banana." }],
        },
        {
          wordId: "cherry",
          term: "cherry",
          reading: "チェリー",
          meaning: "さくらんぼ",
          examples: [{ en: "The cherry is red." }],
        },
        {
          wordId: "date",
          term: "date",
          reading: "デート",
          meaning: "デート; 日付",
          examples: [{ en: "I have a date tonight." }],
        },
      ],
      quizzes: [],
    },
  ],
};

describe("quiz scoring boundary cases", () => {
  it("all-correct answers yield 100% score", () => {
    const quizzes = generateQuizzesForLesson(deck, "l1");
    const items = buildSessionQuizItems(quizzes, { shuffle: false });
    const answers = items.map((item) => ({
      quizId: item.quizId,
      wordId: item.wordId,
      choiceId: item.answerChoiceId,
      correct: true,
      latencyMs: 1000,
    }));
    expect(scoreRate(answers)).toBe(1);
  });

  it("all-wrong answers yield 0% score", () => {
    const quizzes = generateQuizzesForLesson(deck, "l1");
    const items = buildSessionQuizItems(quizzes, { shuffle: false });
    const answers = items.map((item) => {
      const wrongChoice = item.choices.find(
        (c) => c.choiceId !== item.answerChoiceId,
      );
      return {
        quizId: item.quizId,
        wordId: item.wordId,
        choiceId: wrongChoice!.choiceId,
        correct: false,
        latencyMs: 1000,
      };
    });
    expect(scoreRate(answers)).toBe(0);
  });

  it("partial score rounds to 2 decimals", () => {
    const answers = [
      { correct: true },
      { correct: true },
      { correct: false },
    ] as never[];
    expect(scoreRate(answers)).toBe(0.67);
  });

  it("isCorrect identifies every generated answer correctly", () => {
    const quizzes = generateQuizzesForLesson(deck, "l1");
    const items = buildSessionQuizItems(quizzes, { shuffle: false });
    for (const item of items) {
      expect(isCorrect(item, item.answerChoiceId)).toBe(true);
      const wrong = item.choices.find(
        (c) => c.choiceId !== item.answerChoiceId,
      );
      expect(isCorrect(item, wrong!.choiceId)).toBe(false);
    }
  });
});
