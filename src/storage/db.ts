import Dexie, { type EntityTable } from "dexie";
import type {
  AnswerEvent,
  ReviewState,
  SessionRecord,
  Settings,
} from "./types";

export interface DexieSchema {
  settings: EntityTable<Settings & { id: number }, "id">;
  review: EntityTable<ReviewState, "wordId">;
  sessions: EntityTable<SessionRecord, "id">;
  answers: EntityTable<AnswerEvent, "id">;
}

export const db = new Dexie("EnglishPracticeDB") as Dexie & DexieSchema;

db.version(1).stores({
  settings: "++id",
  review: "[deckId+wordId], deckId, dueAt, level",
  sessions: "id, deckId, startedAt",
  answers: "id, sessionId, wordId, [sessionId+wordId]",
});
