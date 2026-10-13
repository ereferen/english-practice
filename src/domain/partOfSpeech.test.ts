import { describe, expect, it } from "vitest";
import { PART_OF_SPEECH_LABELS, partOfSpeechLabel } from "./partOfSpeech";

describe("partOfSpeechLabel (issue #187)", () => {
  it("品詞を日本語ラベルで返す", () => {
    expect(partOfSpeechLabel("noun")).toBe("名詞");
    expect(partOfSpeechLabel("verb")).toBe("動詞");
    expect(partOfSpeechLabel("adjective")).toBe("形容詞");
  });

  it('未指定・"other" はバッジを出さないため空文字', () => {
    expect(partOfSpeechLabel(undefined)).toBe("");
    expect(partOfSpeechLabel("other")).toBe("");
  });

  it("全キーが定義されている", () => {
    for (const [key, label] of Object.entries(PART_OF_SPEECH_LABELS)) {
      expect(typeof label).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
