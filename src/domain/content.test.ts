import { describe, expect, it } from "vitest";
import { generateQuizzesForLesson } from "../content/loader";
import type { Deck } from "../content/schema";

const deck: Deck = {
  schemaVersion: "1.0",
  deckId: "test",
  level: "beginner",
  title: "test deck",
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

describe("generateQuizzesForLesson", () => {
  it("generates choose-meaning quizzes when quizzes array is empty", () => {
    const quizzes = generateQuizzesForLesson(deck, "l1");
    expect(quizzes.length).toBeGreaterThan(0);
    for (const q of quizzes) {
      expect(q.choices).toHaveLength(4);
      const answer = q.choices.find((c) => c.choiceId === q.answerChoiceId);
      expect(answer).toBeDefined();
    }
  });
});
