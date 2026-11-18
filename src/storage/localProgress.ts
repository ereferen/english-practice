import type {
  LearnedWordEntry,
  ProgressSnapshot,
  QuizResult,
  SessionSummary,
} from "../app/types";

export const LOCAL_PROGRESS_KEY = "app:progress:v1";
export const LOCAL_QUIZ_RESULTS_KEY = "app:quiz-results:v1";

export interface LocalProgressStore {
  load(): ProgressSnapshot;
  save(snapshot: ProgressSnapshot): void;
  clear(): void;
  markLearned(entry: LearnedWordEntry): ProgressSnapshot;
  recordSession(summary: SessionSummary): ProgressSnapshot;
  saveQuizResults(
    deckId: string,
    lessonId: string,
    results: QuizResult[],
  ): void;
  loadQuizResults(deckId: string, lessonId: string): QuizResult[] | null;
  /**
   * Issue #282: デッキ削除のときに、そのデッキの学習記録を localStorage からも消す。
   * 手動追加デッキの deckId は固定（"manual-words"）なので、消さずに作り直すと
   * 前のデッキの学習済み語がそのまま学習率に乗ってしまう。
   * lessonIds を渡すと、その組み合わせの小テスト結果も一緒に消す。
   */
  forgetDeck(deckId: string, lessonIds?: readonly string[]): ProgressSnapshot;
  /** Issue #282: 語を1語消したときに、その語の学習記録を消す（同じ語を入れ直しても復活しない）。 */
  forgetWord(deckId: string, wordId: string): ProgressSnapshot;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeDefaultSnapshot(): ProgressSnapshot {
  return {
    learnedWords: [],
    sessions: [],
    version: 1,
  };
}

export function parseProgressSnapshot(raw: unknown): ProgressSnapshot {
  if (raw === null || raw === undefined) {
    return makeDefaultSnapshot();
  }
  if (typeof raw !== "object") {
    return makeDefaultSnapshot();
  }
  const obj = raw as Record<string, unknown>;

  const learnedWords = Array.isArray(obj.learnedWords)
    ? obj.learnedWords.filter(isLearnedWordEntry)
    : [];
  const sessions = Array.isArray(obj.sessions)
    ? obj.sessions.filter(isSessionSummary)
    : [];
  const version = typeof obj.version === "number" ? obj.version : 1;

  return { learnedWords, sessions, version };
}

function isLearnedWordEntry(value: unknown): value is LearnedWordEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deckId === "string" &&
    typeof v.wordId === "string" &&
    typeof v.learnedAt === "string" &&
    !Number.isNaN(Date.parse(v.learnedAt))
  );
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.askedCount === "number" &&
    typeof v.correctCount === "number" &&
    typeof v.answeredAt === "string" &&
    !Number.isNaN(Date.parse(v.answeredAt)) &&
    v.askedCount >= 0 &&
    v.correctCount >= 0 &&
    v.correctCount <= v.askedCount
  );
}

function quizResultsKey(deckId: string, lessonId: string): string {
  return `${LOCAL_QUIZ_RESULTS_KEY}:${deckId}:${lessonId}`;
}

export function createLocalProgressStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): LocalProgressStore {
  function load(): ProgressSnapshot {
    try {
      const raw = storage.getItem(LOCAL_PROGRESS_KEY);
      if (raw === null) {
        return makeDefaultSnapshot();
      }
      return parseProgressSnapshot(JSON.parse(raw));
    } catch {
      return makeDefaultSnapshot();
    }
  }

  function save(snapshot: ProgressSnapshot): void {
    try {
      storage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(snapshot));
    } catch {
      // localStorage may be unavailable or full; ignore writes gracefully.
    }
  }

  return {
    load,
    save,
    clear() {
      storage.removeItem(LOCAL_PROGRESS_KEY);
    },
    markLearned(entry) {
      const snapshot = load();
      const index = snapshot.learnedWords.findIndex(
        (w) => w.deckId === entry.deckId && w.wordId === entry.wordId,
      );
      const learnedAt = entry.learnedAt ?? nowIso();
      if (index >= 0) {
        snapshot.learnedWords[index] = {
          ...snapshot.learnedWords[index],
          learnedAt,
        };
      } else {
        snapshot.learnedWords.push({ ...entry, learnedAt });
      }
      save(snapshot);
      return snapshot;
    },
    recordSession(summary) {
      const snapshot = load();
      const askedCount = Math.max(0, Math.floor(summary.askedCount));
      const correctCount = Math.max(
        0,
        Math.min(askedCount, Math.floor(summary.correctCount)),
      );
      snapshot.sessions.push({
        askedCount,
        correctCount,
        answeredAt: summary.answeredAt ?? nowIso(),
        // Issue #267: ベスト比較をデッキ単位で行えるように帰属を残す。
        ...(summary.deckId ? { deckId: summary.deckId } : {}),
      });
      save(snapshot);
      return snapshot;
    },
    forgetDeck(deckId, lessonIds = []) {
      const snapshot = load();
      const next: ProgressSnapshot = {
        ...snapshot,
        learnedWords: snapshot.learnedWords.filter((w) => w.deckId !== deckId),
        sessions: snapshot.sessions.filter((s) => s.deckId !== deckId),
      };
      save(next);
      for (const lessonId of lessonIds) {
        try {
          storage.removeItem(quizResultsKey(deckId, lessonId));
        } catch {
          // 消せなくても致命傷ではない（次回の保存で上書きされる）。
        }
      }
      return next;
    },
    forgetWord(deckId, wordId) {
      const snapshot = load();
      const next: ProgressSnapshot = {
        ...snapshot,
        learnedWords: snapshot.learnedWords.filter(
          (w) => !(w.deckId === deckId && w.wordId === wordId),
        ),
      };
      save(next);
      return next;
    },
    saveQuizResults(deckId, lessonId, results) {
      try {
        storage.setItem(
          quizResultsKey(deckId, lessonId),
          JSON.stringify(results),
        );
      } catch {
        // localStorage may be unavailable or full; ignore gracefully.
      }
    },
    loadQuizResults(deckId, lessonId) {
      try {
        const raw = storage.getItem(quizResultsKey(deckId, lessonId));
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter(isQuizResult);
      } catch {
        return null;
      }
    },
  };
}

function isQuizResult(value: unknown): value is QuizResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.quizId === "string" &&
    typeof v.wordId === "string" &&
    typeof v.correct === "boolean"
  );
}

export const localProgress = createLocalProgressStore();
