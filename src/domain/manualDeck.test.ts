import { describe, expect, it } from "vitest";
import { deckSchema } from "../content/schema";
import {
  MANUAL_DECK_ID,
  buildManualDeck,
  editDeckWord,
  isOwnDeck,
  mergeIntoManualDeck,
  parseManualWords,
  removeDeckWord,
  renameDeck,
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

describe("自分のデッキを後から直す (issue #181)", () => {
  const base = buildManualDeck(
    [
      { term: "commute", meaning: "通勤する" },
      { term: "resilient", meaning: "粘り強い" },
    ],
    { now: "2026-10-11T00:00:00.000Z" },
  );

  it("isOwnDeck は手動・会話デッキだけ true を返す", () => {
    expect(isOwnDeck(base)).toBe(true);
    expect(
      isOwnDeck({ ...base, deckId: "sample-deck", source: "bundled" }),
    ).toBe(false);
  });

  it("renameDeck は名前を変える（空文字は無視）", () => {
    const renamed = renameDeck(base, "  旅行で使う語  ");
    expect(renamed.title).toBe("旅行で使う語");
    expect(renameDeck(base, "   ").title).toBe(base.title);
    expect(deckSchema.safeParse(renamed).success).toBe(true);
  });

  it("editDeckWord は語と意味と例文を書き換える（wordId は据え置き）", () => {
    const target = base.lessons[0].words[0];
    const r = editDeckWord(base, target.wordId, {
      term: "commute",
      meaning: "通勤する、往復する",
      example: "I commute by train.",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const word = r.deck.lessons[0].words[0];
    expect(word.wordId).toBe(target.wordId);
    expect(word.meaning).toBe("通勤する、往復する");
    expect(word.examples[0].en).toBe("I commute by train.");
    expect(deckSchema.safeParse(r.deck).success).toBe(true);
  });

  it("editDeckWord は他と重複する語/意味を弾く", () => {
    const target = base.lessons[0].words[0];
    const dupTerm = editDeckWord(base, target.wordId, {
      term: "resilient",
      meaning: "別の意味",
    });
    expect(dupTerm.ok).toBe(false);
    const dupMeaning = editDeckWord(base, target.wordId, {
      term: "new-term",
      meaning: "粘り強い",
    });
    expect(dupMeaning.ok).toBe(false);
  });

  it("removeDeckWord は1語だけ消し、最後の1語は消させない", () => {
    const target = base.lessons[0].words[1];
    const r = removeDeckWord(base, target.wordId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.lessons[0].words).toHaveLength(1);
    expect(deckSchema.safeParse(r.deck).success).toBe(true);

    const last = removeDeckWord(r.deck, r.deck.lessons[0].words[0].wordId);
    expect(last.ok).toBe(false);
    if (last.ok) return;
    expect(last.error).toContain("最後の1語");
  });
});
