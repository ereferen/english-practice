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

export function buildSessionQuizItems(
  quizzes: Quiz[],
  options?: { shuffle?: boolean; limit?: number },
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
