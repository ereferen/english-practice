import { describe, expect, it } from "vitest";
import {
  allQuizzes,
  allWords,
  ContentLoadError,
  generateQuizzesForLesson,
  loadBundledDecks,
  loadDeckFromFile,
  parseDeckJson,
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
  it("loads 3 bundled decks from static imports", async () => {
    const { decks, errors } = await loadBundledDecks();
    expect(errors.length).toBe(0);
    expect(decks.length).toBe(3);
    const ids = decks.map((d) => d.deck.deckId).sort();
    expect(ids).toEqual([
      "advanced-academic",
      "beginner-core",
      "intermediate-workplace",
    ]);
  });

  it("all bundled decks pass Zod validation and consistency checks", async () => {
    const { decks, errors } = await loadBundledDecks();
    expect(errors.length).toBe(0);
    for (const d of decks) {
      expect(d.source).toBe("bundled");
      // Each deck should have at least one lesson with words
      expect(d.deck.lessons.length).toBeGreaterThan(0);
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
            i === 1
              ? { ...w, meaning: baseDeck.lessons[0].words[0].meaning }
              : w,
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
    expect(
      issues.some(
        (m) => m.includes("answerChoiceId") && m.includes("not found"),
      ),
    ).toBe(true);
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
    expect(
      issues.some((m) => m.includes("choose-meaning answer does not match")),
    ).toBe(true);
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
  it("keeps existing quizzes and supplements words they do not cover (issue #193)", () => {
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
    // 既存クイズは先頭で保持され、未カバーの 3 語が自動生成で補完される
    expect(quizzes[0].quizId).toBe("existing");
    const coveredWordIds = new Set(quizzes.map((q) => q.wordId));
    expect(coveredWordIds).toEqual(
      new Set(baseDeck.lessons[0].words.map((w) => w.wordId)),
    );
  });

  it("generates at least one quiz per lesson word even when the lesson has explicit quizzes", async () => {
    const { decks } = await loadBundledDecks();
    for (const { deck } of decks) {
      for (const lesson of deck.lessons) {
        const quizzes = generateQuizzesForLesson(deck, lesson.lessonId);
        if (lesson.words.length < 4) continue;
        const covered = new Set(quizzes.map((q) => q.wordId));
        for (const word of lesson.words) {
          expect(
            covered.has(word.wordId),
            `${deck.deckId}/${lesson.lessonId}: ${word.term} はクイズに出題されない`,
          ).toBe(true);
        }
      }
    }
  });

  // issue #202: 明示クイズありのレッスンで、未カバー語 1 語につき 2 問足されて
  // 「5 語のレッスンで 6 問 / 同じ語が 2 回」になっていた回帰の防止
  it("adds exactly one quiz per uncovered word when the lesson has explicit quizzes", () => {
    const fiveWords: Deck = {
      ...baseDeck,
      lessons: [
        {
          ...baseDeck.lessons[0],
          words: [
            ...baseDeck.lessons[0].words,
            {
              wordId: "egg",
              term: "egg",
              reading: "エッグ",
              meaning: "卵",
              examples: [{ en: "I ate an egg." }],
            },
          ],
          quizzes: ["apple", "banana", "date"].map((wordId) => ({
            quizId: `explicit-${wordId}`,
            type: "choose-meaning" as const,
            wordId,
            prompt: wordId,
            choices: [
              { choiceId: "c1", text: "a" },
              { choiceId: "c2", text: "b" },
              { choiceId: "c3", text: "c" },
              { choiceId: "c4", text: "d" },
            ],
            answerChoiceId: "c1",
          })),
        },
      ],
    };
    const quizzes = generateQuizzesForLesson(fiveWords, "l1");
    expect(quizzes).toHaveLength(fiveWords.lessons[0].words.length);
    const wordIds = quizzes.map((q) => q.wordId);
    expect(new Set(wordIds).size).toBe(wordIds.length);
    expect(quizzes.filter((q) => q.wordId === "egg")).toHaveLength(1);
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

  // issue #78: fill-blank choices must all be English terms (no kana/kanji)
  it("fill-blank choices never contain Japanese text", () => {
    const quizzes = generateQuizzesForLesson(baseDeck, "l1");
    const fillBlanks = quizzes.filter((q) => q.type === "fill-blank");
    expect(fillBlanks.length).toBeGreaterThan(0);
    for (const q of fillBlanks) {
      for (const c of q.choices) {
        expect(c.text).not.toMatch(/[\u3040-\u30ff\u4e00-\u9faf]/);
      }
      const target = baseDeck.lessons[0].words.find(
        (w) => w.wordId === q.wordId,
      );
      expect(q.choices.find((c) => c.choiceId === q.answerChoiceId)?.text).toBe(
        target?.term,
      );
    }
  });

  it("skips fill-blank when fewer than 3 English distractor terms exist", () => {
    const deck: Deck = {
      schemaVersion: "1.0",
      deckId: "few-distractors",
      level: "beginner",
      title: "few",
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
              term: "バナナ",
              reading: "バナナ",
              meaning: "バナナ",
              examples: [{ en: "I eat a banana." }],
            },
            {
              wordId: "cherry",
              term: "チェリー",
              reading: "チェリー",
              meaning: "さくらんぼ",
              examples: [{ en: "The cherry is red." }],
            },
            {
              wordId: "date",
              term: "デート",
              reading: "デート",
              meaning: "デート; 日付",
              examples: [{ en: "I have a date tonight." }],
            },
          ],
          quizzes: [],
        },
      ],
    };
    const quizzes = generateQuizzesForLesson(deck, "l1");
    expect(quizzes.filter((q) => q.type === "fill-blank")).toHaveLength(0);
    // choose-meaning is still generated
    expect(quizzes.filter((q) => q.type === "choose-meaning").length).toBe(4);
  });

  it("returns an empty array for an unknown lesson", () => {
    expect(generateQuizzesForLesson(baseDeck, "missing")).toEqual([]);
  });
});

describe("loadDeckFromFile", () => {
  it("loads a valid sample deck file", async () => {
    const result = await loadDeckFromFile(
      "/home/tenki/project/english-practice/src/content/data/beginner-core.json",
    );
    expect(result.deck.deckId).toBe("beginner-core");
    expect(result.deck.title).toBe("中学基本語彙 (サンプル)");
    expect(result.deck.lessons.length).toBe(3);
    expect(result.source).toBe("bundled");
  });

  it("throws ContentLoadError for a non-existent file", async () => {
    await expect(
      loadDeckFromFile("/tmp/nonexistent-deck.json"),
    ).rejects.toThrow(ContentLoadError);
    await expect(
      loadDeckFromFile("/tmp/nonexistent-deck.json"),
    ).rejects.toThrow(/cannot read file/);
  });

  it("throws ContentLoadError for an invalid JSON file", async () => {
    await expect(
      loadDeckFromFile("/home/tenki/project/english-practice/package.json"),
    ).rejects.toThrow(ContentLoadError);
    await expect(
      loadDeckFromFile("/home/tenki/project/english-practice/package.json"),
    ).rejects.toThrow(/Zod validation failed/);
  });
});

describe("parseDeckJson", () => {
  const validJson = `{
    "schemaVersion": "1.0",
    "deckId": "test-load",
    "level": "beginner",
    "title": "Test Load",
    "lessons": [
      {
        "lessonId": "l1",
        "title": "L1",
        "words": [
          {
            "wordId": "apple",
            "term": "apple",
            "reading": "アップル",
            "meaning": "りんご",
            "examples": [{ "en": "I eat an apple." }]
          },
          {
            "wordId": "banana",
            "term": "banana",
            "reading": "バナナ",
            "meaning": "バナナ",
            "examples": [{ "en": "I eat a banana." }]
          },
          {
            "wordId": "cherry",
            "term": "cherry",
            "reading": "チェリー",
            "meaning": "さくらんぼ",
            "examples": [{ "en": "Cherries are red." }]
          },
          {
            "wordId": "date",
            "term": "date",
            "reading": "デート",
            "meaning": "デート; 日付",
            "examples": [{ "en": "I have a date." }]
          }
        ]
      }
    ]
  }`;

  it("parses and validates a valid JSON string", async () => {
    const result = await parseDeckJson(validJson, "test-source");
    expect(result.deck.deckId).toBe("test-load");
    expect(result.source).toBe("bundled");
    expect(result.url).toBe("test-source");
  });

  it("throws ContentLoadError with layer=0 for malformed JSON", async () => {
    try {
      await parseDeckJson("{invalid", "bad.json");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;
      expect(err.layer).toBe(0);
      expect(err.message).toContain("bad.json");
    }
  });

  it("throws ContentLoadError with layer=1 for schema violations", async () => {
    try {
      await parseDeckJson(
        JSON.stringify({
          schemaVersion: "1.0",
          deckId: "Invalid Slug!",
          level: "beginner",
          title: "Test",
          lessons: [
            {
              lessonId: "l1",
              title: "L1",
              words: [
                {
                  wordId: "w1",
                  term: "test",
                  reading: "テスト",
                  meaning: "テスト",
                  examples: [{ en: "Test." }],
                },
              ],
            },
          ],
        }),
        "bad-slug.json",
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;
      expect(err.layer).toBe(1);
      expect(err.message).toContain("bad-slug.json");
    }
  });

  it("throws ContentLoadError with layer=1 for missing required top-level field", async () => {
    try {
      await parseDeckJson(
        JSON.stringify({
          schemaVersion: "1.0",
          deckId: "test",
          // missing level
          title: "Test",
          lessons: [
            {
              lessonId: "l1",
              title: "L1",
              words: [
                {
                  wordId: "w1",
                  term: "test",
                  reading: "テスト",
                  meaning: "テスト",
                  examples: [{ en: "Test." }],
                },
              ],
            },
          ],
        }),
        "missing-level.json",
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;
      expect(err.layer).toBe(1);
      expect(err.message).toContain("missing-level.json");
    }
  });

  it("throws ContentLoadError for unrecognized fields caught by Zod strict mode", async () => {
    // Zod's .strict() catches extra properties not in the schema.
    // The test verifies the pipeline catches and reports issues
    // with the correct source label.
    try {
      await parseDeckJson(
        JSON.stringify({
          schemaVersion: "1.0",
          deckId: "test",
          level: "beginner",
          title: "Test",
          extraField: "not-allowed",
          lessons: [
            {
              lessonId: "l1",
              title: "L1",
              words: [
                {
                  wordId: "w1",
                  term: "test",
                  reading: "テスト",
                  meaning: "テスト",
                  examples: [{ en: "Test." }],
                },
              ],
            },
          ],
        }),
        "extra-field.json",
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      expect((e as ContentLoadError).message).toContain("extra-field.json");
      expect((e as ContentLoadError).issues.length).toBeGreaterThan(0);
    }
  });

  it("throws ContentLoadError with layer=2 for consistency violations", async () => {
    // 1 word < minimum fails custom consistency check
    try {
      await parseDeckJson(
        JSON.stringify({
          schemaVersion: "1.0",
          deckId: "too-few",
          level: "beginner",
          title: "Too Few",
          lessons: [
            {
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
            },
          ],
        }),
        "too-few.json",
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;
      expect(err.layer).toBe(2);
      expect(err.message).toContain("too-few.json");
    }
  });
});

describe("ContentLoadError", () => {
  it("preserves layer and issues", () => {
    const err = new ContentLoadError("test error", 1, [
      "field1: required",
      "field2: type mismatch",
    ]);
    expect(err.name).toBe("ContentLoadError");
    expect(err.layer).toBe(1);
    expect(err.issues).toEqual(["field1: required", "field2: type mismatch"]);
    expect(err.message).toBe("test error");
  });
});

const FIXTURE_DIR = "/home/tenki/project/english-practice/tests/fixtures";

describe("load sample fixtures", () => {
  it("loads valid-sample.json without errors", async () => {
    const result = await loadDeckFromFile(`${FIXTURE_DIR}/valid-sample.json`);
    expect(result.deck.deckId).toBe("fixture-valid-sample");
    expect(result.deck.title).toBe("テスト用バリッドサンプル");
    expect(result.deck.lessons).toHaveLength(1);

    const lesson = result.deck.lessons[0];
    expect(lesson.words).toHaveLength(5);
    expect(lesson.quizzes).toHaveLength(3);

    const types = lesson.quizzes!.map((q) => q.type);
    expect(types).toContain("choose-meaning");
    expect(types).toContain("choose-term");
    expect(types).toContain("fill-blank");

    expect(result.source).toBe("bundled");
  });

  it("rejects invalid-sample.json with a descriptive ContentLoadError", async () => {
    try {
      await loadDeckFromFile(`${FIXTURE_DIR}/invalid-sample.json`);
      expect.unreachable("should have thrown ContentLoadError");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;

      // Should be caught at Zod layer (layer 1)
      expect(err.layer).toBe(1);

      // Message must identify the file
      expect(err.message).toContain("invalid-sample.json");

      // Message must identify the violating field and reason for each violation
      // 1. level: not one of the allowed enum values
      expect(err.message).toContain("level");
      expect(err.message).toContain("Invalid enum value");

      // 2. empty term (less than min 1 character)
      expect(err.message).toContain("term");
      expect(err.message).toContain("1 character");

      // 3. missing required 'examples'
      expect(err.message).toContain("examples");
      expect(err.message).toContain("Required");

      // 4. choices too short (not exactly 4 elements)
      expect(err.message).toContain("choices");
      expect(err.message).toContain("4 element");

      // All 4 violations should be reported together
      expect(err.issues.length).toBeGreaterThanOrEqual(4);
    }
  });
});
