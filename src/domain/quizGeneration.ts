/**
 * Self-Improve: LLMによるクイズ問題の自動生成 (issue #15)
 *
 * - 生成物は既存デッキの quizSchema（4択・answerChoiceId必須）に寄せて検証する
 * - 対象語彙（wordId）と選択肢の整合性をクライアント側でも検証し、
 *   不正な生成物はすてる（部分採用）
 * - 保存は storage.saveGeneratedQuiz() 経由で IndexedDB に一時保存
 * - 生成頻度制御: 1レッスンあたり同一日に maxPerDay まで
 */

import { z } from "zod";
import type { Deck, Quiz } from "../content/schema";
import { quizSchema } from "../content/schema";
import { allWords, wordById } from "../content/loader";
import { requestLlmChat } from "./llm";
import type { LlmProviderConfig } from "./llm";
import type { GeneratedQuizSet, GeneratedQuizSource } from "../storage/types";

export interface GenerateQuizzesOptions {
  providers: LlmProviderConfig[];
  deck: Deck;
  lessonId: string;
  source: GeneratedQuizSource;
  /** 生成する問題数の上限（既定 5） */
  count?: number;
  /** 苦手語集中トレーニングの対象 wordId（source=llm-wrong-focus のとき必須） */
  focusWordIds?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  model?: string;
}

const llmQuestionSchema = z
  .object({
    wordId: z.string().min(1),
    prompt: z.string().min(1),
    choices: z
      .array(z.string().min(1))
      .length(4, "choices must be exactly 4")
      .refine(
        (arr) => new Set(arr.map((s) => s.trim().toLowerCase())).size === 4,
        "choices must be distinct",
      ),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().optional(),
  })
  .strict();

const llmOutputSchema = z.object({ questions: z.array(llmQuestionSchema) });

/** 発話全体の前後に説明文が付くモデル向けに、JSONオブジェクト部分を抽出する。 */
export function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    /* fallthrough */
  }
  const start = trimmed.indexOf("{");
  if (start === -1) return undefined;
  for (let end = trimmed.length; end > start; end--) {
    const candidate = trimmed.slice(start, end).trim();
    if (!candidate.endsWith("}")) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* try shorter slice */
    }
  }
  return undefined;
}

function buildPrompt(
  deck: Deck,
  lessonId: string,
  count: number,
  source: GeneratedQuizSource,
  focusWordIds?: string[],
): string {
  const lesson = deck.lessons.find((l) => l.lessonId === lessonId);
  const pool =
    source === "llm-wrong-focus" && focusWordIds?.length
      ? allWords(deck).filter((w) => focusWordIds.includes(w.wordId))
      : (lesson?.words ?? []);
  const wordLines = pool
    .map(
      (w) =>
        `- wordId=${w.wordId} | ${w.term} (${w.reading}) | 意味: ${w.meaning}${w.examples[0] ? ` | 例文: ${w.examples[0].en}` : ""}`,
    )
    .join("\n");
  const allWordIds = allWords(deck)
    .map((w) => w.wordId)
    .join(", ");

  const purpose =
    source === "llm-wrong-focus"
      ? `The learner repeatedly gets these words wrong. Create focused practice questions, emphasizing confusable pairs and similar-looking words among them.`
      : `Create supplementary practice questions for this lesson's vocabulary, in addition to the static quizzes the learner already has.`;

  return `You are a quiz generator for a Japanese learner of English. ${purpose}

Vocabulary list (the valid wordIds are ONLY these: ${allWordIds}):
${wordLines}

Rules:
1. Create exactly ${count} questions (or fewer if the vocabulary list is too small).
2. Each question must target one wordId from the list above.
3. Each question has EXACTLY 4 distinct answer choices (no duplicates, no empty strings).
4. answerIndex is the 0-based index of the correct choice.
5. prompt is the question text in Japanese or English, self-contained (e.g. meaning question, fill-in-the-blank with ___, translation direction, usage in context).
6. Vary question types across the set.
7. explanation: one short Japanese sentence explaining why the answer is correct.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"questions":[{"wordId":"...","prompt":"...","choices":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}`;
}

/**
 * LLM 出力を Quiz[] に変換し、deck の実在 wordId への参照になっていない、
 * あるいは選択肢が不正なものをすてる。
 */
/** deckスキーマの slugSchema（[a-z0-9-]）に合うように一意バッチIDを正規化する */
export function normalizeBatchId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `llm-${slug}`;
}

export function toQuizzes(
  parsed: z.infer<typeof llmOutputSchema>,
  deck: Deck,
  batchId: string,
): { quizzes: Quiz[]; rejected: number } {
  const quizzes: Quiz[] = [];
  let rejected = 0;
  parsed.questions.forEach((q, i) => {
    const word = wordById(deck, q.wordId);
    if (!word) {
      rejected += 1;
      return;
    }
    const texts = q.choices.map((c) => c.trim());
    if (new Set(texts.map((t) => t.toLowerCase())).size !== 4) {
      rejected += 1;
      return;
    }
    const candidate: Quiz = {
      quizId: `${batchId}-q${i}`,
      type: "choose-meaning",
      wordId: q.wordId,
      prompt: q.prompt.trim(),
      choices: texts.map((text, ci) => ({ choiceId: `c${ci}`, text })),
      answerChoiceId: `c${q.answerIndex}`,
      explanation: q.explanation?.trim() || undefined,
    };
    const result = quizSchema.safeParse(candidate);
    if (result.success) quizzes.push(result.data);
    else rejected += 1;
  });
  return { quizzes, rejected };
}

export async function generateQuizzesWithLlm(
  opts: GenerateQuizzesOptions,
): Promise<GeneratedQuizSet> {
  const count = Math.min(Math.max(opts.count ?? 5, 1), 10);
  const content = await requestLlmChat({
    providers: opts.providers,
    messages: [
      {
        role: "user",
        content: buildPrompt(
          opts.deck,
          opts.lessonId,
          count,
          opts.source,
          opts.focusWordIds,
        ),
      },
    ],
    maxTokens: 1600,
    temperature: 0.7,
    timeoutMs: opts.timeoutMs ?? 30_000,
    signal: opts.signal,
  });

  const jsonText = extractJsonObject(content.content);
  if (!jsonText) {
    throw new Error(
      "LLM応答からJSONを解析できませんでした。もう一度試行してください。",
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new Error("LLM応答のJSONが不正です。もう一度試行してください。");
  }
  const parsed = llmOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `LLM生成問題のスキーマ検証に失敗しました: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join(" / ")}`,
    );
  }

  const generatedAt = new Date().toISOString();
  const batchId = normalizeBatchId(
    `${opts.source}-${generatedAt}-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { quizzes, rejected } = toQuizzes(parsed.data, opts.deck, batchId);
  if (quizzes.length === 0) {
    throw new Error(
      "生成された問題はすべて検証に不合格でした（対象語彙が存在しない可能性があります）。",
    );
  }

  return {
    id: batchId,
    deckId: opts.deck.deckId,
    lessonId: opts.lessonId,
    source: opts.source,
    words: Array.from(new Set(quizzes.map((q) => q.wordId))),
    quizzes,
    rejected,
    generatedAt,
    model: opts.model ?? opts.providers[0]?.model ?? "",
  };
}

/** 同一日にレッスンあたり maxPerDay を超えて生成し直さないための判定（issue #15 の頻度制御）。 */
export function canGenerateToday(
  history: GeneratedQuizSet[],
  deckId: string,
  lessonId: string,
  today: string,
  maxPerDay = 3,
): boolean {
  const todays = history.filter(
    (h) =>
      h.deckId === deckId &&
      h.lessonId === lessonId &&
      h.generatedAt.startsWith(today),
  );
  return todays.length < maxPerDay;
}
