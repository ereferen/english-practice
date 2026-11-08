/**
 * Issue #256: 例文の「未入力」をどう扱うか。
 *
 * wordSchema は examples を1件以上必須にしているため、手動追加の語で
 * 例文を空にすると `examples: [{ en: term }]` という「単語そのもの」が
 * 保存される（manualDeck.ts）。そのまま描画すると、カード裏面の例文欄に
 * 見出し語がもう一度出るだけで意味の助けにならない。
 *
 * 保存済みデータを書き換えずに直すため、描画側で「例文として成立して
 * いない entry」を落とす。判定は純関数にしてテスト可能にする。
 */

import type { Example, Word } from "../content/schema";

/** 例文として中身があるか（見出し語のコピーは例文とみなさない）。 */
export function isMeaningfulExample(example: Example, term: string): boolean {
  const en = example.en?.trim() ?? "";
  const ja = example.ja?.trim() ?? "";
  if (!en) return ja.length > 0;
  return en.toLowerCase() !== term.trim().toLowerCase();
}

/**
 * 画面に出す例文だけを返す。手動追加で例文を空にした語では空配列になり、
 * 呼び出し側は例文ブロックごと出さない。
 */
export function visibleExamples(word: Word): Example[] {
  return word.examples.filter((ex) => isMeaningfulExample(ex, word.term));
}
