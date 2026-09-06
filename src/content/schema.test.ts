import { describe, expect, it } from "vitest";
import { assert } from "vitest";
import {
  deckSchema,
  exampleSchema,
  lessonSchema,
  parseDeck,
  parseDeckSafe,
  quizSchema,
  wordSchema,
} from "./schema";

const minimalValidDeck = {
  schemaVersion: "1.0",
  deckId: "test-deck",
  level: "beginner",
  title: "Test Deck",
  lessons: [
    {
      lessonId: "lesson-1",
      title: "Lesson 1",
      words: [
        {
          wordId: "apple",
          term: "apple",
          reading: "アップル",
          meaning: "りんご",
          examples: [{ en: "I eat an apple." }],
        },
      ],
    },
  ],
};

describe("parseDeckSafe", () => {
  it("returns ok=true for a valid minimal deck", () => {
    const result = parseDeckSafe(minimalValidDeck);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.deckId).toBe("test-deck");
    }
  });

  it("returns ok=false with issues for missing required fields", () => {
    const result = parseDeckSafe({});
    expect(result.ok).toBe(false);
    assert(result.ok === false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects an invalid slug", () => {
    const result = parseDeckSafe({
      ...minimalValidDeck,
      deckId: "Invalid Slug",
    });
    expect(result.ok).toBe(false);
    assert(result.ok === false);
    expect(result.issues.some((i) => i.path.includes("deckId"))).toBe(true);
  });

  it("rejects schemaVersion without x.y format", () => {
    const result = parseDeckSafe({
      ...minimalValidDeck,
      schemaVersion: "1",
    });
    expect(result.ok).toBe(false);
    assert(result.ok === false);
    expect(result.issues.some((i) => i.path.includes("schemaVersion"))).toBe(
      true,
    );
  });

  it("rejects an unknown level", () => {
    const result = parseDeckSafe({
      ...minimalValidDeck,
      level: "expert",
    });
    expect(result.ok).toBe(false);
    assert(result.ok === false);
    expect(result.issues.some((i) => i.path.includes("level"))).toBe(true);
  });

  it("rejects additional properties", () => {
    const result = parseDeckSafe({
      ...minimalValidDeck,
      extraField: "not allowed",
    });
    expect(result.ok).toBe(false);
    assert(result.ok === false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("parseDeck", () => {
  it("returns a Deck for valid input", () => {
    const deck = parseDeck(minimalValidDeck);
    expect(deck.title).toBe("Test Deck");
  });

  it("throws for invalid input", () => {
    expect(() => parseDeck({})).toThrow();
  });
});

describe("wordSchema", () => {
  it("accepts a valid word", () => {
    const result = wordSchema.safeParse({
      wordId: "run",
      term: "run",
      reading: "ラン",
      meaning: "走る",
      examples: [{ en: "I run every day.", ja: "毎日走る。" }],
      partOfSpeech: "verb",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a word without required fields", () => {
    const result = wordSchema.safeParse({
      wordId: "run",
      term: "run",
    });
    expect(result.success).toBe(false);
  });

  it("rejects too many examples", () => {
    const result = wordSchema.safeParse({
      wordId: "run",
      term: "run",
      reading: "ラン",
      meaning: "走る",
      examples: [{ en: "1" }, { en: "2" }, { en: "3" }, { en: "4" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid partOfSpeech", () => {
    const result = wordSchema.safeParse({
      wordId: "run",
      term: "run",
      reading: "ラン",
      meaning: "走る",
      examples: [{ en: "I run." }],
      partOfSpeech: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

describe("exampleSchema", () => {
  it("requires en", () => {
    expect(exampleSchema.safeParse({ ja: "こんにちは" }).success).toBe(false);
  });

  it("accepts en without ja", () => {
    expect(exampleSchema.safeParse({ en: "Hello" }).success).toBe(true);
  });
});

describe("lessonSchema", () => {
  it("accepts a lesson with an empty quizzes array", () => {
    const result = lessonSchema.safeParse({
      lessonId: "l1",
      title: "L1",
      words: [
        {
          wordId: "a",
          term: "a",
          reading: "エー",
          meaning: "A",
          examples: [{ en: "A." }],
        },
      ],
      quizzes: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a lesson without words", () => {
    const result = lessonSchema.safeParse({
      lessonId: "l1",
      title: "L1",
      words: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("quizSchema", () => {
  const validQuiz = {
    quizId: "q1",
    type: "choose-meaning",
    wordId: "apple",
    prompt: "apple",
    choices: [
      { choiceId: "c1", text: "りんご" },
      { choiceId: "c2", text: "バナナ" },
      { choiceId: "c3", text: "みかん" },
      { choiceId: "c4", text: "ぶどう" },
    ],
    answerChoiceId: "c1",
  };

  it("accepts a valid quiz", () => {
    expect(quizSchema.safeParse(validQuiz).success).toBe(true);
  });

  it("rejects a quiz with 3 choices", () => {
    const result = quizSchema.safeParse({
      ...validQuiz,
      choices: validQuiz.choices.slice(0, 3),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a quiz with 5 choices", () => {
    const result = quizSchema.safeParse({
      ...validQuiz,
      choices: [...validQuiz.choices, { choiceId: "c5", text: "メロン" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown quiz type", () => {
    const result = quizSchema.safeParse({
      ...validQuiz,
      type: "match-pairs",
    });
    expect(result.success).toBe(false);
  });
});

describe("deckSchema", () => {
  it("rejects a deck with no lessons", () => {
    const result = deckSchema.safeParse({
      schemaVersion: "1.0",
      deckId: "empty",
      level: "beginner",
      title: "Empty",
      lessons: [],
    });
    expect(result.success).toBe(false);
  });

  it("allows optional $schema, description, and source", () => {
    const result = deckSchema.safeParse({
      $schema: "https://example.com/schema.json",
      schemaVersion: "1.0",
      deckId: "full",
      level: "advanced",
      title: "Full",
      description: "desc",
      source: "src",
      lessons: [
        {
          lessonId: "l1",
          title: "L1",
          words: [
            {
              wordId: "x",
              term: "x",
              reading: "エックス",
              meaning: "X",
              examples: [{ en: "X." }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
