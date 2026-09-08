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
  llmApiEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  // フォールバックプロバイダ（issue #18/#21: プライマリ失敗時のみ使用）。空なら無効
  llmFallbackApiEndpoint: string;
  llmFallbackModel: string;
  llmFallbackApiKey: string;
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

  // LLM生成クイズ (issue #15)
  saveGeneratedQuiz(set: GeneratedQuizSet): Promise<void>;
  listGeneratedQuizzes(
    deckId: string,
    lessonId: string,
    limit?: number,
  ): Promise<GeneratedQuizSet[]>;
  deleteGeneratedQuiz(id: string): Promise<void>;

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

/** LLM生成クイズの保存単位 (issue #15) */
export type GeneratedQuizSource = "llm-supplement" | "llm-wrong-focus";

export interface GeneratedQuizSet {
  /** batchId（quizId のプレフィックスにもなる一意ID） */
  id: string;
  deckId: string;
  lessonId: string;
  source: GeneratedQuizSource;
  /** 対象となった wordId のリスト */
  words: string[];
  /** deck.quizSchema 検証済みの Quiz（4択・choiceId は c0..c3） */
  quizzes: import("../content/schema").Quiz[];
  /** 検証ですてられた問題数 */
  rejected: number;
  generatedAt: string;
  model: string;
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoalWords: 10,
  soundEnabled: true,
  dataVersion: 1,
  llmApiEndpoint: "http://localhost:11434/v1",
  llmModel: "deepseek-v4-flash",
  llmApiKey: "",
  llmFallbackApiEndpoint: "",
  llmFallbackModel: "",
  llmFallbackApiKey: "",
};

export function progressKey(deckId: string, wordId: string): string {
  return `${deckId}/${wordId}`;
}
