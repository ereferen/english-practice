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
  // issue #17: SRSパラメータ最適化（LLM提案→ユーザー承認で適用）
  srsParams: SrsParams;
}

/**
 * issue #17: SRS（間隔反復）のパラメータ。デフォルトは従来の固定挙動と一致。
 * loadSettings() の DEFAULT_SETTINGS スプレッドで既存行にも補完されるため
 * IndexedDB スキーマ変更は不要（破壊的マイグレーションなし）。
 */
export interface SrsParams {
  /** level n 正答後の復習間隔（日）。index=level 0..3 */
  intervalDays: [number, number, number, number];
  /** level 3 で誤答した際の降格先（level<=2 の誤答は従来どおり level 0） */
  level3WrongDemotesTo: 0 | 1 | 2;
}

/** issue #17: 従来の固定挙動（level2=翌日 / level3=4日後 / level3誤答はlevel1へ） */
export const DEFAULT_SRS_PARAMS: SrsParams = {
  intervalDays: [0, 0, 1, 4],
  level3WrongDemotesTo: 1,
};

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
  /** 弱点分析 (issue #16): 指定日付以降の AnswerEvent を全部返す */
  listAnswersSince(date: string): Promise<AnswerEvent[]>;

  // LLM生成クイズ (issue #15)
  saveGeneratedQuiz(set: GeneratedQuizSet): Promise<void>;
  listGeneratedQuizzes(
    deckId: string,
    lessonId: string,
    limit?: number,
  ): Promise<GeneratedQuizSet[]>;
  deleteGeneratedQuiz(id: string): Promise<void>;

  // ユーザーデッキ（会話抽出の承認保存、issue #19）
  saveUserDeck(record: UserDeckRecord): Promise<void>;
  listUserDecks(): Promise<UserDeckRecord[]>;
  deleteUserDeck(deckId: string): Promise<void>;

  // 改善アクション履歴（issue #20: 承認→適用→ロールバックの監査ログ）
  saveImprovementAction(record: ImprovementAction): Promise<void>;
  listImprovementActions(limit?: number): Promise<ImprovementAction[]>;

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

/**
 * issue #19: 会話ログ抽出から承認後に保存するユーザーデッキ。
 * deck は content/schema の deckSchema 検証済み（source: "conversation"）。
 */
export interface UserDeckRecord {
  deckId: string;
  deck: import("../content/schema").Deck;
  /** 抽出元の会話ログターン数（UI の出所表示用） */
  sourceTurns: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * issue #20: Self-Improve の「適用」履歴（承認フローの監査ログ）。
 * LLM 提案をユーザー承認して適用した記録だけを保存する。
 * previous を保持することで特定提案のロールバックを可能にする。
 * ※ 追加テーブルのみで既存データへの移行は不要（db.version(4)）。
 */
export type ImprovementCategory = "srs-params";

export interface ImprovementAction {
  /** uuid */
  id: string;
  category: ImprovementCategory;
  /** 提案時の根拠文（LLM rationale or 人手入力のメモ） */
  rationale: string;
  /** 提案を出したモデル/プロバイダ名。人手適用なら "manual" */
  model: string;
  /** 適用日時 ISO */
  appliedAt: string;
  /** 適用後のパラメータスナップショット */
  applied: SrsParams;
  /** 適用前のパラメータスナップショット（ロールバック先） */
  previous: SrsParams;
  /** ロールバック済みならその日時 ISO */
  rolledBackAt: string | null;
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
  srsParams: DEFAULT_SRS_PARAMS,
};

export function progressKey(deckId: string, wordId: string): string {
  return `${deckId}/${wordId}`;
}
