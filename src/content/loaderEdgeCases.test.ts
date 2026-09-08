import { describe, expect, it } from "vitest";
import type { Deck } from "./schema";
import {
  allQuizzes,
  allWords,
  ContentLoadError,
  parseDeckJson,
  pickLesson,
  validateDeckConsistency,
  wordById,
} from "./loader";

const baseDeck: Deck = {
  schemaVersion: "1.0",
  deckId: "edge-test",
  level: "beginner",
  title: "edge test deck",
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

describe("validateDeckConsistency edge cases", () => {
  it("returns empty array for valid deck", () => {
    expect(validateDeckConsistency(baseDeck)).toEqual([]);
  });

  it("detects duplicate lessonId", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [baseDeck.lessons[0], baseDeck.lessons[0]],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("duplicate lessonId"))).toBe(true);
  });

  it("detects duplicate term", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          words: baseDeck.lessons[0].words.map((w, i) =>
            i === 1 ? { ...w, term: baseDeck.lessons[0].words[0].term } : w,
          ),
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("duplicate term"))).toBe(true);
  });

  it("rejects deck with fewer than 4 words", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          words: baseDeck.lessons[0].words.slice(0, 3),
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("at least 4 words"))).toBe(true);
  });

  it("detects choose-term answer mismatch", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          quizzes: [
            {
              quizId: "q1",
              type: "choose-term",
              wordId: "apple",
              prompt: "りんご",
              choices: [
                { choiceId: "c1", text: "banana" },
                { choiceId: "c2", text: "cherry" },
                { choiceId: "c3", text: "date" },
                { choiceId: "c4", text: "elderberry" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(
      issues.some((m) => m.includes("choose-term answer does not match")),
    ).toBe(true);
  });

  it("detects fill-blank prompt containing answer term", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          quizzes: [
            {
              quizId: "q1",
              type: "fill-blank",
              wordId: "apple",
              prompt: "I eat an apple and it is red.",
              choices: [
                { choiceId: "c1", text: "apple" },
                { choiceId: "c2", text: "banana" },
                { choiceId: "c3", text: "cherry" },
                { choiceId: "c4", text: "date" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(
      issues.some((m) => m.includes("still contains the answer term")),
    ).toBe(true);
  });

  it("detects duplicate choiceId", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          quizzes: [
            {
              quizId: "q1",
              type: "choose-meaning",
              wordId: "apple",
              prompt: "apple",
              choices: [
                { choiceId: "c1", text: "りんご" },
                { choiceId: "c1", text: "バナナ" },
                { choiceId: "c3", text: "さくらんぼ" },
                { choiceId: "c4", text: "デート" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("duplicate choiceId"))).toBe(true);
  });

  it("detects duplicate choice text", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          quizzes: [
            {
              quizId: "q1",
              type: "choose-meaning",
              wordId: "apple",
              prompt: "apple",
              choices: [
                { choiceId: "c1", text: "りんご" },
                { choiceId: "c2", text: "りんご" },
                { choiceId: "c3", text: "さくらんぼ" },
                { choiceId: "c4", text: "デート" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("duplicate choice text"))).toBe(true);
  });
});

describe("loader helpers", () => {
  it("allWords returns empty array for empty deck", () => {
    expect(allWords({ ...baseDeck, lessons: [] })).toEqual([]);
  });

  it("allQuizzes returns empty array for unknown lesson", () => {
    expect(allQuizzes(baseDeck, "missing")).toEqual([]);
  });

  it("wordById returns undefined for unknown id", () => {
    expect(wordById(baseDeck, "unknown")).toBeUndefined();
  });

  it("pickLesson returns undefined for unknown lesson", () => {
    expect(pickLesson(baseDeck, "missing")).toBeUndefined();
  });
});

describe("parseDeckJson edge cases", () => {
  it("throws ContentLoadError with layer=0 for malformed JSON", async () => {
    await expect(parseDeckJson("{invalid", "bad.json")).rejects.toThrow(
      ContentLoadError,
    );
    try {
      await parseDeckJson("{invalid", "bad.json");
    } catch (e) {
      const err = e as ContentLoadError;
      expect(err.layer).toBe(0);
      expect(err.issues).toEqual([]);
    }
  });

  it("throws ContentLoadError with layer=2 for consistency-only violations", async () => {
    const json = JSON.stringify({
      schemaVersion: "1.0",
      deckId: "dup-words",
      level: "beginner",
      title: "Duplicate Words",
      lessons: [
        {
          lessonId: "l1",
          title: "L1",
          words: [
            ...baseDeck.lessons[0].words,
            { ...baseDeck.lessons[0].words[0] },
          ],
        },
      ],
    });
    try {
      await parseDeckJson(json, "dup.json");
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as ContentLoadError;
      expect(err.layer).toBe(2);
      expect(err.issues.length).toBeGreaterThan(0);
    }
  });
});
