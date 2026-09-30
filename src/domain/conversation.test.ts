import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TOPICS,
  SYSTEM_PROMPT,
  buildSystemPrompt,
} from "./conversation";

/**
 * Issue #147: 英会話の入口がフリーチャットしか無く、毎回自分でネタを振る必要が
 * あった（ペルソナ aki）。話題プリセットとそこから組み立てる system プロンプトの
 * 契約をここで固定する。
 */
describe("buildSystemPrompt (issue #147)", () => {
  it("話題が未選択なら従来のプロンプトのまま（フリーチャットを壊さない）", () => {
    expect(buildSystemPrompt(null)).toBe(SYSTEM_PROMPT);
  });

  it("選択した話題の相手役・進め方が載る", () => {
    const gaming = CONVERSATION_TOPICS.find((t) => t.id === "gaming");
    expect(gaming).toBeTruthy();
    const prompt = buildSystemPrompt(gaming!);

    // 元のルールは残したまま足す
    expect(prompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("Topic mode: ゲーム");
    expect(prompt).toContain("North American online game server");
    // アドリブが弱い learner が振り続けなくて済むよう「相手がリードする」
    expect(prompt).toContain("Ask exactly ONE open question per reply");
  });

  it("プリセットは ID が重複せず、開始の一言と切替の一言を持つ", () => {
    const ids = CONVERSATION_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const t of CONVERSATION_TOPICS) {
      expect(t.opener.length).toBeGreaterThan(0);
      expect(t.switchLine.length).toBeGreaterThan(0);
      expect(t.directive.length).toBeGreaterThan(20);
    }
    // ペルソナが名指しした入口（ゲーム / 旅行 / 仕事の雑談 / 自己紹介）
    expect(ids).toContain("gaming");
    expect(ids).toContain("travel");
    expect(ids).toContain("work");
    expect(ids).toContain("selfintro");
  });

  it("仕事の話題は雑談から仕事英語へ段階的に進む指示を持つ", () => {
    const work = CONVERSATION_TOPICS.find((t) => t.id === "work")!;
    const prompt = buildSystemPrompt(work);
    expect(prompt).toContain("small talk");
    expect(prompt).toContain("work English");
  });
});
