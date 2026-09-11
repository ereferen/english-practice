/**
 * Self-Improve: 改善アクションの履歴・ロールバック (issue #20)
 *
 * #17（SRS提案→承認）と #19（会話抽出→承認保存）でバラバラだった
 * 「承認口」を監査ログ（ImprovementAction）で統一する地盤。
 * 純粋関数のみ here に置き、Dexie への書き出しは storage 層が行う。
 *
 * - makeSrsApplyRecord(): 承認適用時のログレコード生成（previous/applied スナップショット）
 * - resolveRollback(): 指定アクションのロールバック先パラメータを安全性チェック付きで算出。
 *   「適用後にもっと新しいアクションが同じ category に適用されている」場合は
 *   履歴を巻き戻すことにならないので拒否する。
 */

import type {
  ImprovementAction,
  SrsParams,
} from "../storage/types";
import type { SrsProposal } from "./srsOptimization";
import { proposalToParams } from "./srsOptimization";
import { uuid } from "./uuid";

function sameParams(a: SrsParams, b: SrsParams): boolean {
  return (
    a.level3WrongDemotesTo === b.level3WrongDemotesTo &&
    a.intervalDays.every((d, i) => d === b.intervalDays[i])
  );
}

export interface SrsApplyRecordInput {
  proposal: SrsProposal;
  previous: SrsParams;
  model: string;
  appliedAt?: string;
  id?: string;
}

/** 承認→適用が成立した瞬間だけ呼ぶ。ログ生成と保存をセットで忘れないようここに寄せる */
export function makeSrsApplyRecord(
  input: SrsApplyRecordInput,
): ImprovementAction {
  return {
    id: input.id ?? uuid(),
    category: "srs-params",
    rationale: input.proposal.rationale,
    model: input.model,
    appliedAt: input.appliedAt ?? new Date().toISOString(),
    applied: proposalToParams(input.proposal),
    previous: {
      intervalDays: [...input.previous.intervalDays] as [
        number,
        number,
        number,
        number,
      ],
      level3WrongDemotesTo: input.previous.level3WrongDemotesTo,
    },
    rolledBackAt: null,
  };
}

export type RollbackResult =
  | { ok: true; restore: SrsParams }
  | { ok: false; reason: string };

/**
 * actions は appliedAt 降順（storage.listImprovementActions の並び順）を想定。
 * ロールバック可の条件:
 * - 対象が存在し、まだロールバック済みでない
 * - 対象より新しい active（未ロールバック）な srs-params アクションが無い
 * - 現行パラメータが対象の applied と一致する（手編集等でズレていたら告知して拒否）
 */
export function resolveSrsRollback(
  actions: ImprovementAction[],
  targetId: string,
  current: SrsParams,
): RollbackResult {
  const target = actions.find((a) => a.id === targetId);
  if (!target) return { ok: false, reason: "履歴が見つかりません。" };
  if (target.rolledBackAt) {
    return { ok: false, reason: "このアクションは既にロールバック済みです。" };
  }
  const newerActive = actions.find(
    (a) =>
      a.category === target.category &&
      a.id !== target.id &&
      !a.rolledBackAt &&
      a.appliedAt > target.appliedAt,
  );
  if (newerActive) {
    return {
      ok: false,
      reason: `この提案の後もっと新しい改善が適用されています（${newerActive.rationale}）。先にそちらをロールバックしてください。`,
    };
  }
  if (!sameParams(current, target.applied)) {
    return {
      ok: false,
      reason:
        "現行パラメータがこの提案の適用値と一致しません（手動変更済み）。履歴の整合性のためロールバックできません。",
    };
  }
  return { ok: true, restore: target.previous };
}

export { sameParams as srsParamsEqual };
