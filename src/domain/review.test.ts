import { describe, expect, it } from "vitest";
import type { Deck, Word } from "../content/schema";
import type { ReviewState } from "../storage/types";
import { fixtureWords } from "../app/fixtures";
import { buildReviewItems } from "./review";

function makeReview(deckId: string, wordId: string): ReviewState {
  return {
    deckId,
    wordId,
    level: 1,
    lastResult: "correct",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    dueAt: "2026-09-20",
    correctStreak: 1,
    wrongTotal: 0,
  };
}

function makeDeck(deckId: string, words: Word[]): Deck {
  return {
    $schema: "",
    schemaVersion: "1.0",
    deckId,
    level: "beginner",
    title: `Deck ${deckId}`,
    lessons: [{ lessonId: "lesson-1", title: "L1", words, quizzes: [] }],
  };
}

describe("buildReviewItems (issue #114)", () => {
  it("builds one quiz item per due review", () => {
    const deck = makeDeck("d1", [...fixtureWords.slice(0, 6)]);
    const reviews = [
      makeReview("d1", "ability"),
      makeReview("d1", "achieve"),
      makeReview("d1", "benefit"),
    ];
    const items = buildReviewItems([deck], reviews);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.item.wordId))).toEqual(
      new Set(["ability", "achieve", "benefit"]),
    );
    for (const ri of items) {
      expect(ri.deckId).toBe("d1");
      expect(ri.item.choices).toHaveLength(4);
    }
  });

  it("skips reviews whose word or deck cannot be resolved", () => {
    const deck = makeDeck("d1", [...fixtureWords.slice(0, 6)]);
    const reviews = [
      makeReview("d1", "ability"),
      makeReview("missing-deck", "ability"),
      makeReview("d1", "not-a-word"),
    ];
    const items = buildReviewItems([deck], reviews);
    expect(items).toHaveLength(1);
    expect(items[0].item.wordId).toBe("ability");
  });

  it("de-duplicates the same deck+word pair", () => {
    const deck = makeDeck("d1", [...fixtureWords.slice(0, 6)]);
    const reviews = [makeReview("d1", "ability"), makeReview("d1", "ability")];
    const items = buildReviewItems([deck], reviews);
    expect(items).toHaveLength(1);
  });

  it("spans multiple decks, tagging each item with its deck", () => {
    const d1 = makeDeck("d1", [...fixtureWords.slice(0, 6)]);
    const d2 = makeDeck("d2", [...fixtureWords.slice(2, 8)]);
    const reviews = [makeReview("d1", "ability"), makeReview("d2", "benefit")];
    const items = buildReviewItems([d1, d2], reviews);
    expect(items).toHaveLength(2);
    const byWord = new Map(items.map((i) => [i.item.wordId, i.deckId]));
    expect(byWord.get("ability")).toBe("d1");
    expect(byWord.get("benefit")).toBe("d2");
  });
});
