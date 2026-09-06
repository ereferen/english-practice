import type { Deck, Lesson, Quiz, Word } from "./schema";
import { parseDeckSafe } from "./schema";

const BUNDLED_DECK_FILES = [
  "beginner-core.json",
  "intermediate-workplace.json",
  "advanced-academic.json",
];

export interface LoadedDeck {
  deck: Deck;
  source: "bundled";
  url: string;
}

export interface LoadError {
  url: string;
  reason: string;
}

export async function loadBundledDecks(base = ""): Promise<{
  decks: LoadedDeck[];
  errors: LoadError[];
}> {
  const baseUrl = base.replace(/\/$/, "");
  const decks: LoadedDeck[] = [];
  const errors: LoadError[] = [];

  await Promise.all(
    BUNDLED_DECK_FILES.map(async (file) => {
      const url = baseUrl
      ? `${baseUrl}/content/${file}`
      : `/content/${file}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          errors.push({ url, reason: `HTTP ${res.status}` });
          return;
        }
        const json = await res.json();
        const parsed = parseDeckSafe(json);
        if (parsed.ok === false) {
          const reason = parsed.issues.map(formatZodIssue).join("; ");
          errors.push({ url, reason });
          return;
        }
        const consistency = validateDeckConsistency(parsed.deck);
        if (consistency.length > 0) {
          errors.push({ url, reason: consistency.join("; ") });
          return;
        }
        decks.push({ deck: parsed.deck, source: "bundled", url });
      } catch (e) {
        errors.push({
          url,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  decks.sort((a, b) => a.deck.title.localeCompare(b.deck.title, "ja"));
  return { decks, errors };
}

function formatZodIssue(issue: { message: string; path: (string | number)[] }): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
  return `${path}: ${issue.message}`;
}

export interface ConsistencyIssue {
  message: string;
  scope: string;
}

export function validateDeckConsistency(deck: Deck): string[] {
  const issues: string[] = [];

  const lessonIds = new Set<string>();
  for (const lesson of deck.lessons) {
    if (lessonIds.has(lesson.lessonId)) {
      issues.push(`duplicate lessonId: ${lesson.lessonId}`);
    }
    lessonIds.add(lesson.lessonId);
  }

  const wordIds = new Set<string>();
  const meanings = new Set<string>();
  const terms = new Set<string>();

  for (const lesson of deck.lessons) {
    for (const word of lesson.words) {
      if (wordIds.has(word.wordId)) {
        issues.push(`duplicate wordId: ${word.wordId}`);
      }
      wordIds.add(word.wordId);

      if (meanings.has(word.meaning)) {
        issues.push(`duplicate meaning: ${word.meaning}`);
      }
      meanings.add(word.meaning);

      if (terms.has(word.term)) {
        issues.push(`duplicate term: ${word.term}`);
      }
      terms.add(word.term);
    }
  }

  const allWordIds = Array.from(wordIds);
  if (allWordIds.length < 4) {
    issues.push("deck must contain at least 4 words for quiz generation");
  }

  for (const lesson of deck.lessons) {
    const quizIds = new Set<string>();

    for (const quiz of lesson.quizzes ?? []) {
      if (quizIds.has(quiz.quizId)) {
        issues.push(`lesson ${lesson.lessonId}: duplicate quizId ${quiz.quizId}`);
      }
      quizIds.add(quiz.quizId);

      if (!wordIds.has(quiz.wordId)) {
        issues.push(
          `lesson ${lesson.lessonId}: quiz ${quiz.quizId} references unknown wordId ${quiz.wordId}`,
        );
      }

      const answer = quiz.choices.find((c) => c.choiceId === quiz.answerChoiceId);
      if (!answer) {
        issues.push(
          `lesson ${lesson.lessonId}: quiz ${quiz.quizId} answerChoiceId ${quiz.answerChoiceId} not found in choices`,
        );
      }

      const choiceTexts = new Set<string>();
      const choiceIds = new Set<string>();
      for (const choice of quiz.choices) {
        if (choiceIds.has(choice.choiceId)) {
          issues.push(
            `lesson ${lesson.lessonId}: quiz ${quiz.quizId} duplicate choiceId ${choice.choiceId}`,
          );
        }
        choiceIds.add(choice.choiceId);

        if (choiceTexts.has(choice.text)) {
          issues.push(
            `lesson ${lesson.lessonId}: quiz ${quiz.quizId} duplicate choice text ${choice.text}`,
          );
        }
        choiceTexts.add(choice.text);
      }

      const target = wordById(deck, quiz.wordId);
      if (target && answer) {
        if (quiz.type === "choose-meaning" && answer.text !== target.meaning) {
          issues.push(
            `lesson ${lesson.lessonId}: quiz ${quiz.quizId} choose-meaning answer does not match word meaning`,
          );
        }
        if (quiz.type === "choose-term" && answer.text !== target.term) {
          issues.push(
            `lesson ${lesson.lessonId}: quiz ${quiz.quizId} choose-term answer does not match word term`,
          );
        }
        if (quiz.type === "fill-blank") {
          if (!quiz.prompt.includes("___")) {
            issues.push(
              `lesson ${lesson.lessonId}: quiz ${quiz.quizId} fill-blank prompt missing blank marker ___`,
            );
          }
          if (answer.text !== target.term) {
            issues.push(
              `lesson ${lesson.lessonId}: quiz ${quiz.quizId} fill-blank answer does not match word term`,
            );
          }
          const escaped = escapeRegExp(target.term);
          const occurrences = (quiz.prompt.match(new RegExp(escaped, "gi")) ?? []).length;
          if (occurrences > 0) {
            issues.push(
              `lesson ${lesson.lessonId}: quiz ${quiz.quizId} fill-blank prompt still contains the answer term`,
            );
          }
        }
      }
    }
  }

  return issues;
}

export interface LessonWithDeck {
  deck: Deck;
  lesson: Lesson;
}

export function pickLesson(
  deck: Deck,
  lessonId: string,
): LessonWithDeck | undefined {
  const lesson = deck.lessons.find((l) => l.lessonId === lessonId);
  return lesson ? { deck, lesson } : undefined;
}

export function allWords(deck: Deck): Word[] {
  return deck.lessons.flatMap((l) => l.words);
}

export function allQuizzes(deck: Deck, lessonId?: string): Quiz[] {
  if (lessonId) {
    const lesson = deck.lessons.find((l) => l.lessonId === lessonId);
    return lesson ? (lesson.quizzes ?? []) : [];
  }
  return deck.lessons.flatMap((l) => l.quizzes ?? []);
}

export function wordById(deck: Deck, wordId: string): Word | undefined {
  return allWords(deck).find((w) => w.wordId === wordId);
}

export function generateQuizzesForLesson(deck: Deck, lessonId: string): Quiz[] {
  const lesson = deck.lessons.find((l) => l.lessonId === lessonId);
  if (!lesson) return [];
  if ((lesson.quizzes?.length ?? 0) > 0) return lesson.quizzes;

  const pool = allWords(deck);
  if (pool.length < 4) return [];

  const quizzes: Quiz[] = [];
  const usedDistractors = new Map<string, string[]>();

  for (const word of lesson.words) {
    const meaningQuiz = makeChooseMeaning(
      word,
      pool,
      usedDistractors,
      lessonId,
    );
    quizzes.push(meaningQuiz);

    const fb = makeFillBlank(word, lessonId);
    if (fb) quizzes.push(fb);
  }

  return quizzes;
}

function makeChooseMeaning(
  target: Word,
  pool: Word[],
  usedDistractors: Map<string, string[]>,
  lessonId: string,
): Quiz {
  const distractors = pickDistractors(target, pool, usedDistractors);
  const choices = shuffle([
    { choiceId: "c-ans", text: target.meaning },
    ...distractors.map((text, i) => ({ choiceId: `c-d${i + 1}`, text })),
  ]);
  const answer = choices.find((c) => c.text === target.meaning);
  if (!answer) throw new Error("answer choice not found");

  return {
    quizId: `gen:${lessonId}:${target.wordId}:cm`,
    type: "choose-meaning",
    wordId: target.wordId,
    prompt: target.term,
    choices,
    answerChoiceId: answer.choiceId,
  };
}

function makeFillBlank(target: Word, lessonId: string): Quiz | undefined {
  const first = target.examples[0];
  if (!first) return undefined;
  const termLower = target.term.toLowerCase();
  const enLower = first.en.toLowerCase();
  if (!enLower.includes(termLower)) return undefined;
  const prompt = first.en.replace(
    new RegExp(`\\b${escapeRegExp(target.term)}\\b`, "i"),
    "___",
  );
  if (prompt === first.en) return undefined;

  return {
    quizId: `gen:${lessonId}:${target.wordId}:fb`,
    type: "fill-blank",
    wordId: target.wordId,
    prompt,
    choices: [
      { choiceId: "c-ans", text: target.term },
      { choiceId: "c-d1", text: target.reading },
      { choiceId: "c-d2", text: target.meaning },
      { choiceId: "c-d3", text: target.term + target.term },
    ],
    answerChoiceId: "c-ans",
  };
}

function pickDistractors(
  target: Word,
  pool: Word[],
  usedDistractors: Map<string, string[]>,
): string[] {
  const used = usedDistractors.get(target.wordId) ?? [];
  const candidates = pool
    .filter((w) => w.wordId !== target.wordId)
    .map((w) => w.meaning)
    .filter((m) => m !== target.meaning && !used.includes(m));
  const unique = Array.from(new Set(candidates));
  const selected = unique.slice(0, 3);
  usedDistractors.set(target.wordId, [...used, ...selected]);
  return selected;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
