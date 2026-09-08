import { describe, expect, it } from "vitest";
import type { Deck, Quiz, Word } from "./schema";
import { generateQuizzesForLesson, validateDeckConsistency } from "./loader";

function makeDeck(words: Word[], quizzes: Quiz[] = []): Deck {
  return {
    schemaVersion: "1.0",
    deckId: "gen-test",
    level: "beginner",
    title: "gen test",
    lessons: [
      {
        lessonId: "l1",
        title: "L1",
        words,
        quizzes,
      },
    ],
  };
}

function makeWord(id: string, overrides?: Partial<Word>): Word {
  return {
    wordId: id,
    term: id,
    reading: `${id}リーディング`,
    meaning: `${id}の意味`,
    examples: [{ en: `This is ${id}.` }],
    ...overrides,
  };
}

describe("generateQuizzesForLesson", () => {
  it("generates quizzes for each word when quizzes array is empty", () => {
    const words = ["a", "b", "c", "d"].map((id) => makeWord(id));
    const deck = makeDeck(words);
    const quizzes = generateQuizzesForLesson(deck, "l1");
    expect(quizzes.length).toBeGreaterThan(0);
  });

  it("every generated quiz has exactly 4 choices", () => {
    const words = ["a", "b", "c", "d"].map((id) => makeWord(id));
    const deck = makeDeck(words);
    const quizzes = generateQuizzesForLesson(deck, "l1");
    for (const q of quizzes) {
      expect(q.choices).toHaveLength(4);
    }
  });

  it("generated quizzes pass consistency checks", () => {
    const words = ["a", "b", "c", "d"].map((id) => makeWord(id));
    const deck = makeDeck(words);
    const quizzes = generateQuizzesForLesson(deck, "l1");
    const deckWithQuizzes: Deck = {
      ...deck,
      lessons: [{ ...deck.lessons[0], quizzes }],
    };
    expect(validateDeckConsistency(deckWithQuizzes)).toEqual([]);
  });

  it("returns existing quizzes when lesson already has them", () => {
    const existing: Quiz = {
      quizId: "existing",
      type: "choose-meaning",
      wordId: "a",
      prompt: "a",
      choices: [
        { choiceId: "c1", text: "a" },
        { choiceId: "c2", text: "b" },
        { choiceId: "c3", text: "c" },
        { choiceId: "c4", text: "d" },
      ],
      answerChoiceId: "c1",
    };
    const words = ["a", "b", "c", "d"].map((id) => makeWord(id));
    const deck = makeDeck(words, [existing]);
    const quizzes = generateQuizzesForLesson(deck, "l1");
    expect(quizzes).toHaveLength(1);
    expect(quizzes[0].quizId).toBe("existing");
  });

  it("returns empty array for unknown lesson", () => {
    const words = ["a", "b", "c", "d"].map((id) => makeWord(id));
    const deck = makeDeck(words);
    expect(generateQuizzesForLesson(deck, "missing")).toEqual([]);
  });

  it("returns empty array when deck has fewer than 4 words", () => {
    const words = ["a", "b", "c"].map((id) => makeWord(id));
    const deck = makeDeck(words);
    expect(generateQuizzesForLesson(deck, "l1")).toEqual([]);
  });

  it("generates fill-blank quizzes when examples contain the term", () => {
    const words = [
      makeWord("a", { examples: [{ en: "I see a." }] }),
      makeWord("b"),
      makeWord("c"),
      makeWord("d"),
    ];
    const deck = makeDeck(words);
    const quizzes = generateQuizzesForLesson(deck, "l1");
    const fillBlank = quizzes.filter((q) => q.type === "fill-blank");
    expect(fillBlank.length).toBeGreaterThan(0);
    for (const q of fillBlank) {
      expect(q.prompt).toContain("___");
    }
  });

  it("answer choices match target word meaning for choose-meaning", () => {
    const words = ["a", "b", "c", "d"].map((id) => makeWord(id));
    const deck = makeDeck(words);
    const quizzes = generateQuizzesForLesson(deck, "l1");
    const chooseMeaning = quizzes.filter((q) => q.type === "choose-meaning");
    expect(chooseMeaning.length).toBeGreaterThan(0);
    for (const q of chooseMeaning) {
      const answer = q.choices.find((c) => c.choiceId === q.answerChoiceId);
      expect(answer).toBeDefined();
      const word = words.find((w) => w.wordId === q.wordId);
      expect(answer!.text).toBe(word!.meaning);
    }
  });
});
