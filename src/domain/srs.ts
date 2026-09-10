import type { ReviewState, SrsParams } from "../storage/types";

export interface Clock {
  now(): Date;
  today(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => formatDate(new Date()),
};

export function formatDate(d: Date): string {
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export interface NextReviewResult {
  level: 0 | 1 | 2 | 3;
  dueAt: string;
  lastResult: "correct" | "wrong";
  lastSeenAt: string;
  correctStreak: number;
  wrongTotal: number;
}

/**
 * issue #17: SRSパラメータはユーザー単位で上書き可能（デフォルトは従来動作）。
 * params は省略可能 — 未設定なら従来の固定挙動と完全に一致させる。
 */
export function nextReviewState(
  state: ReviewState | undefined,
  correct: boolean,
  clock: Clock = systemClock,
  params?: SrsParams,
): NextReviewResult {
  const now = clock.now();
  const today = clock.today();
  const seenAt = now.toISOString();

  if (!state) {
    const level: 0 | 1 | 2 | 3 = correct ? 1 : 0;
    return {
      level,
      dueAt: level === 1 ? today : today,
      lastResult: correct ? "correct" : "wrong",
      lastSeenAt: seenAt,
      correctStreak: correct ? 1 : 0,
      wrongTotal: correct ? 0 : 1,
    };
  }

  if (correct) {
    const nextLevel: 0 | 1 | 2 | 3 = Math.min(3, state.level + 1) as
      0 | 1 | 2 | 3;
    const intervalDays = levelIntervalDays(nextLevel, params);
    return {
      level: nextLevel,
      dueAt: addDays(today, intervalDays),
      lastResult: "correct",
      lastSeenAt: seenAt,
      correctStreak: state.correctStreak + 1,
      wrongTotal: state.wrongTotal,
    };
  }

  const nextLevel: 0 | 1 | 2 | 3 =
    state.level === 3 ? (params?.level3WrongDemotesTo ?? 1) : 0;
  return {
    level: nextLevel,
    dueAt: today,
    lastResult: "wrong",
    lastSeenAt: seenAt,
    correctStreak: 0,
    wrongTotal: state.wrongTotal + 1,
  };
}

export function levelIntervalDays(
  level: 0 | 1 | 2 | 3,
  params?: SrsParams,
): number {
  const fromParams = params?.intervalDays?.[level];
  if (typeof fromParams === "number" && Number.isFinite(fromParams)) {
    return Math.max(0, Math.round(fromParams));
  }
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0;
    case 2:
      return 1;
    case 3:
      return 4;
  }
}

export function makeReviewState(
  deckId: string,
  wordId: string,
  overrides?: Partial<ReviewState>,
): ReviewState {
  return {
    deckId,
    wordId,
    level: 0,
    lastResult: null,
    lastSeenAt: null,
    dueAt: null,
    correctStreak: 0,
    wrongTotal: 0,
    ...overrides,
  };
}
