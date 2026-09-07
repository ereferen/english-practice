import { describe, expect, it } from "vitest";
import { fixtureWords, wordById, wordsByIds } from "./fixtures";

describe("fixtureWords", () => {
  it("contains at least 10 words", () => {
    expect(fixtureWords.length).toBeGreaterThanOrEqual(10);
  });

  it("every fixture has required word fields", () => {
    for (const word of fixtureWords) {
      expect(word.wordId).toBeTruthy();
      expect(word.term).toBeTruthy();
      expect(word.reading).toBeTruthy();
      expect(word.meaning).toBeTruthy();
      expect(word.examples.length).toBeGreaterThan(0);
    }
  });

  it("wordIds are unique", () => {
    const ids = fixtureWords.map((w) => w.wordId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("wordById", () => {
  it("returns the matching word", () => {
    const word = wordById("ability");
    expect(word).toBeDefined();
    expect(word?.term).toBe("ability");
  });

  it("returns undefined for unknown id", () => {
    expect(wordById("not-a-word")).toBeUndefined();
  });
});

describe("wordsByIds", () => {
  it("returns words in requested order", () => {
    const result = wordsByIds(["focus", "global", "improve"]);
    expect(result.map((w) => w.wordId)).toEqual(["focus", "global", "improve"]);
  });

  it("skips unknown ids", () => {
    const result = wordsByIds(["ability", "missing", "challenge"]);
    expect(result.map((w) => w.wordId)).toEqual(["ability", "challenge"]);
  });
});
