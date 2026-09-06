import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import {
  allQuizzes,
  allWords,
  generateQuizzesForLesson,
  loadBundledDecks,
  pickLesson,
  validateDeckConsistency,
  wordById,
} from "./loader";
import type { Deck } from "./schema";

const baseDeck: Deck = {
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

describe("loadBundledDecks", () => {
  it("loads bundled decks from /content", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async (url: string | Request | URL) => {
        const file = String(url).split("/").pop() ?? "";
        const text = readFileSync(
          `/home/tenki/project/english-practice/public/content/${file}`,
          "utf8",
        );
        return new Response(text, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const { decks, errors } = await loadBundledDecks("");
      expect(errors.length).toBe(0);
      expect(decks.length).toBe(3);
      const ids = decks.map((d) => d.deck.deckId).sort();
      expect(ids).toEqual([
        "advanced-academic",
        "beginner-core",
        "intermediate-workplace",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports errors for unreachable decks", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { decks, errors } = await loadBundledDecks("");
    expect(decks.length).toBe(0);
    expect(errors.length).toBe(3);
    for (const err of errors) {
      expect(err.reason).toContain("HTTP 404");
    }
  });

  it("reports validation errors for malformed json", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: true }),
    } as Response);

    const { decks, errors } = await loadBundledDecks("");
    expect(decks.length).toBe(0);
    expect(errors.length).toBe(3);
    for (const err of errors) {
      expect(err.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("validateDeckConsistency", () => {
  it("returns no issues for a valid deck", () => {
    expect(validateDeckConsistency(baseDeck)).toEqual([]);
  });

  it("detects duplicate wordId", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          words: [
            ...baseDeck.lessons[0].words,
            { ...baseDeck.lessons[0].words[0], term: "orange" },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("duplicate wordId"))).toBe(true);
  });

  it("detects duplicate meaning", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          words: baseDeck.lessons[0].words.map((w, i) =>
            i === 1 ? { ...w, meaning: w.meaning } : w,
          ),
        },
      ],
    };
    expect(validateDeckConsistency(bad).length).toBe(0);

    const reallyBad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          words: baseDeck.lessons[0].words.map((w, i) =>
            i === 1 ? { ...w, meaning: baseDeck.lessons[0].words[0].meaning } : w,
          ),
        },
      ],
    };
    const issues = validateDeckConsistency(reallyBad);
    expect(issues.some((m) => m.includes("duplicate meaning"))).toBe(true);
  });

  it("detects a quiz referencing an unknown word", () => {
    const bad: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          quizzes: [
            {
              quizId: "q1",
              type: "choose-meaning",
              wordId: "unknown",
              prompt: "unknown",
              choices: [
                { choiceId: "c1", text: "a" },
                { choiceId: "c2", text: "b" },
                { choiceId: "c3", text: "c" },
                { choiceId: "c4", text: "d" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("unknown wordId"))).toBe(true);
  });

  it("detects a missing answer choice", () => {
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
                { choiceId: "c2", text: "バナナ" },
                { choiceId: "c3", text: "さくらんぼ" },
                { choiceId: "c4", text: "デート" },
              ],
              answerChoiceId: "c-missing",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("answerChoiceId") && m.includes("not found"))).toBe(true);
  });

  it("detects a choose-meaning answer that does not match the word meaning", () => {
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
                { choiceId: "c2", text: "バナナ" },
                { choiceId: "c3", text: "さくらんぼ" },
                { choiceId: "c4", text: "デート" },
              ],
              answerChoiceId: "c2",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("choose-meaning answer does not match"))).toBe(true);
  });

  it("detects a fill-blank prompt missing ___", () => {
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
              prompt: "I eat an apple.",
              choices: [
                { choiceId: "c1", text: "apple" },
                { choiceId: "c2", text: "アップル" },
                { choiceId: "c3", text: "りんご" },
                { choiceId: "c4", text: "banana" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const issues = validateDeckConsistency(bad);
    expect(issues.some((m) => m.includes("missing blank marker"))).toBe(true);
  });
});

describe("helpers", () => {
  it("allWords returns every word in the deck", () => {
    expect(allWords(baseDeck).length).toBe(4);
  });

  it("allQuizzes returns lesson quizzes when lessonId is given", () => {
    expect(allQuizzes(baseDeck, "l1")).toEqual([]);
  });

  it("wordById finds a word", () => {
    expect(wordById(baseDeck, "apple")?.term).toBe("apple");
    expect(wordById(baseDeck, "missing")).toBeUndefined();
  });

  it("pickLesson returns lesson with deck", () => {
    const result = pickLesson(baseDeck, "l1");
    expect(result).toBeDefined();
    expect(result?.lesson.lessonId).toBe("l1");
    expect(result?.deck.deckId).toBe("test");
  });
});

describe("generateQuizzesForLesson", () => {
  it("returns existing quizzes when the lesson already has them", () => {
    const deckWithQuizzes: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          quizzes: [
            {
              quizId: "existing",
              type: "choose-meaning",
              wordId: "apple",
              prompt: "apple",
              choices: [
                { choiceId: "c1", text: "りんご" },
                { choiceId: "c2", text: "バナナ" },
                { choiceId: "c3", text: "さくらんぼ" },
                { choiceId: "c4", text: "デート" },
              ],
              answerChoiceId: "c1",
            },
          ],
        },
      ],
    };
    const quizzes = generateQuizzesForLesson(deckWithQuizzes, "l1");
    expect(quizzes).toHaveLength(1);
    expect(quizzes[0].quizId).toBe("existing");
  });

  it("generates choose-meaning and fill-blank quizzes when quizzes array is empty", () => {
    const quizzes = generateQuizzesForLesson(baseDeck, "l1");
    expect(quizzes.length).toBeGreaterThan(0);
    for (const q of quizzes) {
      expect(q.choices).toHaveLength(4);
      const answer = q.choices.find((c) => c.choiceId === q.answerChoiceId);
      expect(answer).toBeDefined();
    }
  });

  it("returns an empty array for an unknown lesson", () => {
    expect(generateQuizzesForLesson(baseDeck, "missing")).toEqual([]);
  });
});
