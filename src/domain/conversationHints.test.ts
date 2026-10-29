import { describe, expect, it } from "vitest";
import type { ChatMessage, ConversationTopic } from "./conversation";
import {
  MAX_HINTS,
  applyHint,
  buildHintPrompt,
  parseHintResult,
} from "./conversationHints";

function msg(
  id: string,
  role: ChatMessage["role"],
  content: string,
  kind?: ChatMessage["kind"],
): ChatMessage {
  return { id, role, content, createdAt: "2026-10-29T10:00:00+09:00", kind };
}

const CONVO: ChatMessage[] = [
  msg("m0", "user", "I played Hollow Knight yesterday."),
  msg("m1", "assistant", "Nice! What part are you at right now?"),
];

const TOPIC: ConversationTopic = {
  id: "gaming",
  label: "ゲーム",
  emoji: "🎮",
  directive: "",
  opener: "",
  switchLine: "",
};

describe("buildHintPrompt (#234)", () => {
  it("直近の LEARNER / PARTNER 発言と話題を渡す", () => {
    const p = buildHintPrompt(CONVO, TOPIC);
    expect(p).toContain("LEARNER: I played Hollow Knight yesterday.");
    expect(p).toContain("PARTNER: Nice! What part are you at right now?");
    expect(p).toContain("ゲーム");
    expect(p).toContain("B1-B2");
  });

  it("note 行（話題開始の注記）は文脈に混ぜない", () => {
    const p = buildHintPrompt([...CONVO, msg("m2", "system", "注記", "note")]);
    expect(p).not.toContain("注記");
  });
});

describe("parseHintResult (#234)", () => {
  it("コードフェンス付き JSON 配列を読む", () => {
    const hints = parseHintResult(
      '```json\n["I just beat the boss.", "It is hard but fun.", "What about you?"]\n```',
    );
    expect(hints).toEqual([
      "I just beat the boss.",
      "It is hard but fun.",
      "What about you?",
    ]);
  });

  it("配列が無い・壊れた応答は空配列", () => {
    expect(parseHintResult("Sorry, I cannot help with that.")).toEqual([]);
    expect(parseHintResult("[not json")).toEqual([]);
    expect(parseHintResult("")).toEqual([]);
  });

  it("長すぎる候補は落とし、最大 3 件に切る", () => {
    const long = "a".repeat(200);
    const hints = parseHintResult(
      JSON.stringify(["one", long, "two", "three", "four"]),
    );
    expect(hints).toEqual(["one", "two", "three"]);
    expect(hints.length).toBeLessThanOrEqual(MAX_HINTS);
  });
});

describe("applyHint (#234)", () => {
  it("入力欄が空なら候補をそのまま入れる", () => {
    expect(applyHint("  ", "What about you?")).toBe("What about you?");
  });

  it("書きかけの文は消さず後ろに足す", () => {
    expect(applyHint("I think", "it is fun.")).toBe("I think it is fun.");
  });
});
