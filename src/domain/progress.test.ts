import { describe, expect, it } from "vitest";
import { computeProgress, streakDays } from "./progress";
import type { ReviewState } from "../storage/types";

function review(overrides: Partial<ReviewState>): ReviewState {
  return {
    deckId: "d",
    wordId: "w",
    level: 0,
    lastResult: null,
    lastSeenAt: null,
    dueAt: null,
    correctStreak: 0,
    wrongTotal: 0,
    ...overrides,
  };
}

describe("computeProgress", () => {
  it("calculates progress summary", () => {
    const states = [
      review({ level: 1 }),
      review({ level: 2, dueAt: "2026-09-06" }),
      review({ level: 0, wrongTotal: 2 }),
    ];
    const summary = computeProgress(5, states, "2026-09-06", 3, 10);
    expect(summary.totalWords).toBe(5);
    expect(summary.learnedWords).toBe(2);
    expect(summary.dueToday).toBe(1);
    expect(summary.weakWords).toBe(1);
    expect(summary.todayAnswered).toBe(3);
    expect(summary.dailyGoalWords).toBe(10);
  });
});

describe("streakDays", () => {
  it("counts consecutive days including today", () => {
    expect(
      streakDays(["2026-09-06", "2026-09-05", "2026-09-03"], "2026-09-06"),
    ).toBe(3);
  });

  it("returns 0 when no sessions", () => {
    expect(streakDays([], "2026-09-06")).toBe(0);
  });
});
