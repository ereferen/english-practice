import type { Deck } from "../content/schema";
import { allWords } from "../content/loader";
import { isOwnDeck } from "./manualDeck";

export interface WordCounts {
  /** 自分のデッキ（会話抽出・手動追加）の語数。 */
  own: number;
  /** 同梱サンプルデッキの語数。 */
  sample: number;
  /** 合計（own + sample）。 */
  total: number;
}

/**
 * Issue #291: ダッシュボードの「登録語数」がサンプル同梱デッキ込みの合計だったため、
 * 自分が入れた語（例: 6語）より大きな数字（例: 41語）が出て、語彙が増えた実感を持てなかった。
 * デッキ一覧の「自分のデッキ / サンプル」の区分と同じ判定（isOwnDeck）で語数を分ける。
 */
export function countWordsByOwnership(decks: Deck[]): WordCounts {
  let own = 0;
  let sample = 0;
  for (const deck of decks) {
    const n = allWords(deck).length;
    if (isOwnDeck(deck)) own += n;
    else sample += n;
  }
  return { own, sample, total: own + sample };
}
