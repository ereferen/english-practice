import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDate,
  levelIntervalDays,
  makeReviewState,
  nextReviewState,
  type Clock,
} from "./srs";
import type { ReviewState } from "../storage/types";

function fixedClock(iso: string): Clock {
  const d = new Date(iso);
  return {
    now: () => d,
    today: () => formatDate(d),
  };
}

const T = "2026-09-06T10:00:00+09:00";

const clock = fixedClock(T);

describe("nextReviewState", () => {
  it("新規正答で level=1 当日復習", () => {
    const result = nextReviewState(undefined, true, clock);
    expect(result.level).toBe(1);
    expect(result.dueAt).toBe("2026-09-06");
    expect(result.lastResult).toBe("correct");
    expect(result.correctStreak).toBe(1);
    expect(result.wrongTotal).toBe(0);
  });

  it("新規誤答で level=0 当日復習", () => {
    const result = nextReviewState(undefined, false, clock);
    expect(result.level).toBe(0);
    expect(result.dueAt).toBe("2026-09-06");
    expect(result.lastResult).toBe("wrong");
    expect(result.correctStreak).toBe(0);
    expect(result.wrongTotal).toBe(1);
  });

  it("連続正答で level 上昇", () => {
    let s = makeReviewState("deck", "word", { level: 0 });
    s = { ...s, ...nextReviewState(s, true, clock) };
    expect(s.level).toBe(1);
    s = { ...s, ...nextReviewState(s, true, clock) };
    expect(s.level).toBe(2);
    expect(s.dueAt).toBe(addDays("2026-09-06", 1));
    s = { ...s, ...nextReviewState(s, true, clock) };
    expect(s.level).toBe(3);
    expect(s.dueAt).toBe(addDays("2026-09-06", 4));
  });

  it("level3 誤答は level1 降格", () => {
    const s = makeReviewState("deck", "word", { level: 3 });
    const result = nextReviewState(s, false, clock);
    expect(result.level).toBe(1);
    expect(result.dueAt).toBe("2026-09-06");
    expect(result.correctStreak).toBe(0);
  });

  it("level2 誤答は level0 降格", () => {
    const s = makeReviewState("deck", "word", { level: 2 });
    const result = nextReviewState(s, false, clock);
    expect(result.level).toBe(0);
    expect(result.dueAt).toBe("2026-09-06");
  });

  it("誤答で streak リセット", () => {
    const s = makeReviewState("deck", "word", { level: 2, correctStreak: 3 });
    const result = nextReviewState(s, false, clock);
    expect(result.correctStreak).toBe(0);
    expect(result.wrongTotal).toBe(1);
  });

  it("correct streak increments across multiple correct answers", () => {
    let s: ReviewState | undefined;
    s = {
      ...makeReviewState("deck", "word"),
      ...nextReviewState(s, true, clock),
    };
    expect(s.correctStreak).toBe(1);
    s = { ...s, ...nextReviewState(s, true, clock) };
    expect(s.correctStreak).toBe(2);
    s = { ...s, ...nextReviewState(s, true, clock) };
    expect(s.correctStreak).toBe(3);
    expect(s.level).toBe(3);
  });

  it("wrongTotal increments across multiple wrong answers", () => {
    let s: ReviewState | undefined;
    s = {
      ...makeReviewState("deck", "word"),
      ...nextReviewState(s, false, clock),
    };
    expect(s.wrongTotal).toBe(1);
    s = { ...s, ...nextReviewState(s, false, clock) };
    expect(s.wrongTotal).toBe(2);
  });

  it("does not exceed level 3", () => {
    const s = makeReviewState("deck", "word", { level: 3, correctStreak: 3 });
    const result = nextReviewState(s, true, clock);
    expect(result.level).toBe(3);
  });

  it("updates lastSeenAt to current ISO timestamp", () => {
    const result = nextReviewState(undefined, true, clock);
    expect(result.lastSeenAt).toBe(new Date(T).toISOString());
  });
});

describe("levelIntervalDays", () => {
  it("returns expected intervals for each level", () => {
    expect(levelIntervalDays(0)).toBe(0);
    expect(levelIntervalDays(1)).toBe(0);
    expect(levelIntervalDays(2)).toBe(1);
    expect(levelIntervalDays(3)).toBe(4);
  });
});

describe("makeReviewState", () => {
  it("creates a default review state", () => {
    const state = makeReviewState("deck", "word");
    expect(state.deckId).toBe("deck");
    expect(state.wordId).toBe("word");
    expect(state.level).toBe(0);
    expect(state.lastResult).toBeNull();
    expect(state.lastSeenAt).toBeNull();
    expect(state.dueAt).toBeNull();
    expect(state.correctStreak).toBe(0);
    expect(state.wrongTotal).toBe(0);
  });

  it("applies overrides", () => {
    const state = makeReviewState("deck", "word", { level: 2, wrongTotal: 5 });
    expect(state.level).toBe(2);
    expect(state.wrongTotal).toBe(5);
  });
});

describe("addDays", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("subtracts days", () => {
    expect(addDays("2026-09-06", -1)).toBe("2026-09-05");
  });

  it("returns same date for 0 days", () => {
    expect(addDays("2026-09-06", 0)).toBe("2026-09-06");
  });
});
