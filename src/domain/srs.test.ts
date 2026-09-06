import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDate,
  makeReviewState,
  nextReviewState,
  type Clock,
} from "./srs";

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

  it("誤答で streak リセット", () => {
    const s = makeReviewState("deck", "word", { level: 2, correctStreak: 3 });
    const result = nextReviewState(s, false, clock);
    expect(result.correctStreak).toBe(0);
    expect(result.wrongTotal).toBe(1);
  });
});
