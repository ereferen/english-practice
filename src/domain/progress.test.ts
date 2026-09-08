import { describe, expect, it } from "vitest";
import {
  completionRate,
  computeProgress,
  dailyGoalRate,
  streakDays,
} from "./progress";
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

  it("returns zero counts for empty review states", () => {
    const summary = computeProgress(0, [], "2026-09-06", 0, 10);
    expect(summary.totalWords).toBe(0);
    expect(summary.learnedWords).toBe(0);
    expect(summary.dueToday).toBe(0);
    expect(summary.weakWords).toBe(0);
    expect(summary.todayAnswered).toBe(0);
  });

  it("counts words due on or before today", () => {
    const states = [
      review({ dueAt: "2026-09-05" }),
      review({ dueAt: "2026-09-06" }),
      review({ dueAt: "2026-09-07" }),
      review({ dueAt: null }),
    ];
    const summary = computeProgress(4, states, "2026-09-06", 0, 10);
    expect(summary.dueToday).toBe(2);
  });

  it("counts weak words with wrongTotal >= 2", () => {
    const states = [
      review({ wrongTotal: 1 }),
      review({ wrongTotal: 2 }),
      review({ wrongTotal: 5 }),
    ];
    const summary = computeProgress(3, states, "2026-09-06", 0, 10);
    expect(summary.weakWords).toBe(2);
  });
});

describe("completionRate", () => {
  it("returns 0 when totalWords is 0", () => {
    expect(completionRate({ totalWords: 0, learnedWords: 0 } as never)).toBe(0);
  });

  it("returns rounded percentage", () => {
    expect(completionRate({ totalWords: 3, learnedWords: 1 } as never)).toBe(
      33,
    );
    expect(completionRate({ totalWords: 4, learnedWords: 3 } as never)).toBe(
      75,
    );
    expect(completionRate({ totalWords: 4, learnedWords: 4 } as never)).toBe(
      100,
    );
  });
});

describe("dailyGoalRate", () => {
  it("returns 0 when dailyGoalWords is 0", () => {
    expect(
      dailyGoalRate({ dailyGoalWords: 0, todayAnswered: 5 } as never),
    ).toBe(0);
  });

  it("caps at 1 when answered exceeds goal", () => {
    expect(
      dailyGoalRate({ dailyGoalWords: 10, todayAnswered: 15 } as never),
    ).toBe(1);
  });

  it("returns exact ratio when below goal", () => {
    expect(
      dailyGoalRate({ dailyGoalWords: 10, todayAnswered: 4 } as never),
    ).toBe(0.4);
  });
});

describe("streakDays", () => {
  it("counts consecutive days including today", () => {
    expect(
      streakDays(["2026-09-06", "2026-09-05", "2026-09-04"], "2026-09-06"),
    ).toBe(3);
  });

  it("returns 0 when no sessions", () => {
    expect(streakDays([], "2026-09-06")).toBe(0);
  });

  it("returns 1 when only today exists", () => {
    expect(streakDays(["2026-09-06"], "2026-09-06")).toBe(1);
  });

  it("returns 0 when latest session is before today", () => {
    expect(streakDays(["2026-09-04"], "2026-09-06")).toBe(0);
  });

  it("ignores duplicate dates without breaking streak", () => {
    expect(
      streakDays(
        ["2026-09-06", "2026-09-06", "2026-09-05", "2026-09-05"],
        "2026-09-06",
      ),
    ).toBe(2);
  });

  it("stops at first gap", () => {
    expect(
      streakDays(
        ["2026-09-06", "2026-09-05", "2026-09-03", "2026-09-02"],
        "2026-09-06",
      ),
    ).toBe(4);
  });

  it("skips future dates when counting backward from today", () => {
    expect(
      streakDays(["2026-09-07", "2026-09-06", "2026-09-05"], "2026-09-06"),
    ).toBe(2);
  });
});
