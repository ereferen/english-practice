/**
 * Manual verification script for the content loader against sample data.
 *
 * Run:  npx vitest run tests/verify-loader-samples.ts --reporter verbose
 *
 * This test suite covers:
 *   1. Valid sample → loads successfully, returns a LoadedDeck
 *   2. Invalid sample → throws ContentLoadError with field-specific messages
 *   3. Verifies each deliberate violation is recognised (Zod layer + consistency layer)
 */

import { describe, expect, it } from "vitest";
import {
  loadDeckFromFile,
  ContentLoadError,
  parseDeckJson,
} from "../src/content/loader";

const VALID_SAMPLE = "/home/tenki/project/english-practice/tests/fixtures/valid-sample.json";
const INVALID_SAMPLE = "/home/tenki/project/english-practice/tests/fixtures/invalid-sample.json";

describe("=== VERIFICATION: Valid sample ===", () => {
  it("loads valid-sample.json without error", async () => {
    const result = await loadDeckFromFile(VALID_SAMPLE, "valid-sample.json");
    expect(result.deck.deckId).toBe("fixture-valid-sample");
    expect(result.deck.title).toBe("テスト用バリッドサンプル");
    expect(result.deck.level).toBe("beginner");
    expect(result.deck.lessons).toHaveLength(1);
    expect(result.deck.lessons[0].words).toHaveLength(5);
    expect(result.deck.lessons[0].quizzes).toHaveLength(3);
    expect(result.source).toBe("bundled");
    expect(result.url).toBe("valid-sample.json");
  });

  it("valid sample — quizzes reference real wordIds", async () => {
    const result = await loadDeckFromFile(VALID_SAMPLE, "valid-sample.json");
    const wordIds = new Set(result.deck.lessons[0].words.map((w) => w.wordId));
    for (const quiz of result.deck.lessons[0].quizzes!) {
      expect(wordIds.has(quiz.wordId)).toBe(true);
    }
  });

  it("valid sample — each quiz has exactly 4 choices", async () => {
    const result = await loadDeckFromFile(VALID_SAMPLE, "valid-sample.json");
    for (const quiz of result.deck.lessons[0].quizzes!) {
      expect(quiz.choices).toHaveLength(4);
    }
  });
});

describe("=== VERIFICATION: Invalid sample — Zod layer (layer=1) ===", () => {
  let error: ContentLoadError;

  beforeAll(async () => {
    try {
      await loadDeckFromFile(INVALID_SAMPLE, "invalid-sample.json");
      expect.unreachable("Should have thrown ContentLoadError");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      error = e as ContentLoadError;
    }
  });

  it("throws ContentLoadError", () => {
    // already verified in beforeAll
  });

  it("error.layer is 1 (Zod validation)", () => {
    expect(error.layer).toBe(1);
  });

  it("error.issues contains field-specific messages", () => {
    // The invalid sample has several deliberate Zod violations:
    //   level: "unknown" → invalid enum
    //   word "empty-term": term="" → too short
    //   word "no-examples": missing examples → insufficient items
    //   quiz "q-invalid-size": 3 choices → too few
    console.log("--- Zod issues ---");
    for (const issue of error.issues) {
      console.log(`  [${error.layer}] ${issue}`);
    }

    // We expect multiple issues
    expect(error.issues.length).toBeGreaterThan(0);
  });

  it("reports invalid enum for level (expected 'beginner' | 'intermediate' | 'advanced', got 'unknown')", () => {
    const hasLevelIssue = error.issues.some(
      (i) => i.startsWith("level") && i.includes("Invalid enum value"),
    );
    expect(hasLevelIssue).toBe(true);
  });

  it("reports empty term at lessons.0.words.0.term", () => {
    const hasEmptyTerm = error.issues.some(
      (i) => i.startsWith("lessons.0.words.0.term") && i.includes("at least 1 character"),
    );
    expect(hasEmptyTerm).toBe(true);
  });

  it("reports missing examples at lessons.0.words.1.examples", () => {
    const hasMissingExamples = error.issues.some(
      (i) => i.startsWith("lessons.0.words.1.examples") && i.includes("Required"),
    );
    expect(hasMissingExamples).toBe(true);
  });

  it("reports quiz with insufficient choices (3 instead of 4) at lessons.0.quizzes.0.choices", () => {
    const hasChoiceCountIssue = error.issues.some(
      (i) => i.startsWith("lessons.0.quizzes.0.choices") && i.includes("exactly 4 element(s)"),
    );
    expect(hasChoiceCountIssue).toBe(true);
  });
});

describe("=== VERIFICATION: Invalid sample — JSON parse layer (layer=0) ===", () => {
  it("malformed JSON produces layer=0 error with context", async () => {
    try {
      await parseDeckJson("{broken", "broken.json");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;
      expect(err.layer).toBe(0);
      expect(err.message).toContain("broken.json");
      expect(err.message).toContain("invalid JSON");
      console.log("--- JSON parse error (layer=0) ---");
      console.log(`  message: ${err.message}`);
      console.log(`  issues:  ${JSON.stringify(err.issues)}`);
    }
  });
});

describe("=== VERIFICATION: Consistency check layer (layer=2) — via parseDeckJson ===", () => {
  /**
   * Build a deck that passes Zod but has consistency violations:
   *   - duplicate wordId
   *   - quiz referencing unknown wordId
   *   - answerChoiceId not in choices
   */
  const badConsistencyJson = JSON.stringify({
    schemaVersion: "1.0",
    deckId: "consistency-bad",
    level: "beginner",
    title: "Bad Consistency",
    lessons: [
      {
        lessonId: "l1",
        title: "L1",
        words: [
          {
            wordId: "dup",
            term: "first",
            reading: "r1",
            meaning: "m1",
            examples: [{ en: "First." }],
          },
          {
            wordId: "dup",
            term: "second",
            reading: "r2",
            meaning: "m2",
            examples: [{ en: "Second." }],
          },
        ],
        quizzes: [
          {
            quizId: "q-orphan",
            type: "choose-meaning",
            wordId: "ghost",
            prompt: "ghost?",
            choices: [
              { choiceId: "c1", text: "A" },
              { choiceId: "c2", text: "B" },
              { choiceId: "c3", text: "C" },
              { choiceId: "c4", text: "D" },
            ],
            answerChoiceId: "c1",
          },
          {
            quizId: "q-bad-answer",
            type: "choose-meaning",
            wordId: "dup",
            prompt: "dup?",
            choices: [
              { choiceId: "c1", text: "A" },
              { choiceId: "c2", text: "B" },
              { choiceId: "c3", text: "C" },
              { choiceId: "c4", text: "D" },
            ],
            answerChoiceId: "c-missing",
          },
        ],
      },
    ],
  });

  it("throws ContentLoadError with layer=2 for consistency violations", async () => {
    try {
      await parseDeckJson(badConsistencyJson, "consistency.json");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContentLoadError);
      const err = e as ContentLoadError;
      expect(err.layer).toBe(2);
      console.log("--- Consistency issues (layer=2) ---");
      for (const issue of err.issues) {
        console.log(`  [${err.layer}] ${issue}`);
      }
      expect(err.issues.length).toBeGreaterThan(1);
      expect(err.issues.some((i) => i.includes("duplicate wordId"))).toBe(true);
      expect(err.issues.some((i) => i.includes("unknown wordId"))).toBe(true);
      expect(
        err.issues.some((i) => i.includes("answerChoiceId") && i.includes("not found")),
      ).toBe(true);
    }
  });
});