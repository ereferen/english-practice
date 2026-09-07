import type { Word } from "../content/schema";

export const fixtureWords: readonly Word[] = [
  {
    wordId: "ability",
    term: "ability",
    reading: "アビリティ",
    meaning: "能力",
    partOfSpeech: "noun",
    examples: [
      {
        en: "She has the ability to speak four languages.",
        ja: "彼女は4つの言語を話す能力がある。",
      },
    ],
  },
  {
    wordId: "achieve",
    term: "achieve",
    reading: "アチーブ",
    meaning: "達成する",
    partOfSpeech: "verb",
    examples: [
      {
        en: "We need to achieve our goals by the end of the year.",
        ja: "年末までに目標を達成する必要がある。",
      },
    ],
  },
  {
    wordId: "benefit",
    term: "benefit",
    reading: "ベネフィット",
    meaning: "利益; 恩恵",
    partOfSpeech: "noun",
    examples: [
      {
        en: "Exercise has many health benefits.",
        ja: "運動には多くの健康上の恩恵がある。",
      },
    ],
  },
  {
    wordId: "challenge",
    term: "challenge",
    reading: "チャレンジ",
    meaning: "課題; 挑戦",
    partOfSpeech: "noun",
    examples: [
      {
        en: "The new job will be a challenge.",
        ja: "新しい仕事は挑戦になるだろう。",
      },
    ],
  },
  {
    wordId: "develop",
    term: "develop",
    reading: "ディベロップ",
    meaning: "発達する; 開発する",
    partOfSpeech: "verb",
    examples: [
      {
        en: "We need to develop a new strategy.",
        ja: "新しい戦略を開発する必要がある。",
      },
    ],
  },
  {
    wordId: "environment",
    term: "environment",
    reading: "エンバイロンメント",
    meaning: "環境",
    partOfSpeech: "noun",
    examples: [
      {
        en: "Protecting the environment is important.",
        ja: "環境を保護することは重要だ。",
      },
    ],
  },
  {
    wordId: "focus",
    term: "focus",
    reading: "フォーカス",
    meaning: "集中する; 焦点",
    partOfSpeech: "verb",
    examples: [
      { en: "Please focus on your work.", ja: "仕事に集中してください。" },
    ],
  },
  {
    wordId: "global",
    term: "global",
    reading: "グローバル",
    meaning: "世界的な; 地球規模の",
    partOfSpeech: "adjective",
    examples: [
      {
        en: "Climate change is a global issue.",
        ja: "気候変動は地球規模の問題だ。",
      },
    ],
  },
  {
    wordId: "handle",
    term: "handle",
    reading: "ハンドル",
    meaning: "扱う; 処理する",
    partOfSpeech: "verb",
    examples: [
      {
        en: "She knows how to handle difficult customers.",
        ja: "彼女は難しい客の扱い方を知っている。",
      },
    ],
  },
  {
    wordId: "improve",
    term: "improve",
    reading: "インプルーブ",
    meaning: "改善する",
    partOfSpeech: "verb",
    examples: [
      {
        en: "I want to improve my English skills.",
        ja: "英語力を向上させたい。",
      },
    ],
  },
] as const;

export function wordById(wordId: string): Word | undefined {
  return fixtureWords.find((w) => w.wordId === wordId);
}

export function wordsByIds(wordIds: string[]): Word[] {
  const result: Word[] = [];
  for (const id of wordIds) {
    const found = wordById(id);
    if (found) result.push(found);
  }
  return result;
}
