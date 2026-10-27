import type { Choice, Quiz } from "../content/schema";

export interface QuizItem {
  quizId: string;
  wordId: string;
  type: Quiz["type"];
  prompt: string;
  choices: Choice[];
  answerChoiceId: string;
  explanation?: string;
}

export interface AnswerRecord {
  quizId: string;
  wordId: string;
  choiceId: string;
  correct: boolean;
  latencyMs: number;
}

export function isCorrect(quiz: QuizItem, choiceId: string): boolean {
  return quiz.answerChoiceId === choiceId;
}

export function scoreRate(answers: AnswerRecord[]): number {
  if (answers.length === 0) return 0;
  const correct = answers.filter((a) => a.correct).length;
  return Math.round((correct / answers.length) * 100) / 100;
}

export function wrongWordIds(answers: AnswerRecord[]): string[] {
  return Array.from(
    new Set(answers.filter((a) => !a.correct).map((a) => a.wordId)),
  );
}

/**
 * Issue #229: 1 問も答えずに「戻る」で抜けたセッションは、ResultScreen が
 * 結果画面を描画した時点で `startedAt === endedAt` / `scoreRate === 0` の
 * レコードとして残っていた。回答 0 件なのに 0% が履歴とセッション数に
 * 積まれると「サボった」ように見えるので、こうした記録は表示・集計から外す。
 * 既存の壊れたレコードを掃除しないので、読み出し側でも同じ判定を使う。
 */
export function isAbortedSession(session: {
  scoreRate: number | null;
  startedAt: string;
  endedAt: string | null;
}): boolean {
  return (
    session.scoreRate === 0 &&
    session.endedAt !== null &&
    session.startedAt === session.endedAt
  );
}

export function buildSessionQuizItems(
  quizzes: Quiz[],
  options?: { shuffle?: boolean; limit?: number; onePerWord?: boolean },
): QuizItem[] {
  let items: QuizItem[] = quizzes.map((q) => ({
    quizId: q.quizId,
    wordId: q.wordId,
    type: q.type,
    prompt: q.prompt,
    choices: q.choices,
    answerChoiceId: q.answerChoiceId,
    explanation: q.explanation,
  }));
  if (options?.shuffle) {
    items = shuffleArray(items);
  }
  // Issue #228: 会話から抽出したデッキは 1 語に 2 種類（穴埋め＋意味）の
  // クイズを持つため、4 語のレッスンが 7 問になっていた。1 レッスン =
  // 語数ぶんに揃えたい画面では語ごとに 1 問へ間引く（シャッフル後なので
  // 毎回どちらの形式が出るかは変わる）。
  if (options?.onePerWord) {
    const seen = new Set<string>();
    items = items.filter((item) => {
      if (seen.has(item.wordId)) return false;
      seen.add(item.wordId);
      return true;
    });
  }
  if (options?.limit && options.limit < items.length) {
    items = items.slice(0, options.limit);
  }
  return items;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
