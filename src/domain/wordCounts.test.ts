import { describe, expect, it } from "vitest";
import type { Deck } from "../content/schema";
import { allWords, loadBundledDecks } from "../content/loader";
import { CONVERSATION_DECK_ID } from "./conversationExtract";
import { MANUAL_DECK_ID } from "./manualDeck";
import { countWordsByOwnership } from "./wordCounts";

async function sampleDeck(): Promise<Deck> {
  const { decks } = await loadBundledDecks();
  return decks[0].deck;
}

describe("countWordsByOwnership (issue #291)", () => {
  it("サンプル同梱デッキは sample、source:manual は own に数える", async () => {
    const sample = await sampleDeck();
    const own: Deck = {
      ...sample,
      deckId: MANUAL_DECK_ID,
      source: "manual",
    };

    const counts = countWordsByOwnership([sample, own]);
    const perDeck = allWords(sample).length;

    expect(counts.sample).toBe(perDeck);
    expect(counts.own).toBe(perDeck);
    expect(counts.total).toBe(perDeck * 2);
  });

  it("会話抽出デッキも自分の語として数え、合計は全デッキの語数と一致する", async () => {
    const { decks: bundled } = await loadBundledDecks();
    const sample = bundled[0].deck;
    const conversation: Deck = {
      ...sample,
      deckId: CONVERSATION_DECK_ID,
      source: "conversation",
    };
    const all = [sample, conversation];

    const counts = countWordsByOwnership(all);
    const expectedTotal = all.reduce((acc, d) => acc + allWords(d).length, 0);

    expect(counts.total).toBe(expectedTotal);
    // サンプルだけを除いた数（= 自分の語数）が全デッキ数より小さい
    expect(counts.own).toBeGreaterThan(0);
    expect(counts.sample).toBeGreaterThan(0);
  });

  it("デッキが無ければ全て 0", () => {
    expect(countWordsByOwnership([])).toEqual({ own: 0, sample: 0, total: 0 });
  });
});
