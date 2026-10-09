import { describe, expect, it } from "vitest";
import { deckSchema } from "../content/schema";
import {
  MANUAL_DECK_ID,
  buildManualDeck,
  mergeIntoManualDeck,
  parseManualWords,
} from "./manualDeck";

describe("parseManualWords (issue #178)", () => {
  it("カンマ区切りで 語, 意味, 例文 を解釈する", () => {
    const r = parseManualWords("commute, 通勤する, I commute by train.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.words).toEqual([
      { term: "commute", meaning: "通勤する", example: "I commute by train." },
    ]);
  });

  it("タブ区切り・例文なしも受け付ける", () => {
    const r = parseManualWords("resilient\t粘り強い");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.words[0]).toEqual({ term: "resilient", meaning: "粘り強い" });
  });

  it("空行と # コメント行は無視する", () => {
    const r = parseManualWords("\n# コメント\nkeel, 竜骨\n\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.words).toHaveLength(1);
    expect(r.words[0].term).toBe("keel");
  });

  it("意味が無い行は行番号付きで弾く", () => {
    const r = parseManualWords("commute\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("1行目");
  });

  it("何も無ければエラー", () => {
    const r = parseManualWords("   \n\n");
    expect(r.ok).toBe(false);
  });
});

describe("buildManualDeck / mergeIntoManualDeck (issue #178)", () => {
  it("deckSchema 検証を通るデッキを組み立てる", () => {
    const deck = buildManualDeck([{ term: "commute", meaning: "通勤する" }], {
      now: "2026-10-10T00:00:00.000Z",
      level: "beginner",
    });
    expect(deck.deckId).toBe(MANUAL_DECK_ID);
    expect(deck.source).toBe("manual");
    expect(deck.level).toBe("beginner");
    expect(deck.title).toBe("手動追加 (2026-10-10)");
    expect(deckSchema.safeParse(deck).success).toBe(true);
  });

  it("既存デッキへ重複termをスキップして追加する", () => {
    const base = buildManualDeck([{ term: "commute", meaning: "通勤する" }], {
      now: "2026-10-10T00:00:00.000Z",
    });
    const { deck, added } = mergeIntoManualDeck(
      base,
      [
        { term: "commute", meaning: "通勤する" }, // 重複 → スキップ
        { term: "keel", meaning: "竜骨" },
      ],
      { now: "2026-10-11T00:00:00.000Z" },
    );
    expect(added).toBe(1);
    expect(deck.lessons[0].words).toHaveLength(2);
    expect(deck.title).toBe("手動追加 (2026-10-11)");
    expect(deckSchema.safeParse(deck).success).toBe(true);
    // wordId は一意
    const ids = deck.lessons[0].words.map((w) => w.wordId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("追加が無ければ既存をそのまま返す", () => {
    const base = buildManualDeck([{ term: "commute", meaning: "通勤する" }], {
      now: "2026-10-10T00:00:00.000Z",
    });
    const { deck, added } = mergeIntoManualDeck(
      base,
      [{ term: "commute", meaning: "通勤する" }],
      { now: "2026-10-11T00:00:00.000Z" },
    );
    expect(added).toBe(0);
    expect(deck.title).toBe(base.title);
  });
});
