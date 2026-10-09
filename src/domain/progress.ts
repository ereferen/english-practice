import type { ReviewState } from "../storage/types";

export interface ProgressSummary {
  totalWords: number;
  learnedWords: number;
  dueToday: number;
  weakWords: number;
  streakDays: number;
  todayAnswered: number;
  dailyGoalWords: number;
}

export function computeProgress(
  wordsCount: number,
  reviewStates: ReviewState[],
  today: string,
  todayAnswered: number,
  dailyGoalWords: number,
): ProgressSummary {
  const learnedWords = reviewStates.filter((r) => r.level > 0).length;
  const dueToday = reviewStates.filter(
    (r) => r.dueAt && r.dueAt <= today,
  ).length;
  const weakWords = reviewStates.filter((r) => r.wrongTotal >= 2).length;
  return {
    totalWords: wordsCount,
    learnedWords,
    dueToday,
    weakWords,
    streakDays: 0,
    todayAnswered,
    dailyGoalWords,
  };
}

export function completionRate(summary: ProgressSummary): number {
  if (summary.totalWords === 0) return 0;
  return Math.round((summary.learnedWords / summary.totalWords) * 100);
}

export function dailyGoalRate(summary: ProgressSummary): number {
  if (summary.dailyGoalWords === 0) return 0;
  return Math.min(1, summary.todayAnswered / summary.dailyGoalWords);
}

/** Issue #177: 回答数が少ないうちは平均正答率を「参考値」扱いにする */
export const LOW_SAMPLE_ANSWER_THRESHOLD = 10;

export function isLowSample(answerCount: number): boolean {
  return answerCount < LOW_SAMPLE_ANSWER_THRESHOLD;
}

/** Issue #177: 学習した日数（重複日を除く）。askedAt は ISO 日時 */
export function countStudyDays(answers: { askedAt: string }[]): number {
  return new Set(answers.map((a) => a.askedAt.slice(0, 10))).size;
}

export function streakDays(sessionDates: string[], today: string): number {
  const dates = Array.from(new Set(sessionDates.slice().sort().reverse()));
  let streak = 0;
  let cursor = today;
  for (const d of dates) {
    if (d === cursor) {
      streak += 1;
      cursor = addDays(cursor, -1);
    } else if (d === addDays(cursor, -1)) {
      streak += 1;
      cursor = d;
    } else if (d < cursor) {
      break;
    }
  }
  return streak;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}
