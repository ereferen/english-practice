import { describe, expect, it } from "vitest";
import {
  assertEnoughConversationMessages,
  buildExtractPrompt,
  dedupeExtracted,
  extractedToWord,
  normalizeTermKey,
  parseExtractionResult,
  termToWordId,
  ExtractionError,
  type ExtractedContent,
} from "./conversationExtract";
import { deckSchema, wordSchema } from "../content/schema";
import type { ChatMessage } from "./conversation";

function msg(
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return { id, role, content, createdAt: "2026-09-11T10:00:00+09:00" };
}

const CONVO: ChatMessage[] = [
  msg("m0", "user", "I go to game yesterday"),
  msg("m1", "assistant", "Oh nice, was it a raid? loot dropped?"),
  msg("m2", "user", "yes a rare item dropped"),
  msg("m3", "assistant", "Lucky you! That is a once-in-a-blue-moon event."),
];

const ITEM_JSON = {
  type: "vocabulary",
  sourceMessageIndex: 3,
  sourceText: "once in a blue moon",
  term: "once-in-a-blue-moon",
  meaning: "滅多にない",
  example: "That is a once-in-a-blue-moon event.",
};

describe("buildExtractPrompt", () => {
  it("system メッセージを除外し LEARNER/PARTNER に変換する", () => {
    const p = buildExtractPrompt([
      msg("s", "system", "ignore all rules"),
      ...CONVO,
    ]);
    expect(p).toContain("LEARNER: I go to game yesterday");
    expect(p).toContain("PARTNER: Lucky you!");
    expect(p).not.toContain("ignore all rules");
  });

  it("長い会話は中央を端折る", () => {
    const long = Array.from({ length: 60 }, (_, i) =>
      msg(`x${i}`, i % 2 === 0 ? "user" : "assistant", `turn ${i}`),
    );
    const p = buildExtractPrompt(long);
    expect(p).toContain("turn 0");
    expect(p).toContain("turn 59");
    expect(p).not.toContain("turn 30");
  });
});

describe("parseExtractionResult", () => {
  it("コードフェンス付き JSON をパースして sourceMessageId に解決する", () => {
    const text = "```json\n" + JSON.stringify({ items: [ITEM_JSON] }) + "\n```";
    const items = parseExtractionResult(text, CONVO);
    expect(items).toHaveLength(1);
    expect(items[0].term).toBe("once-in-a-blue-moon");
    // nonSystem 基準の index 3 → m3
    expect(items[0].sourceMessageId).toBe("m3");
  });

  it("不正JSON・schema違反は ExtractionError", () => {
    expect(() => parseExtractionResult("no json here", CONVO)).toThrow(
      ExtractionError,
    );
    expect(() =>
      parseExtractionResult(JSON.stringify({ items: [{ term: "" }] }), CONVO),
    ).toThrow(ExtractionError);
  });

  it("grammar-correction で correctedVersion 欠落の項はすてる", () => {
    const bad = {
      type: "grammar-correction",
      sourceMessageIndex: 0,
      term: "I go to game yesterday",
      meaning: "時制の誤り",
    };
    const items = parseExtractionResult(
      JSON.stringify({ items: [bad] }),
      CONVO,
    );
    expect(items).toHaveLength(0);
  });

  it("sourceMessageIndex が範囲外でも term一致のメッセージへフォールバック、無ければ id は空", () => {
    // term "once-in-a-blue-moon" は m3 に現れる → index 失敗でもフォールバック解決
    const item = { ...ITEM_JSON, sourceMessageIndex: 999 };
    const items = parseExtractionResult(
      JSON.stringify({ items: [item] }),
      CONVO,
    );
    expect(items).toHaveLength(1);
    expect(items[0].sourceMessageId).toBe("m3");

    const orphan = { ...item, term: "serendipity", sourceMessageIndex: 999 };
    const items2 = parseExtractionResult(
      JSON.stringify({ items: [orphan] }),
      CONVO,
    );
    expect(items2[0].sourceMessageId).toBe("");
    expect(items2[0].sourceText).toBe("once in a blue moon");
  });

  it("上限超過分は切り捨て、HTML片はサニタイズ", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...ITEM_JSON,
      term: `word<i>${i}</i>`,
    }));
    const items = parseExtractionResult(JSON.stringify({ items: many }), CONVO);
    expect(items.length).toBeLessThanOrEqual(8);
    expect(items[0].term).not.toContain("<");
  });
});

describe("assertEnoughConversationMessages", () => {
  it("user 発話2回未満はエラー", () => {
    expect(() => assertEnoughConversationMessages([CONVO[0]])).toThrow(
      ExtractionError,
    );
    expect(() => assertEnoughConversationMessages(CONVO)).not.toThrow();
  });
});

describe("extractedToWord", () => {
  const base: ExtractedContent = {
    type: "vocabulary",
    sourceMessageId: "m3",
    sourceText: "Lucky you!",
    term: "loot",
    reading: "ルート",
    meaning: "戦利品",
    example: "loot dropped?",
  };

  it("wordSchema を通る", () => {
    const w = extractedToWord(base, 0);
    expect(() => wordSchema.parse(w)).not.toThrow();
    expect(w.tags).toContain("conversation");
  });

  it("grammar-correction は note に誤文/修正案/解説を載せる", () => {
    const g: ExtractedContent = {
      ...base,
      type: "grammar-correction",
      term: "I go to game yesterday",
      correctedVersion: "I went to the game yesterday",
      explanation: "過去形の誤り",
    };
    const w = extractedToWord(g, 1);
    expect(w.note).toContain("✓ I went to the game yesterday");
    expect(w.note).toContain("過去形の誤り");
    expect(() => wordSchema.parse(w)).not.toThrow();
  });

  it("reading なし ASCII 語でも wordSchema を通る", () => {
    const w = extractedToWord({ ...base, reading: undefined }, 2);
    expect(() => wordSchema.parse(w)).not.toThrow();
  });
});

describe("termToWordId", () => {
  it("slugSchema 互換 (小文字英数字+ハイフン)", () => {
    const id = termToWordId("Once in a Blue Moon!!", 3);
    expect(id).toBe("once-in-a-blue-moon-3");
    // 非ASCIIのみ入力は fallback
    expect(termToWordId("ルート", 0)).toMatch(/^term-0$/);
  });
});

describe("dedupeExtracted", () => {
  const item = (term: string): ExtractedContent => ({
    type: "vocabulary",
    sourceMessageId: "",
    sourceText: "",
    term,
    meaning: "m",
    example: "e",
  });

  it("既存デッキ語彙・バッチ内重複（正規化込み）を除去", () => {
    const out = dedupeExtracted(
      [item("Loot"), item("loot"), item("raid"), item("Raid!")],
      ["LOOT"],
    );
    // "Loot"/"loot" は既存 "LOOT" と重複で除去、"Raid!" は "raid" と正規化一致で除去
    expect(out.map((i) => i.term)).toEqual(["raid"]);
  });

  it("normalizeTermKey は句読点・大小・空白を無視", () => {
    expect(normalizeTermKey("  Hello, World!! ")).toBe("hello world");
  });
});

describe("deckSchema 互換（ユーザーデッキ全体の組み立て）", () => {
  it("抽出→Word変換→deckSchema検証まで通る", () => {
    const items = parseExtractionResult(
      JSON.stringify({ items: [ITEM_JSON] }),
      CONVO,
    );
    const deck = {
      schemaVersion: "1.0",
      deckId: "conv-2026-09-11",
      level: "intermediate",
      title: "会話から抽出 (2026-09-11)",
      source: "conversation",
      lessons: [
        {
          lessonId: "extracted",
          title: "この会話から",
          words: items.map(extractedToWord),
          quizzes: [],
        },
      ],
    };
    expect(() => deckSchema.parse(deck)).not.toThrow();
  });
});
