import { db } from "./db";
import type {
  AnswerEvent,
  GeneratedQuizSet,
  ImprovementAction,
  ProposalRecord,
  ProposalStatus,
  ReviewState,
  SessionRecord,
  Settings,
  StorageProvider,
  UserDeckRecord,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

export class DexieStorageProvider implements StorageProvider {
  async loadSettings(): Promise<Settings> {
    const row = await db.settings.get(1);
    // 既存行に後から追加したキー（フォールバック設定など）が無い場合は
    // デフォルトで補完する
    return row
      ? { ...DEFAULT_SETTINGS, ...(row as Settings) }
      : DEFAULT_SETTINGS;
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

  async listAnswersSince(date: string): Promise<AnswerEvent[]> {
    return db.answers.where("askedAt").aboveOrEqual(date).toArray();
  }

  async saveGeneratedQuiz(set: GeneratedQuizSet): Promise<void> {
    await db.generatedQuizzes.put(set);
  }

  async listGeneratedQuizzes(
    deckId: string,
    lessonId: string,
    limit = 20,
  ): Promise<GeneratedQuizSet[]> {
    return db.generatedQuizzes
      .where("[deckId+lessonId]")
      .equals([deckId, lessonId])
      .reverse()
      .sortBy("generatedAt")
      .then((rows) => rows.slice(0, limit));
  }

  async deleteGeneratedQuiz(id: string): Promise<void> {
    await db.generatedQuizzes.delete(id);
  }

  // issue #19: 会話抽出ユーザーデッキ
  async saveUserDeck(record: UserDeckRecord): Promise<void> {
    await db.userDecks.put(record);
  }

  async listUserDecks(): Promise<UserDeckRecord[]> {
    return db.userDecks.toArray();
  }

  async deleteUserDeck(deckId: string): Promise<void> {
    await db.userDecks.delete(deckId);
    // 抽出デッキの復習状態も併せて削除（ロールバック相当）
    await db.review.where("deckId").equals(deckId).delete();
  }

  // issue #20: 改善アクション履歴（承認→適用→ロールバックの監査ログ）
  async saveImprovementAction(record: ImprovementAction): Promise<void> {
    await db.improvementActions.put(record);
  }

  async listImprovementActions(limit = 50): Promise<ImprovementAction[]> {
    return db.improvementActions
      .orderBy("appliedAt")
      .reverse()
      .limit(limit)
      .toArray();
  }

  // issue #20: 未承認の改善提案（提案レビュー画面・Homeバッジ）
  async saveProposal(record: ProposalRecord): Promise<void> {
    await db.proposals.put(record);
  }

  async listProposals(status?: ProposalStatus): Promise<ProposalRecord[]> {
    const base = status
      ? db.proposals.where("status").equals(status)
      : db.proposals.toCollection();
    const rows = await base.sortBy("createdAt");
    return rows.reverse();
  }

  async exportAll(): Promise<unknown> {
    return {
      settings: await db.settings.toArray(),
      review: await db.review.toArray(),
      sessions: await db.sessions.toArray(),
      answers: await db.answers.toArray(),
      generatedQuizzes: await db.generatedQuizzes.toArray(),
      userDecks: await db.userDecks.toArray(),
      improvementActions: await db.improvementActions.toArray(),
      proposals: await db.proposals.toArray(),
    };
  }

  async importAll(data: unknown): Promise<void> {
    const payload = data as {
      settings?: (Settings & { id: number })[];
      review?: ReviewState[];
      sessions?: SessionRecord[];
      answers?: AnswerEvent[];
      generatedQuizzes?: GeneratedQuizSet[];
      userDecks?: UserDeckRecord[];
      improvementActions?: ImprovementAction[];
      proposals?: ProposalRecord[];
    };
    await db.transaction(
      "rw",
      [
        db.settings,
        db.review,
        db.sessions,
        db.answers,
        db.generatedQuizzes,
        db.userDecks,
        db.improvementActions,
        db.proposals,
      ],
      async () => {
        await db.settings.clear();
        await db.review.clear();
        await db.sessions.clear();
        await db.answers.clear();
        await db.generatedQuizzes.clear();
        await db.userDecks.clear();
        await db.improvementActions.clear();
        await db.proposals.clear();
        if (payload.settings?.length)
          await db.settings.bulkAdd(payload.settings);
        if (payload.review?.length) await db.review.bulkAdd(payload.review);
        if (payload.sessions?.length)
          await db.sessions.bulkAdd(payload.sessions);
        if (payload.answers?.length) await db.answers.bulkAdd(payload.answers);
        if (payload.generatedQuizzes?.length)
          await db.generatedQuizzes.bulkAdd(payload.generatedQuizzes);
        if (payload.userDecks?.length)
          await db.userDecks.bulkAdd(payload.userDecks);
        if (payload.improvementActions?.length)
          await db.improvementActions.bulkAdd(payload.improvementActions);
        if (payload.proposals?.length)
          await db.proposals.bulkAdd(payload.proposals);
      },
    );
  }

  async clearAll(): Promise<void> {
    await db.delete();
  }
}

export const storage = new DexieStorageProvider();
