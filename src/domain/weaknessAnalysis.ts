/**
 * Self-Improve: 誤答パターン分析と弱点レポート (issue #16)
 *
 * フェーズ1（このモジュール）: AnswerEvent/ReviewState から LLM に渡す
 * 集計入力を組み立て、LLM のレポートを Zod で検証して返す。
 * LLM が使えない環境でも「統計のみ」のレポートを出せるよう、
 * 集計ロジックと生成呼び出しを分離してある。
 *
 * - buildWeaknessInput(): 純粋関数。品詞別/時間帯別の正答率を集計
 * - analyzeWeaknessWithLlm(): #18 の requestLlmChat でレポート生成
 */

import { z } from "zod";
import type { Deck } from "../content/schema";
import { wordById } from "../content/loader";
import type { AnswerEvent } from "../storage/types";
import { requestLlmChat } from "./llm";
import type { LlmProviderConfig } from "./llm";
import { extractJsonObject } from "./quizGeneration";

// ---------------------------------------------------------------------------
// 集計入力
// ---------------------------------------------------------------------------

export interface PartOfSpeechStat {
  correct: number;
  wrong: number;
}

export interface WeakWordStat {
  wordId: string;
  term: string;
  meaning: string;
  wrongCount: number;
  lastSeenDays: number | null;
}

export interface WeaknessAnalysisInput {
  totalAnswers: number;
  correctRate: number; // 0..1、丸めなし
  byPartOfSpeech: Record<string, PartOfSpeechStat>;
  /** 回答時刻（JST気味ではなくブラウザローカルの時刻帯）別 */
  byTimeBucket: Record<
    "morning" | "afternoon" | "evening" | "night",
    PartOfSpeechStat
  >;
  /** 最終誤答から経過日数（1桁に丸めたレベル別不是率ではなく、語ごとの生データ） */
  weakWords: WeakWordStat[];
  latency: { medianWrongMs: number | null; medianCorrectMs: number | null };
  streakData: { current: number; longest: number };
}

const TIME_BUCKETS = ["morning", "afternoon", "evening", "night"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

/** 5-11 朝 / 11-17 昼 / 17-22 夜 / それ以外 深夜 */
export function timeBucketOf(iso: string): TimeBucket {
  const h = new Date(iso).getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function bump(
  map: Record<string, PartOfSpeechStat>,
  key: string,
  correct: boolean,
): void {
  const stat = (map[key] ??= { correct: 0, wrong: 0 });
  if (correct) stat.correct += 1;
  else stat.wrong += 1;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function daysSince(iso: string, today: string): number {
  const d = new Date(iso.slice(0, 10)).getTime();
  const t = new Date(today).getTime();
  return Math.max(0, Math.round((t - d) / 86_400_000));
}

/** consecutiveDays(today) 相当: answeredAt の YYYY-MM-DD を重複排除して今日から遡る */
export function streakFromDates(
  dates: string[],
  today: string,
): {
  current: number;
  longest: number;
} {
  const set = new Set(dates.map((d) => d.slice(0, 10)));
  let current = 0;
  const cursor = new Date(today);
  // 今天是学習日でなくても streak は途切れないと数えない（今日から連続）
  while (set.has(isoDate(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  // longest: ソート済み日付リストで最長連続区間
  const sortedDates = Array.from(set).sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const ds of sortedDates) {
    const d = new Date(ds);
    if (prev && d.getTime() - prev.getTime() === 86_400_000) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest };
}

function isoDate(d: Date): string {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function buildWeaknessInput(opts: {
  answers: AnswerEvent[];
  decks: Deck[];
  today: string;
  /** weakWords の出力件数（既定 10） */
  weakLimit?: number;
}): WeaknessAnalysisInput {
  const { answers, decks, today } = opts;
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;

  const byPartOfSpeech: Record<string, PartOfSpeechStat> = {};
  const byTimeBucket = Object.fromEntries(
    TIME_BUCKETS.map((b) => [b, { correct: 0, wrong: 0 }]),
  ) as Record<TimeBucket, PartOfSpeechStat>;

  const wordIndex = new Map<
    string,
    { term: string; meaning: string; pos: string }
  >();
  for (const deck of decks) {
    for (const lesson of deck.lessons) {
      for (const w of lesson.words) {
        if (!wordIndex.has(w.wordId)) {
          wordIndex.set(w.wordId, {
            term: w.term,
            meaning: w.meaning,
            pos: w.partOfSpeech ?? "other",
          });
        }
      }
    }
  }

  const wrongLatency: number[] = [];
  const correctLatency: number[] = [];
  const wrongCountByWord = new Map<string, number>();

  for (const a of answers) {
    const pos = wordIndex.get(a.wordId)?.pos ?? "other";
    bump(byPartOfSpeech, pos, a.correct);
    bump(byTimeBucket, timeBucketOf(a.askedAt), a.correct);
    (a.correct ? correctLatency : wrongLatency).push(a.latencyMs);
    if (!a.correct) {
      wrongCountByWord.set(a.wordId, (wrongCountByWord.get(a.wordId) ?? 0) + 1);
    }
  }

  const seenByWord = new Map<string, string>();
  for (const a of answers) {
    const prev = seenByWord.get(a.wordId);
    if (!prev || a.askedAt > prev) seenByWord.set(a.wordId, a.askedAt);
  }
  const weakWords: WeakWordStat[] = Array.from(wrongCountByWord.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.weakLimit ?? 10)
    .map(([wordId, wrongCount]) => {
      const meta = wordIndex.get(wordId) ??
        wordByIdSafe(decks, wordId) ?? {
          term: wordId,
          meaning: "",
        };
      const lastSeen = seenByWord.get(wordId);
      return {
        wordId,
        term: meta.term,
        meaning: meta.meaning,
        wrongCount,
        lastSeenDays: lastSeen ? daysSince(lastSeen, today) : null,
      };
    });

  return {
    totalAnswers: total,
    correctRate: total === 0 ? 0 : correct / total,
    byPartOfSpeech,
    byTimeBucket,
    weakWords,
    latency: {
      medianWrongMs: median(wrongLatency),
      medianCorrectMs: median(correctLatency),
    },
    streakData: streakFromDates(
      answers.map((a) => a.askedAt),
      today,
    ),
  };
}

function wordByIdSafe(
  decks: Deck[],
  wordId: string,
): { term: string; meaning: string } | undefined {
  for (const d of decks) {
    const w = wordById(d, wordId);
    if (w) return { term: w.term, meaning: w.meaning };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// LLM レポート
// ---------------------------------------------------------------------------

export interface WeaknessCategory {
  category: string;
  strength: "weak" | "average" | "strong";
  advice: string;
}

export interface WeaknessReport {
  summary: string;
  categories: WeaknessCategory[];
  recommendedFocus: string[];
  nextReviewStrategy: {
    increaseFrequency: string[];
    decreaseFrequency: string[];
  };
}

const reportSchema = z
  .object({
    summary: z.string().min(1),
    categories: z
      .array(
        z.object({
          category: z.string().min(1),
          strength: z.enum(["weak", "average", "strong"]),
          advice: z.string().min(1),
        }),
      )
      .min(1)
      .max(8),
    recommendedFocus: z.array(z.string()).max(20).default([]),
    nextReviewStrategy: z
      .object({
        increaseFrequency: z.array(z.string()).max(20).default([]),
        decreaseFrequency: z.array(z.string()).max(20).default([]),
      })
      .default({ increaseFrequency: [], decreaseFrequency: [] }),
  })
  .strict();

export function buildWeaknessPrompt(input: WeaknessAnalysisInput): string {
  return `You are a learning analyst for a Japanese learner of English. Analyze the answer statistics below and produce a weakness report in JAPANESE (summary/advice in Japanese; category names may be short Japanese like "動詞" or "深夜セッション").

Statistics (last 30 days, JSON):
${JSON.stringify(input, null, 1)}

Rules:
1. "categories" covers part-of-speech and time-of-day groups that have at least 5 answers. strength=weak if correct rate < 60%, strong if >= 85%, otherwise average.
2. advice: one short concrete sentence per category, in Japanese.
3. recommendedFocus: up to 5 wordIds from weakWords, worst first.
4. nextReviewStrategy lists wordIds to review more/less often (only real wordIds from the input).
5. summary: 2-3 sentences in Japanese, referencing concrete numbers from the input.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"summary":"...","categories":[{"category":"...","strength":"weak","advice":"..."}],"recommendedFocus":["..."],"nextReviewStrategy":{"increaseFrequency":["..."],"decreaseFrequency":["..."]}}`;
}

/** LLM 出力を QuizGeneration と同じ方針でパース（前後の説明文をすてる） */
export function parseWeaknessReport(text: string): WeaknessReport {
  const jsonText = extractJsonObject(text);
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
  const parsed = reportSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `弱点レポートのスキーマ検証に失敗しました: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join(" / ")}`,
    );
  }
  return parsed.data;
}

/** recommendedFocus / increase/decrease に存在しない wordId が混じっていたら除去する */
export function sanitizeWordIds(
  report: WeaknessReport,
  input: WeaknessAnalysisInput,
): WeaknessReport {
  const known = new Set(input.weakWords.map((w) => w.wordId));
  const keep = (ids: string[]) => ids.filter((id) => known.has(id));
  return {
    ...report,
    recommendedFocus: keep(report.recommendedFocus),
    nextReviewStrategy: {
      increaseFrequency: keep(report.nextReviewStrategy.increaseFrequency),
      decreaseFrequency: keep(report.nextReviewStrategy.decreaseFrequency),
    },
  };
}

export async function analyzeWeaknessWithLlm(opts: {
  providers: LlmProviderConfig[];
  input: WeaknessAnalysisInput;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<WeaknessReport> {
  const result = await requestLlmChat({
    providers: opts.providers,
    messages: [{ role: "user", content: buildWeaknessPrompt(opts.input) }],
    maxTokens: 1200,
    temperature: 0.4,
    timeoutMs: opts.timeoutMs ?? 30_000,
    signal: opts.signal,
  });
  return sanitizeWordIds(parseWeaknessReport(result.content), opts.input);
}
