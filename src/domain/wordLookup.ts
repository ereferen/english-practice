/**
 * Issue #245: 会話中に出てきた語をその場で引く（ペルソナ aki の要望）
 *
 * 「次に何を言うか」（ヒント #234）と「相手が言った語が分からない」は別の詰まり方。
 * ここでは後者だけを扱う:
 *
 * - tokenizeForLookup(): 相手メッセージを単語トークンへ分割（表示順・記号を保つ）
 * - findDeckWord(): 既存デッキに同じ語があれば LLM を使わずに即答する
 * - lookupWordWithLlm(): 無いときだけ LLM に 1 語だけ問い合わせる（JSON + Zod）
 *
 * 表示テキストは分割しても連結すると元の文に戻る（記号・空白を落とさない）。
 */

import { z } from "zod";
import type { Deck, Word } from "../content/schema";
import type { LlmProviderConfig } from "./llm";
import { requestLlmChat } from "./llm";
import { extractJsonObject } from "./quizGeneration";
import { normalizeTermKey } from "./conversationExtract";

export interface LookupToken {
  /** 画面に出す文字列（記号・空白を含みうる） */
  text: string;
  /** 引きに行ける語なら正規化済みのキー、無理なら null */
  word: string | null;
}

/**
 * 引く価値の無い語（機能語・あいさつ）。全部をボタンにすると
 * タブ移動が地獄になり、下線もノイズになる。
 */
const NO_LOOKUP_WORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "im",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "to",
  "of",
  "in",
  "on",
  "at",
  "it",
  "its",
  "and",
  "or",
  "but",
  "so",
  "if",
  "as",
  "for",
  "with",
  "my",
  "me",
  "you",
  "your",
  "we",
  "us",
  "our",
  "he",
  "she",
  "they",
  "them",
  "their",
  "his",
  "her",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "not",
  "no",
  "yes",
  "oh",
  "ok",
  "okay",
  "hey",
  "hi",
  "hello",
  "yeah",
  "sure",
  "just",
  "very",
  "too",
  "can",
  "cant",
  "will",
  "would",
  "could",
  "should",
  "have",
  "has",
  "had",
  "from",
  "about",
]);

/**
 * 難しい語ほど下線を引く、の簡易ヒューリスティック。
 * CEFR 辞書を同梱していないので「長さ」で近似する（短い語は既知の可能性が高い）。
 * 下線が付かない語もタップして引ける（下線は「読み飛ばし防止」の目印）。
 */
export const HARD_WORD_MIN_LENGTH = 6;

const LOOKUPABLE_RE = /^[A-Za-z][A-Za-z'’-]*$/;

/** 単語として引ける形か（記号だけ・数字だけは対象外） */
export function lookupWordKey(text: string): string | null {
  if (!LOOKUPABLE_RE.test(text)) return null;
  const key = text.toLowerCase().replace(/['’]/g, "'");
  if (key.replace(/'/g, "").length < 2) return null;
  if (NO_LOOKUP_WORDS.has(key)) return null;
  return key;
}

/** 下線を付ける「難しそうな語」か */
export function isHardWord(text: string): boolean {
  return text.replace(/[^A-Za-z]/g, "").length >= HARD_WORD_MIN_LENGTH;
}

type SegmenterLike = new (
  locale: string,
  opts: { granularity: "word" },
) => {
  segment(input: string): Iterable<{
    segment: string;
    isWordLike?: boolean;
    index: number;
  }>;
};

function getSegmenter(): SegmenterLike | null {
  const impl = (Intl as unknown as { Segmenter?: SegmenterLike }).Segmenter;
  return typeof impl === "function" ? impl : null;
}

/**
 * 文をトークン列へ。英語の単語分割は Intl.Segmenter が正しいが、
 * 未実装環境（古い Safari / jsdom）では英字の連なりを単語とみなす。
 * どちらでも tokens.map(t => t.text).join("") === 入力 になる。
 */
export function tokenizeForLookup(text: string): LookupToken[] {
  const Segmenter = getSegmenter();
  if (Segmenter) {
    const segmenter = new Segmenter("en", { granularity: "word" });
    const tokens: LookupToken[] = [];
    for (const part of segmenter.segment(text)) {
      tokens.push({
        text: part.segment,
        word: part.isWordLike === false ? null : lookupWordKey(part.segment),
      });
    }
    return tokens;
  }
  const tokens: LookupToken[] = [];
  const re = /[A-Za-z][A-Za-z'’-]*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ text: text.slice(last, m.index), word: null });
    }
    tokens.push({ text: m[0], word: lookupWordKey(m[0]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), word: null });
  return tokens;
}

// ---------------------------------------------------------------------------
// 既存デッキからの即答
// ---------------------------------------------------------------------------

export interface DeckWordHit {
  word: Word;
  deckTitle: string;
}

/**
 * 既存デッキ（同梱 + 会話抽出 + 手動）に同じ語があれば返す。
 * 会話に出た語が既にカードになっているケースは LLM を呼ぶまでもない。
 */
export function findDeckWord(
  decks: Deck[],
  word: string,
): DeckWordHit | null {
  const key = normalizeTermKey(word);
  if (!key) return null;
  for (const deck of decks) {
    for (const lesson of deck.lessons) {
      for (const w of lesson.words) {
        if (normalizeTermKey(w.term) === key) {
          return { word: w, deckTitle: deck.title };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM フォールバック（1 語・非ストリーミング・短い出力）
// ---------------------------------------------------------------------------

export interface WordMeaning {
  term: string;
  reading?: string;
  meaning: string;
  example: string;
  exampleJa?: string;
  partOfSpeech?:
    | "noun"
    | "verb"
    | "adjective"
    | "adverb"
    | "preposition"
    | "conjunction"
    | "pronoun"
    | "determiner"
    | "exclamation"
    | "other";
}

const MEANING_SCHEMA = z.object({
  term: z.string().min(1).max(80),
  reading: z.string().max(80).optional(),
  meaning: z.string().min(1).max(300),
  example: z.string().max(300).default(""),
  exampleJa: z.string().max(300).optional(),
  partOfSpeech: z
    .enum([
      "noun",
      "verb",
      "adjective",
      "adverb",
      "preposition",
      "conjunction",
      "pronoun",
      "determiner",
      "exclamation",
      "other",
    ])
    .optional(),
});

export class WordLookupError extends Error {
  details?: string;
  constructor(message: string, details?: string) {
    super(message);
    this.name = "WordLookupError";
    this.details = details;
  }
}

export function buildWordLookupPrompt(word: string, sentence: string): string {
  return `You are a dictionary for a Japanese learner of English (CEFR B1-B2, TOEIC ~730).

Word: "${word}"
Sentence it appeared in: "${sentence}"

Explain the word AS USED IN THAT SENTENCE. Rules:
- "meaning": a short Japanese definition (1-2 sentences). Do not translate the whole sentence.
- "reading": IPA or a simple pronunciation hint.
- "example": ONE short English example sentence using the word the same way.
- "exampleJa": the Japanese translation of "example".
- "partOfSpeech": one of "noun","verb","adjective","adverb","preposition","conjunction","pronoun","determiner","exclamation","other".

Respond with ONLY a JSON object, no markdown fences:
{"term":"...","reading":"...","meaning":"...","example":"...","exampleJa":"...","partOfSpeech":"noun"}`;
}

export function parseWordLookupResult(
  text: string,
  fallbackTerm: string,
): WordMeaning {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new WordLookupError(
      "意味を読み取れませんでした。もう一度タップしてください。",
      `JSON抽出に失敗: ${text.slice(0, 200)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new WordLookupError(
      "意味を読み取れませんでした。もう一度タップしてください。",
      `JSON解析に失敗: ${jsonText.slice(0, 200)}`,
    );
  }
  const parsed = MEANING_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new WordLookupError(
      "このモデルは語の説明形式が想定と違います。別のモデルを試してください。",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join(" / "),
    );
  }
  return { ...parsed.data, term: parsed.data.term.trim() || fallbackTerm };
}

export async function lookupWordWithLlm(opts: {
  providers: LlmProviderConfig[];
  word: string;
  sentence: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<WordMeaning> {
  const result = await requestLlmChat({
    providers: opts.providers,
    messages: [
      {
        role: "user",
        content: buildWordLookupPrompt(opts.word, opts.sentence),
      },
    ],
    maxTokens: 400,
    temperature: 0.2,
    timeoutMs: opts.timeoutMs ?? 20_000,
    signal: opts.signal,
  });
  return parseWordLookupResult(result.content, opts.word);
}
