import type { Word } from "../content/schema";

/**
 * Issue #168 / #187: 品詞バッジはあちこちで英語のまま出ていた（noun / other）。
 * 日本語 UI に合わせて表記を日本語化し、"other" は情報量ゼロなので出さない。
 * フラッシュカード・会話抽出パネル・デッキ単語一覧で同じ表記を使うため
 * ここに一本化する。
 */
export const PART_OF_SPEECH_LABELS: Record<
  NonNullable<Word["partOfSpeech"]>,
  string
> = {
  noun: "名詞",
  verb: "動詞",
  adjective: "形容詞",
  adverb: "副詞",
  preposition: "前置詞",
  conjunction: "接続詞",
  pronoun: "代名詞",
  determiner: "限定詞",
  exclamation: "間投詞",
  other: "", // 判定不能 — バッジを出さない
};

/** 品詞の日本語ラベル。未指定・"other" は空文字（バッジ非表示）。 */
export function partOfSpeechLabel(
  pos: Word["partOfSpeech"] | undefined,
): string {
  return pos ? PART_OF_SPEECH_LABELS[pos] : "";
}
