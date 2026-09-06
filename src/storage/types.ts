export interface ReviewState {
  deckId: string;
  wordId: string;
  level: 0 | 1 | 2 | 3;
  lastResult: "correct" | "wrong" | null;
  lastSeenAt: string | null;
  dueAt: string | null;
  correctStreak: number;
  wrongTotal: number;
}

export interface SessionRecord {
  id: string;
  deckId: string;
  lessonId: string;
  startedAt: string;
  endedAt: string | null;
  kind: "learn" | "quiz" | "review";
  scoreRate: number | null;
}

export interface AnswerEvent {
  id: string;
  sessionId: string;
  wordId: string;
  askedAt: string;
  correct: boolean;
  latencyMs: number;
}

export interface Settings {
  dailyGoalWords: number;
  soundEnabled: boolean;
  dataVersion: number;
}

export interface StorageProvider {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<void>;

  loadReview(deckId: string, wordId: string): Promise<ReviewState | undefined>;
  saveReview(state: ReviewState): Promise<void>;
  loadDueReviews(deckId: string | null, today: string): Promise<ReviewState[]>;
  loadWeakWords(limit?: number): Promise<ReviewState[]>;

  startSession(record: SessionRecord): Promise<void>;
  endSession(
    sessionId: string,
    endedAt: string,
    scoreRate: number,
  ): Promise<void>;
  listSessions(limit?: number): Promise<SessionRecord[]>;

  recordAnswer(event: AnswerEvent): Promise<void>;
  countAnswersSince(date: string): Promise<number>;

  exportAll(): Promise<unknown>;
  importAll(data: unknown): Promise<void>;
  clearAll(): Promise<void>;
}

export interface UserDeckMeta {
  id: string;
  source: "bundled" | "import";
  title: string;
  level: string;
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoalWords: 10,
  soundEnabled: true,
  dataVersion: 1,
};

export function progressKey(deckId: string, wordId: string): string {
  return `${deckId}/${wordId}`;
}
