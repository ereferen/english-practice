import type { Deck, Quiz, Word } from "../content/schema";
import type { ReviewState } from "../storage/types";
import { allWords, generateQuizzesForLesson } from "../content/loader";
import type { QuizItem } from "./session";
import { buildSessionQuizItems } from "./session";

/**
 * Issue #114: build a cross-lesson, cross-deck review session from the
 * SRS-due word set. Each due review becomes exactly one quiz item —
 * preferring the lesson's authored/auto-generated quiz for that word and
 * falling back to a meaning-choice quiz built from the deck's word pool.
 */
export interface ReviewItem {
  deckId: string;
  item: QuizItem;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Fallback choose-meaning quiz for a word with no authored quiz. */
function fallbackQuiz(deck: Deck, word: Word): Quiz | undefined {
  const distractors = Array.from(
    new Set(
      allWords(deck)
        .filter((w) => w.wordId !== word.wordId && w.meaning !== word.meaning)
        .map((w) => w.meaning),
    ),
  ).slice(0, 3);
  if (distractors.length < 3) return undefined;
  const choices = shuffle([
    { choiceId: "c-ans", text: word.meaning },
    ...distractors.map((text, i) => ({ choiceId: `c-d${i + 1}`, text })),
  ]);
  const answer = choices.find((c) => c.text === word.meaning);
  if (!answer) return undefined;
  return {
    quizId: `review:${deck.deckId}:${word.wordId}`,
    type: "choose-meaning",
    wordId: word.wordId,
    prompt: word.term,
    choices,
    answerChoiceId: answer.choiceId,
  };
}

export function buildReviewItems(
  decks: Deck[],
  reviews: ReviewState[],
): ReviewItem[] {
  const seen = new Set<string>();
  const quizzes: Quiz[] = [];
  const deckIdByQuiz = new Map<string, string>();

  for (const r of reviews) {
    const key = `${r.deckId}:${r.wordId}`;
    if (seen.has(key)) continue;
    const deck = decks.find((d) => d.deckId === r.deckId);
    if (!deck) continue;
    const word = allWords(deck).find((w) => w.wordId === r.wordId);
    if (!word) continue;
    seen.add(key);

    const lesson = deck.lessons.find((l) =>
      l.words.some((w) => w.wordId === r.wordId),
    );
    let quiz: Quiz | undefined;
    if (lesson) {
      quiz = generateQuizzesForLesson(deck, lesson.lessonId).find(
        (q) => q.wordId === r.wordId,
      );
    }
    quiz ??= fallbackQuiz(deck, word);
    if (quiz) {
      quizzes.push(quiz);
      deckIdByQuiz.set(quiz.quizId, r.deckId);
    }
  }

  const items = buildSessionQuizItems(quizzes, { shuffle: true });
  return items
    .map((item) => ({ deckId: deckIdByQuiz.get(item.quizId)!, item }))
    .filter((ri) => ri.deckId);
}
