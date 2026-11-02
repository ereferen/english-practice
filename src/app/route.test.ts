import { describe, expect, it } from "vitest";
import { hashToScreen, screenDeckId, screenToHash } from "./route";
import type { Screen } from "./types";

/** Issue #241: Screen ⇄ ハッシュの round-trip と、壊れた URL の扱い。 */

const routable: Screen[] = [
  { name: "home" },
  { name: "deckList" },
  { name: "deckHome", deckId: "daily-smalltalk" },
  { name: "flash", deckId: "daily-smalltalk", lessonId: "l01" },
  { name: "quiz", deckId: "daily-smalltalk", lessonId: "l01" },
  { name: "progress" },
  { name: "review" },
  { name: "review", deckId: "daily-smalltalk" },
  { name: "dashboard" },
  { name: "settings" },
  { name: "conversation" },
];

describe("screenToHash / hashToScreen", () => {
  it.each(routable.map((s) => [JSON.stringify(s), s] as const))(
    "round-trips %s",
    (_label, screen) => {
      const hash = screenToHash(screen);
      expect(hash).not.toBeNull();
      expect(hashToScreen(hash as string)).toEqual(screen);
    },
  );

  it("gives every routable screen a distinct hash", () => {
    const hashes = routable.map((s) => screenToHash(s));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("keeps result out of the URL (answers are not serialisable)", () => {
    expect(
      screenToHash({
        name: "result",
        deckId: "daily-smalltalk",
        lessonId: "l01",
        answers: [],
      }),
    ).toBeNull();
  });

  it("encodes deck / lesson ids", () => {
    const hash = screenToHash({
      name: "flash",
      deckId: "a b/c",
      lessonId: "l 1",
    });
    expect(hash).toBe("#/deck/a%20b%2Fc/lesson/l%201");
    expect(hashToScreen(hash as string)).toEqual({
      name: "flash",
      deckId: "a b/c",
      lessonId: "l 1",
    });
  });

  it("treats a bare hash and the base URL as home", () => {
    expect(hashToScreen("")).toEqual({ name: "home" });
    expect(hashToScreen("#")).toEqual({ name: "home" });
    expect(hashToScreen("#/")).toEqual({ name: "home" });
  });

  it.each([
    ["#/nope", "unknown path"],
    ["#/deck", "deck without id"],
    ["#/deck/x/lesson", "lesson without id"],
    ["#/deck/x/lesson/l/extra", "too deep"],
    ["#/deck/x/bogus", "unknown deck sub-page"],
    ["#/deck/%E0%A4%A", "broken percent escape"],
  ])("falls back to home for %s (%s)", (hash) => {
    expect(hashToScreen(hash)).toEqual({ name: "home" });
  });

  it("ignores a query string before the path match", () => {
    expect(hashToScreen("#/dashboard?x=1")).toEqual({ name: "dashboard" });
  });
});

describe("screenDeckId", () => {
  it("returns the deck for deck-scoped screens only", () => {
    expect(screenDeckId({ name: "deckHome", deckId: "d" })).toBe("d");
    expect(screenDeckId({ name: "review", deckId: "d" })).toBe("d");
    expect(screenDeckId({ name: "review" })).toBeUndefined();
    expect(screenDeckId({ name: "home" })).toBeUndefined();
  });
});
