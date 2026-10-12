/**
 * Issue #178: 自分の単語デッキを手動で作る（会話が使えない間の逃げ道）。
 *
 * 会話抽出（conversationExtract.ts）と同じ保存経路（deckSchema 検証 →
 * storage.saveUserDeck）を使うが、ソースは source:"manual" とし、
 * 会話デッキとは別のデッキにまとめる（用途が違うため混ぜない）。
 *
 * - parseManualWords(): 貼り付けたテキストを行単位で解釈（純関数）
 * - buildManualDeck() / mergeIntoManualDeck(): Deck を組み立てる（純関数）
 */

import type { Deck, Word } from "../content/schema";
import {
  CONVERSATION_DECK_ID,
  normalizeTermKey,
  termToWordId,
} from "./conversationExtract";

export const MANUAL_DECK_ID = "manual-words";

/**
 * issue #151/#178/#181: 自分で作ったデッキ（会話抽出・手動追加）か。
 * サンプルデッキ（bundled）と区別して、一覧で上に出したり編集対象にしたりする。
 */
export function isOwnDeck(deck: Deck): boolean {
  return (
    deck.source === "conversation" ||
    deck.source === "manual" ||
    deck.deckId === MANUAL_DECK_ID ||
    deck.deckId === CONVERSATION_DECK_ID
  );
}

/** 1行に収まる語の上限（誤って長文を貼ったときの保険）。 */
export const MAX_MANUAL_WORDS = 500;
const MAX_TERM_LEN = 80;
const MAX_TEXT_LEN = 300;

export interface ManualWordInput {
  term: string;
  meaning: string;
  example?: string;
}

export type ManualParseResult =
  { ok: true; words: ManualWordInput[] } | { ok: false; error: string };

/**
 * 貼り付けテキストを行単位で解釈する。
 * 1行1語。[語]\\t[意味]\\t[例文(任意)] または [語],[意味],[例文(任意)]。
 * 空行と `#` 始まりの行（コメント）は無視する。崩れた行は行番号付きで弾く。
 */
export function parseManualWords(text: string): ManualParseResult {
  const lines = text.split(/\r?\n/);
  const words: ManualWordInput[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("#")) continue;

    // タブ区切りを優先。無ければカンマ（和文/半角）で最大3分割。
    const fields = raw.includes("\t")
      ? raw.split("\t").map((s) => s.trim())
      : raw.split(/\s*[,，]\s*/);

    const term = fields[0]?.trim() ?? "";
    const meaning = fields[1]?.trim() ?? "";
    const example = fields.slice(2).join(", ").trim();

    if (!term || !meaning) {
      return {
        ok: false,
        error: `${i + 1}行目: 語と意味をタブまたはカンマで区切ってください`,
      };
    }

    words.push({
      term: term.slice(0, MAX_TERM_LEN),
      meaning: meaning.slice(0, MAX_TEXT_LEN),
      ...(example ? { example: example.slice(0, MAX_TEXT_LEN) } : {}),
    });
  }

  if (words.length === 0) {
    return { ok: false, error: "追加する語がありません" };
  }
  if (words.length > MAX_MANUAL_WORDS) {
    return {
      ok: false,
      error: `一度に追加できるのは ${MAX_MANUAL_WORDS} 語までです（${words.length} 語）`,
    };
  }
  return { ok: true, words };
}

/** 手動語 → wordSchema 検証を通る Word に変換する。 */
function manualToWord(item: ManualWordInput, index: number): Word {
  return {
    wordId: termToWordId(item.term, index),
    term: item.term,
    // wordSchema は reading を必須にする。非ASCII語はそのまま、ASCIIはダッシュ。
    reading: /[^\u0020-\u007e]/.test(item.term) ? item.term : "—",
    meaning: item.meaning,
    examples: [{ en: item.example || item.term }],
    tags: ["manual"],
  };
}

/** meaning の重複を連番で回避（validateDeckConsistency 対策）。 */
function uniqueMeaning(meaning: string, seen: Set<string>): string {
  if (!seen.has(normalizeTermKey(meaning))) {
    seen.add(normalizeTermKey(meaning));
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

export function buildManualDeck(
  words: ManualWordInput[],
  opts: { now: string; level?: Deck["level"] },
): Deck {
  const date = opts.now.slice(0, 10);
  const meanings = new Set<string>();
  const built: Word[] = words.map((w, i) => {
    const word = manualToWord(w, i);
    word.meaning = uniqueMeaning(word.meaning, meanings);
    return word;
  });
  return {
    schemaVersion: "1.0",
    deckId: MANUAL_DECK_ID,
    level: opts.level ?? "intermediate",
    title: `手動追加 (${date})`,
    description: "自分で入力した単語デッキ",
    source: "manual",
    lessons: [
      {
        lessonId: "manual",
        title: "追加した単語",
        words: built,
        quizzes: [],
      },
    ],
  };
}

/**
 * Issue #181: 自分のデッキを後から直す（名前変更・語の編集・語の削除）。
 *
 * aki の指摘: 「入れたら最後、直せない」。ここでは純関数だけを提供し、
 * 保存は呼び出し側（DeckHome）が storage.saveUserDeck / deleteUserDeck で行う。
 */

export const MAX_DECK_TITLE_LEN = 60;

export type DeckEditResult =
  | { ok: true; deck: Deck }
  | { ok: false; error: string };

/** デッキ名を変更する。空文字は無視（既存をそのまま返す）。 */
export function renameDeck(deck: Deck, title: string): Deck {
  const trimmed = title.trim().slice(0, MAX_DECK_TITLE_LEN);
  if (!trimmed) return deck;
  return { ...deck, title: trimmed };
}

/** 編集対象の語を探す（手動/会話デッキは最初のレッスンに語がまとまっている）。 */
function firstLessonWords(deck: Deck): Word[] | null {
  return deck.lessons[0]?.words ?? null;
}

function replaceWords(deck: Deck, words: Word[]): Deck {
  const lesson = deck.lessons[0];
  if (!lesson) return deck;
  return {
    ...deck,
    lessons: [{ ...lesson, words }, ...deck.lessons.slice(1)],
  };
}

/**
 * 語を編集する。term / meaning の重複（正規化一致）は弾く。
 * wordId は据え置き（SRS の復習履歴と紐づいているため変えない）。
 */
export function editDeckWord(
  deck: Deck,
  wordId: string,
  input: ManualWordInput,
): DeckEditResult {
  const words = firstLessonWords(deck);
  if (!words) return { ok: false, error: "デッキにレッスンがありません" };
  const index = words.findIndex((w) => w.wordId === wordId);
  if (index < 0) return { ok: false, error: "語が見つかりません" };

  const term = input.term.trim();
  const meaning = input.meaning.trim();
  if (!term || !meaning) {
    return { ok: false, error: "語と意味は両方入力してください" };
  }

  const termKey = normalizeTermKey(term);
  const meaningKey = normalizeTermKey(meaning);
  for (let i = 0; i < words.length; i++) {
    if (i === index) continue;
    if (normalizeTermKey(words[i].term) === termKey) {
      return { ok: false, error: "同じ語がすでにデッキにあります" };
    }
    if (normalizeTermKey(words[i].meaning) === meaningKey) {
      return { ok: false, error: "同じ意味がすでにデッキにあります" };
    }
  }

  const example = input.example?.trim();
  const updated: Word = {
    ...words[index],
    term,
    // wordSchema は reading を必須にする（manualToWord と同じ規則）。
    reading: /[^\u0020-\u007e]/.test(term) ? term : "—",
    meaning,
    examples: [{ en: example || term }],
  };
  const next = words.map((w, i) => (i === index ? updated : w));
  return { ok: true, deck: replaceWords(deck, next) };
}

/**
 * 語を削除する。lessonSchema が words を min(1) で要求するため、
 * 最後の1語は削除できない（デッキごと削除する導線に誘導する）。
 */
export function removeDeckWord(deck: Deck, wordId: string): DeckEditResult {
  const words = firstLessonWords(deck);
  if (!words) return { ok: false, error: "デッキにレッスンがありません" };
  const next = words.filter((w) => w.wordId !== wordId);
  if (next.length === words.length) {
    return { ok: false, error: "語が見つかりません" };
  }
  if (next.length === 0) {
    return {
      ok: false,
      error: "最後の1語は削除できません。デッキごと削除してください",
    };
  }
  return { ok: true, deck: replaceWords(deck, next) };
}

/**
 * 既存の手動デッキへの追加マージ。term 重複（正規化一致）はスキップし、
 * wordId / meaning 衝突は連番で回避したまま返す。
 */
export function mergeIntoManualDeck(
  existing: Deck,
  words: ManualWordInput[],
  opts: { now: string; level?: Deck["level"] },
): { deck: Deck; added: number } {
  const lesson = existing.lessons[0];
  if (!lesson) return { deck: existing, added: 0 };

  const seen = new Set(lesson.words.map((w) => normalizeTermKey(w.term)));
  const fresh: ManualWordInput[] = [];
  for (const w of words) {
    const key = normalizeTermKey(w.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(w);
  }
  if (fresh.length === 0) return { deck: existing, added: 0 };

  const meanings = new Set(
    lesson.words.map((w) => normalizeTermKey(w.meaning)),
  );
  let nextIndex = lesson.words.length;
  const addedWords: Word[] = [];
  for (const item of fresh) {
    const word = manualToWord(item, nextIndex);
    while (lesson.words.some((w) => w.wordId === word.wordId)) {
      nextIndex += 1;
      word.wordId = termToWordId(word.term, nextIndex);
    }
    word.meaning = uniqueMeaning(word.meaning, meanings);
    nextIndex += 1;
    addedWords.push(word);
  }

  const deck: Deck = {
    ...existing,
    level: opts.level ?? existing.level,
    title: existing.title.replace(
      /\((\d{4}-\d{2}-\d{2})\)$/,
      `(${opts.now.slice(0, 10)})`,
    ),
    lessons: [
      { ...lesson, words: [...lesson.words, ...addedWords] },
      ...existing.lessons.slice(1),
    ],
  };
  return { deck, added: addedWords.length };
}
