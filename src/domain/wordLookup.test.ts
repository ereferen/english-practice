import { describe, expect, it } from "vitest";
import {
  isHardWord,
  lookupWordKey,
  tokenizeForLookup,
} from "./wordLookup";

/**
 * #280: Intl.Segmenter は "co-op" を co / - / op に割るため、
 * 辞書ボタンが "co" と "op" の2つに分かれていた。
 */
describe("tokenizeForLookup", () => {
  it("ハイフンで繋がった複合語を1語として扱う", () => {
    const tokens = tokenizeForLookup("Nice, co-op is the best way to unwind.");
    const words = tokens.map((t) => t.word).filter((w): w is string => !!w);
    expect(words).toContain("co-op");
    expect(words).not.toContain("co");
    expect(words).not.toContain("op");
  });

  it("複数のハイフンを持つ語も1語にまとめる", () => {
    const tokens = tokenizeForLookup("It is a mother-in-law joke.");
    const words = tokens.map((t) => t.word).filter((w): w is string => !!w);
    expect(words).toContain("mother-in-law");
  });

  it("空白で離れたダッシュは語を繋がない", () => {
    const tokens = tokenizeForLookup("games — ranked only");
    const words = tokens.map((t) => t.word).filter((w): w is string => !!w);
    expect(words).toEqual(["games", "ranked", "only"]);
  });

  it("行末のハイフンで語を繋がない", () => {
    const tokens = tokenizeForLookup("well- known");
    const words = tokens.map((t) => t.word).filter((w): w is string => !!w);
    expect(words).toEqual(["well", "known"]);
  });

  it("分割しても連結すると元の文に戻る", () => {
    const samples = [
      "Nice, co-op is the best way to unwind.",
      "It is a mother-in-law joke.",
      "games — ranked only",
      "well- known",
      "don't stop, I'll wait…",
    ];
    for (const sample of samples) {
      expect(tokenizeForLookup(sample).map((t) => t.text).join("")).toBe(
        sample,
      );
    }
  });
});

describe("lookupWordKey", () => {
  it("ハイフン入りの複合語をキーとして受け付ける", () => {
    expect(lookupWordKey("co-op")).toBe("co-op");
    expect(lookupWordKey("Self-Intro")).toBe("self-intro");
  });

  it("機能語・記号・短すぎる語は引かない", () => {
    expect(lookupWordKey("the")).toBeNull();
    expect(lookupWordKey("-")).toBeNull();
    expect(lookupWordKey("42")).toBeNull();
    expect(lookupWordKey("a")).toBeNull();
    expect(lookupWordKey("co")).toBe("co");
  });
});

describe("isHardWord", () => {
  it("ハイフンは数えずに文字数で判定する", () => {
    expect(isHardWord("co-op")).toBe(false);
    expect(isHardWord("unwind")).toBe(true);
    expect(isHardWord("mother-in-law")).toBe(true);
  });
});
