import { describe, expect, it } from "vitest";
import { DECK_LEVELS, deckLevelLabel } from "./deckLevel";

describe("deckLevelLabel", () => {
  it("データ上の値を日本語ラベルに変換する", () => {
    expect(deckLevelLabel("beginner")).toBe("初級");
    expect(deckLevelLabel("intermediate")).toBe("中級");
    expect(deckLevelLabel("advanced")).toBe("上級");
  });

  it("絞り込みの選択肢はやさしい順で3段階", () => {
    expect(DECK_LEVELS).toEqual(["beginner", "intermediate", "advanced"]);
  });

  it("ラベルに英語の生値が漏れない", () => {
    for (const level of DECK_LEVELS) {
      expect(deckLevelLabel(level)).not.toBe(level);
      expect(deckLevelLabel(level)).not.toMatch(/[a-z]/);
    }
  });
});
