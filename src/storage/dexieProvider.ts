import { db } from "./db";
import type {
  AnswerEvent,
  ReviewState,
  SessionRecord,
  Settings,
  StorageProvider,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

export class DexieStorageProvider implements StorageProvider {
  async loadSettings(): Promise<Settings> {
    const row = await db.settings.get(1);
    return row ? (row as Settings) : DEFAULT_SETTINGS;
  }

  async saveSettings(settings: Partial<Settings>): Promise<void> {
    const current = await this.loadSettings();
    await db.settings.put({ ...current, ...settings, id: 1 } as Settings & {
      id: number;
    });
  }

  async loadReview(
    deckId: string,
    wordId: string,
  ): Promise<ReviewState | undefined> {
    return db.review.where({ deckId, wordId }).first();
  }

  async saveReview(state: ReviewState): Promise<void> {
    await db.review.put(state);
  }

  async loadDueReviews(
    deckId: string | null,
    today: string,
  ): Promise<ReviewState[]> {
    let col = db.review.where("dueAt").belowOrEqual(today);
    if (deckId) {
      const all = await col.toArray();
      return all.filter((r) => r.deckId === deckId);
    }
    return col.toArray();
  }

  async loadWeakWords(limit = 50): Promise<ReviewState[]> {
    return db.review.where("wrongTotal").aboveOrEqual(2).limit(limit).toArray();
  }

  async startSession(record: SessionRecord): Promise<void> {
    await db.sessions.add(record);
  }

  async endSession(
    sessionId: string,
    endedAt: string,
    scoreRate: number,
  ): Promise<void> {
    await db.sessions.update(sessionId, { endedAt, scoreRate });
  }

  async listSessions(limit = 100): Promise<SessionRecord[]> {
    return db.sessions.orderBy("startedAt").reverse().limit(limit).toArray();
  }

  async recordAnswer(event: AnswerEvent): Promise<void> {
    await db.answers.add(event);
  }

  async countAnswersSince(date: string): Promise<number> {
    return db.answers.where("askedAt").aboveOrEqual(date).count();
  }

  async exportAll(): Promise<unknown> {
    return {
      settings: await db.settings.toArray(),
      review: await db.review.toArray(),
      sessions: await db.sessions.toArray(),
      answers: await db.answers.toArray(),
    };
  }

  async importAll(data: unknown): Promise<void> {
    const payload = data as {
      settings?: (Settings & { id: number })[];
      review?: ReviewState[];
      sessions?: SessionRecord[];
      answers?: AnswerEvent[];
    };
    await db.transaction(
      "rw",
      db.settings,
      db.review,
      db.sessions,
      db.answers,
      async () => {
        await db.settings.clear();
        await db.review.clear();
        await db.sessions.clear();
        await db.answers.clear();
        if (payload.settings?.length)
          await db.settings.bulkAdd(payload.settings);
        if (payload.review?.length) await db.review.bulkAdd(payload.review);
        if (payload.sessions?.length)
          await db.sessions.bulkAdd(payload.sessions);
        if (payload.answers?.length) await db.answers.bulkAdd(payload.answers);
      },
    );
  }

  async clearAll(): Promise<void> {
    await db.delete();
  }
}

export const storage = new DexieStorageProvider();
