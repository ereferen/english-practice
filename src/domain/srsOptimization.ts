/**
 * Self-Improve: SRSパラメータ最適化 (issue #17)
 *
 * RetrievalPractice データ（AnswerEvent + ReviewState）を level 別正答率に集計し、
 * LLM に SrsParams の調整案を出させる。#16 の弱点レポート同様、LLM 出力は
 * Zod で検証 + 安全範囲にクランプしてから「提案」として返す — 適用は
 * ユーザー承認後（saveSettings 経由、#20 の承認UXに接続）。
 *
 * - buildSrsOptimizationInput(): 純粋関数。level別(retrieval直前のlevel)正答率と
 *   daysSinceLastReview の分布を集計
 * - proposeSrsParamsWithLlm(): #18 requestLlmChat で提案生成 + clamp
 * - applySrsProposal(): 提案を Settings.srsParams に反映（承認済み提案のみ）
 */

import { z } from "zod";
import type { AnswerEvent, SrsParams } from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import { requestLlmChat } from "./llm";
import type { LlmProviderConfig } from "./llm";
import { extractJsonObject } from "./quizGeneration";

// ---------------------------------------------------------------------------
// 集計入力
// ---------------------------------------------------------------------------

export interface LevelStat {
  level: 0 | 1 | 2 | 3;
  correct: number;
  wrong: number;
  /** 回答直前の復習間隔（日）の平均。dataが足りなければ null */
  avgGapDays: number | null;
}

export interface SrsOptimizationInput {
  totalAnswers: number;
  byLevel: LevelStat[];
  /** 現行パラメータ（LLM に「この値から変えてほしい」と伝える） */
  currentParams: SrsParams;
  /** 高習熟度(level3)での正答率 — 間隔延伸の根拠 */
  level3CorrectRate: number | null;
  /** 低習熟度での誤答が即回復しているか（ペナルティ緩和の根拠） */
  level0RecoveryRate: number | null;
}

/**
 * AnswerEvent 系列から level 別統計を作る。
 * reviewStates は「現在の」状態のみなので、回答時点の level は
 * correctStreak/wrongTotal から復元できない — 代わりに
 * 同一 word の回答を時系列で辿り、疑似的に level を再現する。
 */
export function buildSrsOptimizationInput(opts: {
  answers: AnswerEvent[];
  params?: SrsParams;
  today: string;
}): SrsOptimizationInput {
  const params = opts.params ?? DEFAULT_SETTINGS.srsParams;
  const stats: Record<
    0 | 1 | 2 | 3,
    { correct: number; wrong: number; gaps: number[] }
  > = {
    0: { correct: 0, wrong: 0, gaps: [] },
    1: { correct: 0, wrong: 0, gaps: [] },
    2: { correct: 0, wrong: 0, gaps: [] },
    3: { correct: 0, wrong: 0, gaps: [] },
  };

  const byWord = new Map<string, AnswerEvent[]>();
  for (const a of opts.answers) {
    const list = byWord.get(a.wordId) ?? [];
    list.push(a);
    byWord.set(a.wordId, list);
  }

  for (const [, list] of byWord) {
    const sorted = [...list].sort((x, y) => x.askedAt.localeCompare(y.askedAt));
    let level: 0 | 1 | 2 | 3 = 0;
    let prevDay: string | null = null;
    for (const a of sorted) {
      const day = a.askedAt.slice(0, 10);
      if (prevDay) {
        const gap =
          Math.round(
            (new Date(day).getTime() - new Date(prevDay).getTime()) /
              86_400_000,
          ) || 0;
        stats[level].gaps.push(Math.max(0, gap));
      }
      prevDay = day;
      if (a.correct) {
        stats[level].correct += 1;
        level = Math.min(3, level + 1) as 0 | 1 | 2 | 3;
      } else {
        stats[level].wrong += 1;
        level = level === 3 ? params.level3WrongDemotesTo : 0;
      }
    }
  }

  const byLevel: LevelStat[] = ([0, 1, 2, 3] as const).map((level) => {
    const s = stats[level];
    const avgGap =
      s.gaps.length > 0
        ? Math.round((s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length) * 10) /
          10
        : null;
    return { level, correct: s.correct, wrong: s.wrong, avgGapDays: avgGap };
  });

  const l3 = stats[3];
  const l3Total = l3.correct + l3.wrong;
  const l0 = stats[0];
  const l0Total = l0.correct + l0.wrong;

  return {
    totalAnswers: opts.answers.length,
    byLevel,
    currentParams: params,
    level3CorrectRate: l3Total >= 5 ? l3.correct / l3Total : null,
    level0RecoveryRate: l0Total >= 5 ? l0.correct / l0Total : null,
  };
}

// ---------------------------------------------------------------------------
// 提案スキーマ + クランプ（#16 と同じ方針: LLM 出力は絶対に素で信用しない）
// ---------------------------------------------------------------------------

export interface SrsProposal {
  intervalDays: [number, number, number, number];
  level3WrongDemotesTo: 0 | 1 | 2;
  rationale: string;
  confidence: "low" | "medium" | "high";
}

const proposalSchema = z.object({
  intervalDays: z
    .array(z.number().int().min(0).max(30))
    .length(4)
    .transform((v) => v as [number, number, number, number]),
  level3WrongDemotesTo: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  rationale: z.string().min(1).max(400),
  confidence: z.enum(["low", "medium", "high"]),
});

/** 提案がデフォルトと一致するなら「変更なし」— 承認UIに出す価値がない */
export function isNoopProposal(
  proposal: SrsProposal,
  baseline: SrsParams = DEFAULT_SETTINGS.srsParams,
): boolean {
  return (
    proposal.intervalDays.every((d, i) => d === baseline.intervalDays[i]) &&
    proposal.level3WrongDemotesTo === baseline.level3WrongDemotesTo
  );
}

/**
 * 安全範囲へのクランプ:
 * - intervalDays は単調非減少（level が上がるほど間隔は短くない）
 * - level 0/1 は当日復習を維持（0 固定）— 初見・失効語を先延ばしにさせない
 * - 変更は 1 ステップ ±3 日まで（学習ペースを乱さない控えめな最適化）
 */
export function clampProposal(
  proposal: SrsProposal,
  current: SrsParams,
): SrsProposal {
  const limited = proposal.intervalDays.map((d, i) => {
    if (i <= 1) return 0;
    const lo = current.intervalDays[i] - 3;
    const hi = current.intervalDays[i] + 3;
    return Math.min(hi, Math.max(lo, d));
  });
  const monotonic = limited.map((d, i) =>
    i === 0 ? d : Math.max(d, limited[i - 1]),
  ) as [number, number, number, number];
  return { ...proposal, intervalDays: monotonic };
}

export function parseSrsProposal(text: string): SrsProposal {
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
  const parsed = proposalSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `SRS提案のスキーマ検証に失敗しました: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join(" / ")}`,
    );
  }
  return parsed.data;
}

export function buildSrsOptimizationPrompt(
  input: SrsOptimizationInput,
): string {
  return `You are an SRS (spaced repetition) tuner for a Japanese English-learning app. Current parameters and per-level answer statistics (simulated level at time of each answer, last 30 days) are below.

${JSON.stringify(input, null, 1)}

Rules:
1. Propose intervalDays for levels 0..3 in days. level 0 and 1 MUST stay 0 (same-day). Only adjust levels 2-3, and never move more than ±3 days from the current value.
2. intervals must be non-decreasing across levels.
3. level3WrongDemotesTo: 0/1/2 — how far a wrong answer at level 3 demotes. Use 2 only if level0RecoveryRate is high (learner recovers quickly).
4. rationale: 1-2 short sentences in JAPANESE citing concrete numbers from the input.
5. confidence: low if any level has fewer than 10 answers, medium if 10-29, high if >=30 on the levels you changed.
6. If the current parameters already look right, return them unchanged with high confidence.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"intervalDays":[0,0,1,4],"level3WrongDemotesTo":1,"rationale":"...","confidence":"medium"}`;
}

/** 最少データ要件（#16 の「10回以上」と同水準、level3 は延伸判断に5回以上） */
export const SRS_OPTIMIZATION_MIN_ANSWERS = 30;

export function assertEnoughSrsData(input: SrsOptimizationInput): void {
  if (input.totalAnswers < SRS_OPTIMIZATION_MIN_ANSWERS) {
    throw new Error(
      `SRS最適化には直近30日で少なくとも${SRS_OPTIMIZATION_MIN_ANSWERS}回の回答が必要です（現在 ${input.totalAnswers} 回）。`,
    );
  }
}

export async function proposeSrsParamsWithLlm(opts: {
  providers: LlmProviderConfig[];
  input: SrsOptimizationInput;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SrsProposal> {
  assertEnoughSrsData(opts.input);
  const result = await requestLlmChat({
    providers: opts.providers,
    messages: [
      { role: "user", content: buildSrsOptimizationPrompt(opts.input) },
    ],
    maxTokens: 600,
    temperature: 0.3,
    timeoutMs: opts.timeoutMs ?? 30_000,
    signal: opts.signal,
  });
  return clampProposal(
    parseSrsProposal(result.content),
    opts.input.currentParams,
  );
}

/** 承認済み提案 → SrsParams（Settings 保存用） */
export function proposalToParams(proposal: SrsProposal): SrsParams {
  return {
    intervalDays: [...proposal.intervalDays] as [
      number,
      number,
      number,
      number,
    ],
    level3WrongDemotesTo: proposal.level3WrongDemotesTo,
  };
}
