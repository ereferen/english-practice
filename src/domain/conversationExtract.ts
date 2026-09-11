/**
 * Self-Improve: 会話ログからの学習コンテンツ自動抽出 (issue #19)
 *
 * 英会話画面のチャットログを LLM に送信し、語彙・表現・文法誤りを
 * ExtractedContent として抽出する。#16/#17 と同じ方針:
 * LLM 出力は Zod で検証 + サニタイズしてから「提案」として返し、
 * デッキへの保存はユーザー承認後（#20 の承認UXに接続）。
 *
 * - buildExtractPrompt(): 純粋関数。会話ログをプロンプト化
 * - parseExtractionResult(): JSON抽出 + Zod検証 + クランプ
 * - extractContentWithLlm(): #18 requestLlmChat で抽出実行
 * - extractedToWord(): ExtractedContent → 既存コンテンツスキーマの Word 変換
 * - dedupeExtracted(): 既存デッキ語彙・バッチ内重複の除去
 */

import { z } from "zod";
import type { Deck, Word } from "../content/schema";
import { requestLlmChat } from "./llm";
import type { LlmProviderConfig } from "./llm";
import type { ChatMessage } from "./conversation";
import { extractJsonObject } from "./quizGeneration";

// ---------------------------------------------------------------------------
// 抽出データ型（issue #19 の仕様どおり）
// ---------------------------------------------------------------------------

export type ExtractedType = "vocabulary" | "expression" | "grammar-correction";

export interface ExtractedContent {
  type: ExtractedType;
  sourceMessageId: string;
  sourceText: string;
  term: string;
  reading?: string;
  meaning: string;
  example: string;
  correctedVersion?: string;
  explanation?: string;
}

/** 上限（LLM の冗長出力をアプリのスケールに合わせる） */
export const MAX_EXTRACTED_ITEMS = 8;
const MAX_TEXT_LEN = 300;
const MAX_TERM_LEN = 80;

const extractedItemSchema = z.object({
  type: z.enum(["vocabulary", "expression", "grammar-correction"]),
  sourceMessageIndex: z.number().int().min(0).optional(),
  sourceText: z.string().max(MAX_TEXT_LEN).default(""),
  term: z.string().min(1).max(MAX_TERM_LEN),
  reading: z.string().max(MAX_TERM_LEN).optional(),
  meaning: z.string().min(1).max(MAX_TEXT_LEN),
  example: z.string().max(MAX_TEXT_LEN).default(""),
  correctedVersion: z.string().max(MAX_TEXT_LEN).optional(),
  explanation: z.string().max(MAX_TEXT_LEN).optional(),
});

const extractionSchema = z.object({
  items: z.array(extractedItemSchema).max(50), // 異常に長い出力はエラー、実用上限への切詰めは後段の slice
});

export type ExtractionItem = z.infer<typeof extractedItemSchema>;

// ---------------------------------------------------------------------------
// プロンプト
// ---------------------------------------------------------------------------

/** 会話として送り込む最大ターン数（先頭・末尾を保持し、中央を端折る） */
const MAX_TURNS_IN_PROMPT = 30;

function trimTranscript(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_TURNS_IN_PROMPT) return messages;
  const head = messages.slice(0, MAX_TURNS_IN_PROMPT / 2);
  const tail = messages.slice(-MAX_TURNS_IN_PROMPT / 2);
  return [...head, ...tail];
}

export function buildExtractPrompt(messages: ChatMessage[]): string {
  const transcript = trimTranscript(messages)
    .filter((m) => m.role !== "system")
    .map(
      (m, i) =>
        `[${i}] ${m.role === "user" ? "LEARNER" : "PARTNER"}: ${m.content.slice(0, MAX_TEXT_LEN)}`,
    )
    .join("\n");

  return `You are a learning-content extractor for a Japanese English learner (CEFR B1-B2). Below is a conversation transcript; the LEARNER is a Japanese speaker.

${transcript}

Extract at most 5 items that are worth REVIEWING as flashcards. Only pick things actually present in the transcript, prioritizing:
1. "vocabulary": a useful or uncommon word from the PARTNER's messages the learner likely didn't know.
2. "expression": a set phrase / idiom used naturally in the conversation.
3. "grammar-correction": a mistake in a LEARNER message, with the correct version.

Rules:
- meaning: a short Japanese definition or explanation.
- example: a natural example sentence taken from or adapted from the transcript.
- correctedVersion: REQUIRED for grammar-correction (the fixed sentence); omit otherwise.
- explanation: for grammar-correction, a 1-sentence Japanese explanation of the mistake.
- sourceMessageIndex: the [n] index of the message the item came from.
- Skip greetings and filler. If nothing is worth extracting, return an empty items array.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"items":[{"type":"vocabulary","sourceMessageIndex":3,"sourceText":"...","term":"...","reading":"...","meaning":"...","example":"..."}]}`;
}

// ---------------------------------------------------------------------------
// 解析 + サニタイズ（LLM 出力は絶対に素で信用しない）
// ---------------------------------------------------------------------------

export class ExtractionError extends Error {}

function cleanText(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "") // 念のため HTML タグ片を除去
    .trim()
    .slice(0, MAX_TEXT_LEN);
}

/**
 * LLM 応答を解析して ExtractedContent[] を返す。
 * sourceMessageIndex は会話の messageIds に解決される。解決できなければ
 * sourceText がある項のみ sourceMessageId="" で許容（UI は本文で示す）。
 */
export function parseExtractionResult(
  text: string,
  messages: ChatMessage[],
): ExtractedContent[] {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new ExtractionError(
      "LLM応答からJSONを解析できませんでした。もう一度試行してください。",
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new ExtractionError(
      "LLM応答のJSONが不正です。もう一度試行してください。",
    );
  }
  const parsed = extractionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ExtractionError(
      `抽出結果のスキーマ検証に失敗しました: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join(" / ")}`,
    );
  }

  const nonSystem = messages.filter((m) => m.role !== "system");
  const out: ExtractedContent[] = [];
  for (const item of parsed.data.items.slice(0, MAX_EXTRACTED_ITEMS)) {
    const term = cleanText(item.term);
    const meaning = cleanText(item.meaning);
    if (!term || !meaning) continue;
    if (
      item.type === "grammar-correction" &&
      !cleanText(item.correctedVersion ?? "")
    ) {
      continue; // 修正案なしの文法項目は学習カードとして不完全
    }
    const indexed =
      item.sourceMessageIndex !== undefined
        ? nonSystem[item.sourceMessageIndex]
        : undefined;
    const source =
      indexed ??
      nonSystem.find((m) => m.content.includes(cleanText(item.term)));
    out.push({
      type: item.type,
      sourceMessageId: source?.id ?? "",
      sourceText: cleanText(item.sourceText || source?.content || ""),
      term,
      ...(item.reading ? { reading: cleanText(item.reading) } : {}),
      meaning,
      example: cleanText(item.example),
      ...(item.correctedVersion
        ? { correctedVersion: cleanText(item.correctedVersion) }
        : {}),
      ...(item.explanation ? { explanation: cleanText(item.explanation) } : {}),
    });
  }
  return out;
}

export function assertEnoughConversationMessages(
  messages: ChatMessage[],
): void {
  const turns = messages.filter((m) => m.role === "user").length;
  if (turns < 2) {
    throw new ExtractionError(
      "抽出には少なくとも2回のあなたの発話が必要です。会話を続けてから再試行してください。",
    );
  }
}

export async function extractContentWithLlm(opts: {
  providers: LlmProviderConfig[];
  messages: ChatMessage[];
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ExtractedContent[]> {
  assertEnoughConversationMessages(opts.messages);
  const result = await requestLlmChat({
    providers: opts.providers,
    messages: [{ role: "user", content: buildExtractPrompt(opts.messages) }],
    maxTokens: 1500,
    temperature: 0.3,
    timeoutMs: opts.timeoutMs ?? 30_000,
    signal: opts.signal,
  });
  return parseExtractionResult(result.content, opts.messages);
}

// ---------------------------------------------------------------------------
// 既存コンテンツスキーマへの変換（ユーザーデッキ保存用、issue #19 の保存先仕様）
// ---------------------------------------------------------------------------

/** slugSchema 互換の wordId を作る（小文字英数字とハイフンのみ、64字） */
export function termToWordId(term: string, index: number): string {
  const base = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "term"}-${index}`;
}

const PART_OF_SPEECH_HINTS: [RegExp, Word["partOfSpeech"]][] = [
  [/\b(verb|v\.|動詞)\b/i, "verb"],
  [/\b(noun|n\.|名詞)\b/i, "noun"],
  [/\b(adjective|adj\.|形容詞)\b/i, "adjective"],
  [/\b(adverb|adv\.|副詞)\b/i, "adverb"],
];

function guessPartOfSpeech(item: ExtractedContent): Word["partOfSpeech"] {
  const hintSource = `${item.reading ?? ""} ${item.meaning} ${item.explanation ?? ""}`;
  for (const [re, pos] of PART_OF_SPEECH_HINTS) {
    if (re.test(hintSource)) return pos;
  }
  return "other";
}

/**
 * ExtractedContent → Word（deckSchema/wordSchema 検証を通る形）。
 * grammar-correction は term=誤文 / correctedVersion を note に載せる。
 */
export function extractedToWord(item: ExtractedContent, index: number): Word {
  const term =
    item.type === "grammar-correction"
      ? item.term.slice(0, MAX_TERM_LEN)
      : item.term;
  const word: Word = {
    wordId: termToWordId(term, index),
    term,
    reading:
      item.reading?.trim() || (/[^\u0020-\u007e]/.test(term) ? term : "—"),
    meaning: item.meaning,
    examples: [
      {
        en: item.example || (item.correctedVersion ?? term),
        ...(item.sourceText
          ? { ja: item.sourceText.slice(0, MAX_TEXT_LEN) }
          : {}),
      },
    ],
    partOfSpeech: guessPartOfSpeech(item),
    tags: ["conversation", item.type],
  };
  if (item.correctedVersion) {
    word.note = `✗ ${item.term}\n✓ ${item.correctedVersion}${item.explanation ? `\n${item.explanation}` : ""}`;
  } else if (item.explanation) {
    word.note = item.explanation;
  }
  return word;
}

// ---------------------------------------------------------------------------
// 重複チェック（既存デッキに同じ語がある場合のマージ戦略: スキップ）
// ---------------------------------------------------------------------------

/** 比較用の正規化キー（小文字化・句読点除去・空白圧縮） */
export function normalizeTermKey(term: string): string {
  return term
    .toLowerCase()
    .replace(/[.,!?;:'"()（）【】""]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 既存デッキの語彙（term 群）とバッチ内重複を除いた残りを返す。
 * マージ戦略は「新規のみ追加」（既存カードの復習状態を上書きしないため）。
 */
export function dedupeExtracted(
  items: ExtractedContent[],
  existingTerms: string[],
): ExtractedContent[] {
  const seen = new Set(existingTerms.map(normalizeTermKey));
  const out: ExtractedContent[] = [];
  for (const item of items) {
    const key = normalizeTermKey(item.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 会話抽出デッキの組み立て / マージ（issue #19 保存先: source: "conversation"）
// ---------------------------------------------------------------------------

export const CONVERSATION_DECK_ID = "conversation-extract";

/** validateDeckConsistency 相当（term/meaning/wordId の一意性）を満たすよう連番で避ける */
function ensureUniqueMeaning(meaning: string, seen: Set<string>): string {
  const key = normalizeTermKey(meaning);
  if (!seen.has(key)) {
    seen.add(key);
    return meaning;
  }
  for (let n = 2; ; n++) {
    const candidate = `${meaning} (${n})`;
    if (!seen.has(normalizeTermKey(candidate))) {
      seen.add(normalizeTermKey(candidate));
      return candidate;
    }
  }
}

export function buildConversationDeck(
  items: ExtractedContent[],
  opts: { now: string; level?: Deck["level"] },
): Deck {
  const date = opts.now.slice(0, 10);
  const meanings = new Set<string>();
  const words: Word[] = [];
  items.forEach((item, i) => {
    const word = extractedToWord(item, i);
    word.meaning = ensureUniqueMeaning(word.meaning, meanings);
    words.push(word);
  });
  return {
    schemaVersion: "1.0",
    deckId: CONVERSATION_DECK_ID,
    level: opts.level ?? "intermediate",
    title: `会話から抽出 (${date})`,
    description: "英会話ログからLLMが抽出した語彙・表現・文法訂正のデッキ",
    source: "conversation",
    lessons: [
      {
        lessonId: "extracted",
        title: "この会話から",
        words,
        quizzes: [],
      },
    ],
  };
}

/**
 * 既存の会話デッキへの追加マージ。term重複（正規化一致）の語はスキップし、
 * meaning 衝突は連番で回避して validateDeckConsistency を満たしたまま返す。
 * 追加があった場合のみ updatedAt を進める。
 */
export function mergeIntoConversationDeck(
  existing: Deck,
  items: ExtractedContent[],
  opts: { now: string },
): { deck: Deck; added: number } {
  const lesson = existing.lessons[0];
  if (!lesson) return { deck: existing, added: 0 };
  const existingTerms = lesson.words.map((w) => w.term);
  const fresh = dedupeExtracted(items, existingTerms);
  if (fresh.length === 0) return { deck: existing, added: 0 };

  const meanings = new Set(lesson.words.map((w) => w.meaning));
  let nextIndex = lesson.words.length;
  const addedWords: Word[] = [];
  for (const item of fresh) {
    const word = extractedToWord(item, nextIndex);
    // wordId 衝突回避（termToWordId は index 連番なので語彙数から続番を採る）
    while (lesson.words.some((w) => w.wordId === word.wordId)) {
      nextIndex += 1;
      word.wordId = termToWordId(word.term, nextIndex);
    }
    word.meaning = ensureUniqueMeaning(word.meaning, meanings);
    nextIndex += 1;
    addedWords.push(word);
  }
  const deck: Deck = {
    ...existing,
    title: existing.title.replace(
      /\(\d{4}-\d{2}-\d{2}\)$/,
      `(${opts.now.slice(0, 10)})`,
    ),
    lessons: [
      { ...lesson, words: [...lesson.words, ...addedWords] },
      ...existing.lessons.slice(1),
    ],
  };
  return { deck, added: addedWords.length };
}
