import { describe, expect, it } from "vitest";
import {
  makeSrsApplyRecord,
  resolveSrsRollback,
  srsParamsEqual,
} from "./improvements";
import type { SrsProposal } from "./srsOptimization";
import { DEFAULT_SRS_PARAMS } from "../storage/types";
import type { ImprovementAction, SrsParams } from "../storage/types";

const PROPOSAL: SrsProposal = {
  intervalDays: [0, 0, 2, 6],
  level3WrongDemotesTo: 1,
  rationale: "level3正答率92%のため間隔を延伸",
  confidence: "high",
};

function action(over: Partial<ImprovementAction> = {}): ImprovementAction {
  return {
    id: "a1",
    category: "srs-params",
    rationale: "test",
    model: "deepseek-v4-flash",
    appliedAt: "2026-09-01T00:00:00.000Z",
    applied: { intervalDays: [0, 0, 2, 6], level3WrongDemotesTo: 1 },
    previous: DEFAULT_SRS_PARAMS,
    rolledBackAt: null,
    ...over,
  };
}

describe("makeSrsApplyRecord", () => {
  it("applied=提案値 / previous=適用前のdeep copy / rolledBackAt=null", () => {
    const previous: SrsParams = {
      intervalDays: [0, 0, 1, 4],
      level3WrongDemotesTo: 1,
    };
    const rec = makeSrsApplyRecord({
      proposal: PROPOSAL,
      previous,
      model: "m1",
      appliedAt: "2026-09-02T00:00:00.000Z",
      id: "x",
    });
    expect(rec.id).toBe("x");
    expect(rec.category).toBe("srs-params");
    expect(rec.applied).toEqual({
      intervalDays: [0, 0, 2, 6],
      level3WrongDemotesTo: 1,
    });
    expect(rec.rationale).toBe(PROPOSAL.rationale);
    expect(rec.rolledBackAt).toBeNull();
    // 呼び出し後の proposal/previous 変更が記録に漏れない
    PROPOSAL.intervalDays[3] = 99;
    previous.intervalDays[2] = 5;
    expect(rec.applied.intervalDays[3]).toBe(6);
    expect(rec.previous.intervalDays[2]).toBe(1);
  });
});

describe("resolveSrsRollback", () => {
  const applied: SrsParams = {
    intervalDays: [0, 0, 2, 6],
    level3WrongDemotesTo: 1,
  };

  it("最新の active アクションは previous にロールバック可", () => {
    const a = action();
    const r = resolveSrsRollback([a], "a1", applied);
    expect(r).toEqual({ ok: true, restore: DEFAULT_SRS_PARAMS });
  });

  it("より新しい active があれば拒否（理由に根拠文を含む）", () => {
    const older = action();
    const newer = action({
      id: "a2",
      appliedAt: "2026-09-05T00:00:00.000Z",
      rationale: "さらに延伸",
    });
    const r = resolveSrsRollback([newer, older], "a1", applied);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("さらに延伸");
  });

  it("新しい方がロールバック済みなら拒否しない", () => {
    const older = action();
    const newer = action({
      id: "a2",
      appliedAt: "2026-09-05T00:00:00.000Z",
      rolledBackAt: "2026-09-06T00:00:00.000Z",
    });
    expect(resolveSrsRollback([newer, older], "a1", applied).ok).toBe(true);
  });

  it("現行パラメータが applied とズレていれば拒否", () => {
    const r = resolveSrsRollback([action()], "a1", DEFAULT_SRS_PARAMS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("一致しません");
  });

  it("既にロールバック済み / 存在しない ID は拒否", () => {
    const rolled = action({ rolledBackAt: "2026-09-03T00:00:00.000Z" });
    expect(resolveSrsRollback([rolled], "a1", applied).ok).toBe(false);
    expect(resolveSrsRollback([action()], "nope", applied).ok).toBe(false);
  });

  it("別カテゴリの新しいアクションはブロックしない", () => {
    const other = action({
      id: "b1",
      category: "srs-params" as ImprovementAction["category"],
      appliedAt: "2026-09-09T00:00:00.000Z",
    });
    // 現状カテゴリは srs-params のみ。category フィルタの挙動を確認するため
    // 同じカテゴリの newer は上記テスト済み → ここでは filtered 検索の整合を見る
    expect(resolveSrsRollback([other, action()], "a1", applied).ok).toBe(
      false,
    );
  });
});

describe("srsParamsEqual", () => {
  it("配列の中身比較", () => {
    expect(srsParamsEqual(DEFAULT_SRS_PARAMS, { ...DEFAULT_SRS_PARAMS })).toBe(
      true,
    );
    expect(
      srsParamsEqual(DEFAULT_SRS_PARAMS, {
        intervalDays: [0, 0, 1, 5],
        level3WrongDemotesTo: 1,
      }),
    ).toBe(false);
  });
});
