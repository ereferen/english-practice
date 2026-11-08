import { describe, expect, it } from "vitest";
import { isMeaningfulExample, visibleExamples } from "./examples";
import type { Word } from "../content/schema";

function word(overrides: Partial<Word> = {}): Word {
  return {
    wordId: "resilient-1",
    term: "resilient",
    reading: "—",
    meaning: "粘り強い",
    examples: [{ en: "resilient" }],
    ...overrides,
  };
}

describe("isMeaningfulExample", () => {
  it("見出し語そのままの例文は例文とみなさない", () => {
    expect(isMeaningfulExample({ en: "resilient" }, "resilient")).toBe(false);
    expect(isMeaningfulExample({ en: " Resilient " }, "resilient")).toBe(false);
  });

  it("見出し語を含む文は例文として認める", () => {
    expect(
      isMeaningfulExample({ en: "She is resilient under pressure." }, "resilient"),
    ).toBe(true);
  });

  it("英語が空でも和訳があれば例文として認める", () => {
    expect(isMeaningfulExample({ en: "", ja: "粘り強い" }, "resilient")).toBe(
      true,
    );
    expect(isMeaningfulExample({ en: "", ja: "" }, "resilient")).toBe(false);
  });
});

describe("visibleExamples", () => {
  it("例文を空にして追加した語では例文が空になる（#256）", () => {
    expect(visibleExamples(word())).toEqual([]);
  });

  it("普通の例文はそのまま残る", () => {
    const w = word({ examples: [{ en: "I ate an apple.", ja: "りんごを食べた" }] });
    expect(visibleExamples(w)).toHaveLength(1);
  });

  it("複数のうち見出し語コピーだけ落とす", () => {
    const w = word({
      examples: [{ en: "resilient" }, { en: "Stay resilient." }],
    });
    expect(visibleExamples(w).map((e) => e.en)).toEqual(["Stay resilient."]);
  });
});
