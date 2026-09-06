import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric/hyphen");

export const exampleSchema = z
  .object({
    en: z.string().min(1),
    ja: z.string().optional(),
  })
  .strict();

export const choiceSchema = z
  .object({
    choiceId: slugSchema,
    text: z.string().min(1),
  })
  .strict();

export const quizTypeSchema = z.enum([
  "choose-meaning",
  "choose-term",
  "fill-blank",
]);

export const quizSchema = z
  .object({
    quizId: slugSchema,
    type: quizTypeSchema,
    wordId: slugSchema,
    prompt: z.string().min(1),
    choices: z.array(choiceSchema).length(4),
    answerChoiceId: slugSchema,
    explanation: z.string().optional(),
  })
  .strict();

export const wordSchema = z
  .object({
    wordId: slugSchema,
    term: z.string().min(1),
    reading: z.string().min(1),
    meaning: z.string().min(1),
    partOfSpeech: z
      .enum([
        "noun",
        "verb",
        "adjective",
        "adverb",
        "preposition",
        "conjunction",
        "pronoun",
        "determiner",
        "exclamation",
        "other",
      ])
      .optional(),
    examples: z.array(exampleSchema).min(1).max(3),
    note: z.string().optional(),
    tags: z.array(z.string()).optional(),
    audio: z.string().optional(),
  })
  .strict();

export const lessonSchema = z
  .object({
    lessonId: slugSchema,
    title: z.string().min(1),
    theme: z.string().optional(),
    words: z.array(wordSchema).min(1),
    quizzes: z.array(quizSchema).default([]),
  })
  .strict();

export const deckSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.string().regex(/^\d+\.\d+$/),
    deckId: slugSchema,
    level: z.enum(["beginner", "intermediate", "advanced"]),
    title: z.string().min(1),
    description: z.string().optional(),
    source: z.string().optional(),
    lessons: z.array(lessonSchema).min(1),
  })
  .strict();

export type Word = z.infer<typeof wordSchema>;
export type Example = z.infer<typeof exampleSchema>;
export type QuizType = z.infer<typeof quizTypeSchema>;
export type Choice = z.infer<typeof choiceSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Deck = z.infer<typeof deckSchema>;

export type ParseDeckResult =
  | { ok: true; deck: Deck }
  | { ok: false; issues: z.ZodIssue[] };

export function parseDeck(json: unknown): Deck {
  return deckSchema.parse(json);
}

export function parseDeckSafe(json: unknown): ParseDeckResult {
  const result = deckSchema.safeParse(json);
  if (result.success) {
    return { ok: true, deck: result.data };
  }
  return { ok: false, issues: result.error.issues };
}
