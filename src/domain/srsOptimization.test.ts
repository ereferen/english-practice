import { describe, expect, it } from "vitest";
import {
  buildSrsOptimizationInput,
  clampProposal,
  isNoopProposal,
  parseSrsProposal,
  proposalToParams,
  assertEnoughSrsData,
  SRS_OPTIMIZATION_MIN_ANSWERS,
  type SrsProposal,
} from "./srsOptimization";
import { DEFAULT_SETTINGS } from "../storage/types";
import type { AnswerEvent, SrsParams } from "../storage/types";

function answer(wordId: string, correct: boolean, day: number): AnswerEvent {
  return {
    id: `${wordId}-${day}`,
    sessionId: "s1",
    wordId,
    askedAt: `2026-09-0${(day % 9) + 1}T10:00:0${day % 9}+09:00`,
    correct,
    latencyMs: 1000 + day * 100,
  };
}

const PROPOSAL: SrsProposal = {
  intervalDays: [0, 0, 2, 6],
  level3WrongDemotesTo: 1,
  rationale: "level3正答率92%のため間隔を延伸できる",
  confidence: "high",
};

describe("buildSrsOptimizationInput", () => {
  it("空データでも落ちず rate は null", () => {
    const input = buildSrsOptimizationInput({
      answers: [],
      today: "2026-09-08",
    });
    expect(input.totalAnswers).toBe(0);
    expect(input.level3CorrectRate).toBeNull();
    expect(input.currentParams).toEqual(DEFAULT_SETTINGS.srsParams);
  });

  it("level を疑似再現して集計する（連続正答で上位 level に乗る）", () => {
    const answers: AnswerEvent[] = [];
    // word w0: 4回連続正答 → level 0,1,2,3 で各1回 correct
    for (let d = 0; d < 4; d++) answers.push(answer("w0", true, d));
    const input = buildSrsOptimizationInput({ answers, today: "2026-09-08" });
    const byLevel = Object.fromEntries(
      input.byLevel.map((s) => [s.level, s]),
    ) as Record<number, (typeof input.byLevel)[number]>;
    expect(byLevel[0].correct).toBe(1);
    expect(byLevel[3].correct).toBe(1);
    // 5回未満の level3 なので rate は算出対象外 → null
    expect(input.level3CorrectRate).toBeNull();
  });

  it("level3誤答の降格先は params に従う", () => {
    const params: SrsParams = {
      intervalDays: [0, 0, 1, 4],
      level3WrongDemotesTo: 0,
    };
    const answers: AnswerEvent[] = [];
    for (let d = 0; d < 3; d++) answers.push(answer("w0", true, d));
    answers.push(answer("w0", false, 3)); // level3 で誤答 → level0 へ
    for (let d = 4; d < 6; d++) answers.push(answer("w0", true, d));
    const input = buildSrsOptimizationInput({
      answers,
      params,
      today: "2026-09-08",
    });
    const w0 = input.byLevel.find((s) => s.level === 0)!;
    // 初回(0) + 降格後(1) = level0 正答2
    expect(w0.correct).toBe(2);
    expect(input.currentParams).toEqual(params);
  });
});

describe("assertEnoughSrsData", () => {
  it("最少回答数未満はエラー", () => {
    const input = buildSrsOptimizationInput({
      answers: Array.from(
        { length: SRS_OPTIMIZATION_MIN_ANSWERS - 1 },
        (_, i) => answer(`w${i % 5}`, i % 3 !== 0, i),
      ),
      today: "2026-09-08",
    });
    expect(() => assertEnoughSrsData(input)).toThrow(/30回/);
  });
});

describe("clampProposal", () => {
  const current = DEFAULT_SETTINGS.srsParams;

  it("L0/L1 は 0 固定にクランプ", () => {
    const out = clampProposal(
      { ...PROPOSAL, intervalDays: [2, 3, 1, 4] },
      current,
    );
    expect(out.intervalDays[0]).toBe(0);
    expect(out.intervalDays[1]).toBe(0);
  });

  it("現行値から ±3 日以内にクランプ", () => {
    const out = clampProposal(
      { ...PROPOSAL, intervalDays: [0, 0, 10, 30] },
      current,
    );
    expect(out.intervalDays[2]).toBe(4); // 1+3
    expect(out.intervalDays[3]).toBe(7); // 4+3
  });

  it("単調非減少に修正（L2 > L3 なら L3 に追随）", () => {
    const out = clampProposal(
      { ...PROPOSAL, intervalDays: [0, 0, 4, 2] },
      current,
    );
    expect(out.intervalDays[2]).toBe(4); // 1+3 cap
    expect(out.intervalDays[3]).toBe(4); // 単調性で引き上げ
  });

  it("負の値は 0 に", () => {
    const out = clampProposal(
      { ...PROPOSAL, intervalDays: [0, 0, -2, -5] as never },
      current,
    );
    // parse 段階で int().min(0) に弾かれる想定だが、clamp も防御する
    expect(out.intervalDays[2]).toBeGreaterThanOrEqual(0);
    expect(out.intervalDays[3]).toBeGreaterThanOrEqual(0);
  });
});

describe("isNoopProposal", () => {
  it("デフォルト一致は noop", () => {
    expect(
      isNoopProposal({
        ...PROPOSAL,
        intervalDays: [0, 0, 1, 4],
        level3WrongDemotesTo: 1,
      }),
    ).toBe(true);
  });
  it("1日でも違えば noop でない", () => {
    expect(isNoopProposal(PROPOSAL)).toBe(false);
  });
});

describe("parseSrsProposal", () => {
  it("前後の説明文付き JSON をパース", () => {
    const text = `提案です:\n{"intervalDays":[0,0,2,6],"level3WrongDemotesTo":1,"rationale":"良いです","confidence":"medium"}\n以上`;
    expect(parseSrsProposal(text).intervalDays).toEqual([0, 0, 2, 6]);
  });

  it("不正スキーマはエラー", () => {
    expect(() =>
      parseSrsProposal(
        '{"intervalDays":[0,0,2],"rationale":"x","confidence":"high"}',
      ),
    ).toThrow(/スキーマ検証に失敗/);
  });

  it("JSONなしはエラー", () => {
    expect(() => parseSrsProposal("ごめんなさい、出せません")).toThrow(
      /JSONを解析できませんでした/,
    );
  });
});

describe("proposalToParams", () => {
  it("コピーして SrsParams に変換（元配列を共有しない）", () => {
    const params = proposalToParams(PROPOSAL);
    expect(params).toEqual({
      intervalDays: [0, 0, 2, 6],
      level3WrongDemotesTo: 1,
    });
    expect(params.intervalDays).not.toBe(PROPOSAL.intervalDays);
  });
});
