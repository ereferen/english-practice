import type { Deck } from "../content/schema";

/**
 * デッキのレベル。並び順は「やさしい → むずかしい」で、絞り込みの選択肢にも使う。
 */
export const DECK_LEVELS: Deck["level"][] = [
  "beginner",
  "intermediate",
  "advanced",
];

/**
 * Issue #302: 画面に出す日本語ラベル。データ上の値（beginner など）はそのまま
 * 残し、UI では必ずこの関数を通す。一覧・詳細・絞り込みで表記がずれると
 * 「同じアプリの中で初級と beginner が混在する」状態になるため。
 */
const DECK_LEVEL_LABEL: Record<Deck["level"], string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
};

export function deckLevelLabel(level: Deck["level"]): string {
  return DECK_LEVEL_LABEL[level];
}
