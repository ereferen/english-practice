import Dexie, { type EntityTable } from "dexie";
import type {
  AnswerEvent,
  GeneratedQuizSet,
  ReviewState,
  SessionRecord,
  Settings,
} from "./types";

export interface DexieSchema {
  settings: EntityTable<Settings & { id: number }, "id">;
  review: EntityTable<ReviewState, "wordId">;
  sessions: EntityTable<SessionRecord, "id">;
  answers: EntityTable<AnswerEvent, "id">;
  generatedQuizzes: EntityTable<GeneratedQuizSet, "id">;
}

export const db = new Dexie("EnglishPracticeDB") as Dexie & DexieSchema;

db.version(1).stores({
  settings: "++id",
  review: "[deckId+wordId], deckId, dueAt, level",
  sessions: "id, deckId, startedAt",
  answers: "id, sessionId, wordId, askedAt, [sessionId+wordId]",
});

// issue #15: LLM生成クイズの一時保存（追加テーブルのみ、既存データの移行は不要）
db.version(2).stores({
  generatedQuizzes: "id, deckId, lessonId, generatedAt, [deckId+lessonId]",
});
