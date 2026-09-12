import Dexie, { type EntityTable } from "dexie";
import type {
  AnswerEvent,
  GeneratedQuizSet,
  ImprovementAction,
  ProposalRecord,
  ReviewState,
  SessionRecord,
  Settings,
  UserDeckRecord,
} from "./types";

export interface DexieSchema {
  settings: EntityTable<Settings & { id: number }, "id">;
  review: EntityTable<ReviewState, "wordId">;
  sessions: EntityTable<SessionRecord, "id">;
  answers: EntityTable<AnswerEvent, "id">;
  generatedQuizzes: EntityTable<GeneratedQuizSet, "id">;
  userDecks: EntityTable<UserDeckRecord, "deckId">;
  improvementActions: EntityTable<ImprovementAction, "id">;
  proposals: EntityTable<ProposalRecord, "id">;
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

// issue #19: 会話ログ抽出から作成したユーザーデッキ（追加テーブルのみ）
db.version(3).stores({
  userDecks: "deckId, updatedAt",
});

// issue #20: Self-Improve 承認→適用→ロールバックの監査ログ（追加テーブルのみ）
db.version(4).stores({
  improvementActions: "id, category, appliedAt",
});

// issue #20: 未承認の改善提案（提案レビュー画面・Homeバッジ。追加テーブルのみ）
db.version(5).stores({
  proposals: "id, status, category, createdAt",
});
