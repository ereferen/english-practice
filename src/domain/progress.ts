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

/**
 * Issue #195: デッキ一覧の行に出す進捗（語数・学習率・今日の復習数）。
 * 学習率は DeckHome と同じく「review.level>0 と localStorage の学習済み語の和集合」
 * で数える（片方だけだと画面ごとに数字が食い違う）。
 */
export interface DeckListStat {
  totalWords: number;
  learnedWords: number;
  dueToday: number;
  completion: number;
}

export function deckListStat(
  wordsCount: number,
  reviewStates: ReviewState[],
  today: string,
  flashLearnedWords = 0,
): DeckListStat {
  const learnedWords = Math.max(
    reviewStates.filter((r) => r.level > 0).length,
    flashLearnedWords,
  );
  const dueToday = reviewStates.filter(
    (r) => r.dueAt && r.dueAt <= today,
  ).length;
  return {
    totalWords: wordsCount,
    learnedWords,
    dueToday,
    completion:
      wordsCount > 0 ? Math.round((learnedWords / wordsCount) * 100) : 0,
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

/** Issue #177: 回答から「学習した日付」の集合を作る（askedAt は ISO 日時） */
export function studyDateSet(answers: { askedAt: string }[]): Set<string> {
  return new Set(answers.map((a) => a.askedAt.slice(0, 10)));
}

/** Issue #177: 直近 n 日の日付を昇順で返す（today を含む）。カレンダー表示用 */
export function lastNDates(today: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(addDays(today, -i));
  }
  return out;
}

/**
 * Issue #219: 週の区切り（月曜始まり）でカレンダーを折り返すための曜日番号。
 * 月=0 … 日=6。日曜始まりにしたくなったらここだけ変える。
 */
export function mondayWeekdayIndex(date: string): number {
  const d = new Date(`${date}T00:00:00`);
  return (d.getDay() + 6) % 7;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}
