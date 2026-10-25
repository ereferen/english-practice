import { describe, expect, it } from "vitest";
import {
  completionRate,
  computeProgress,
  countStudyDays,
  dailyGoalRate,
  deckListStat,
  isLowSample,
  lastNDates,
  LOW_SAMPLE_ANSWER_THRESHOLD,
  mondayWeekdayIndex,
  streakDays,
  studyDateSet,
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

// Issue #177: 進捗ダッシュボードの「週の振り返り」用ヘルパー
describe("isLowSample", () => {
  it("treats fewer than the threshold answers as low sample", () => {
    expect(isLowSample(0)).toBe(true);
    expect(isLowSample(LOW_SAMPLE_ANSWER_THRESHOLD - 1)).toBe(true);
  });

  it("treats the threshold and above as enough data", () => {
    expect(isLowSample(LOW_SAMPLE_ANSWER_THRESHOLD)).toBe(false);
    expect(isLowSample(100)).toBe(false);
  });
});

describe("countStudyDays", () => {
  it("counts distinct calendar days", () => {
    expect(
      countStudyDays([
        { askedAt: "2026-10-08T09:00:00.000Z" },
        { askedAt: "2026-10-08T21:00:00.000Z" },
        { askedAt: "2026-10-07T10:00:00.000Z" },
      ]),
    ).toBe(2);
  });

  it("returns 0 for no answers", () => {
    expect(countStudyDays([])).toBe(0);
  });
});

// Issue #177: 学習カレンダー用ヘルパー
describe("studyDateSet", () => {
  it("collects distinct study dates from answers", () => {
    const set = studyDateSet([
      { askedAt: "2026-10-08T09:00:00.000Z" },
      { askedAt: "2026-10-08T21:00:00.000Z" },
      { askedAt: "2026-10-07T10:00:00.000Z" },
    ]);
    expect(Array.from(set).sort()).toEqual(["2026-10-07", "2026-10-08"]);
  });

  it("returns an empty set for no answers", () => {
    expect(studyDateSet([]).size).toBe(0);
  });
});

describe("lastNDates", () => {
  it("returns n dates ascending ending at today", () => {
    expect(lastNDates("2026-10-10", 3)).toEqual([
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
  });

  it("crosses month boundaries", () => {
    expect(lastNDates("2026-10-01", 3)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("returns just today when n=1", () => {
    expect(lastNDates("2026-10-10", 1)).toEqual(["2026-10-10"]);
  });
});

describe("deckListStat (issue #195)", () => {
  it("語数・学習率・今日の復習数をまとめて返す", () => {
    const states = [
      review({ wordId: "a", level: 2, dueAt: "2026-10-16" }),
      review({ wordId: "b", level: 1, dueAt: "2026-10-20" }),
      review({ wordId: "c", level: 0, dueAt: "2026-10-01" }),
    ];
    const stat = deckListStat(4, states, "2026-10-16");
    expect(stat.totalWords).toBe(4);
    expect(stat.learnedWords).toBe(2);
    expect(stat.completion).toBe(50);
    expect(stat.dueToday).toBe(2); // 02-01 と 10-16 の2語
  });

  it("localStorage の学習済み語が多いときはそちらを学習率に使う", () => {
    const stat = deckListStat(4, [review({ level: 1 })], "2026-10-16", 3);
    expect(stat.learnedWords).toBe(3);
    expect(stat.completion).toBe(75);
  });

  it("語が0のデッキでも 0% を返し NaN にしない", () => {
    const stat = deckListStat(0, [], "2026-10-16");
    expect(stat.completion).toBe(0);
    expect(stat.dueToday).toBe(0);
  });
});

describe("mondayWeekdayIndex (issue #219)", () => {
  it("月曜始まりの曜日番号を返す（月=0 … 日=6）", () => {
    // 2026-10-19 は月曜、2026-10-25 は日曜
    expect(mondayWeekdayIndex("2026-10-19")).toBe(0);
    expect(mondayWeekdayIndex("2026-10-20")).toBe(1);
    expect(mondayWeekdayIndex("2026-10-24")).toBe(5);
    expect(mondayWeekdayIndex("2026-10-25")).toBe(6);
  });
});
