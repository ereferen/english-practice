import { describe, expect, it } from "vitest";
import {
  createLocalProgressStore,
  LOCAL_QUIZ_RESULTS_KEY,
  parseProgressSnapshot,
} from "./localProgress";

function makeMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  };
}

describe("parseProgressSnapshot edge cases", () => {
  it("returns defaults for non-object values", () => {
    expect(parseProgressSnapshot("string")).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
    expect(parseProgressSnapshot(123)).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("preserves valid entries while filtering malformed ones", () => {
    const raw = {
      learnedWords: [
        { deckId: "d1", wordId: "w1", learnedAt: "2026-09-06T10:00:00Z" },
        { deckId: "d1", wordId: "w2", learnedAt: "not-a-date" },
        { wordId: "w3", learnedAt: "2026-09-06T10:00:00Z" },
      ],
      sessions: [
        { askedCount: 5, correctCount: 3, answeredAt: "2026-09-06T10:00:00Z" },
        { askedCount: -1, correctCount: 0, answeredAt: "2026-09-06T10:00:00Z" },
        { askedCount: 5, correctCount: 6, answeredAt: "2026-09-06T10:00:00Z" },
        { askedCount: 2, correctCount: 1, answeredAt: "invalid" },
      ],
      version: 2,
    };
    const parsed = parseProgressSnapshot(raw);
    expect(parsed.learnedWords).toHaveLength(1);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.version).toBe(2);
  });
});

describe("createLocalProgressStore edge cases", () => {
  it("handles storage quota errors gracefully on save", () => {
    const storage = makeMemoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createLocalProgressStore(storage);
    expect(() =>
      store.markLearned({
        deckId: "d1",
        wordId: "w1",
        learnedAt: "2026-09-06T10:00:00Z",
      }),
    ).not.toThrow();
  });

  it("handles storage errors gracefully on load", () => {
    const storage = makeMemoryStorage();
    storage.getItem = () => {
      throw new Error("SecurityError");
    };
    const store = createLocalProgressStore(storage);
    expect(store.load()).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("does not alter learned words list when marking same word", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-06T10:00:00Z",
    });
    store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-07T10:00:00Z",
    });
    const snapshot = store.load();
    expect(snapshot.learnedWords).toHaveLength(1);
  });

  it("normalizes fractional and negative session counts", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    const snapshot = store.recordSession({
      askedCount: 5.7,
      correctCount: 3.2,
      answeredAt: "2026-09-06T10:00:00Z",
    });
    expect(snapshot.sessions[0].askedCount).toBe(5);
    expect(snapshot.sessions[0].correctCount).toBe(3);
  });
});

describe("saveQuizResults / loadQuizResults edge cases", () => {
  it("returns null for non-JSON string", () => {
    const storage = makeMemoryStorage();
    storage.setItem(`${LOCAL_QUIZ_RESULTS_KEY}:deck:lesson`, "not-json");
    const store = createLocalProgressStore(storage);
    expect(store.loadQuizResults("deck", "lesson")).toBeNull();
  });

  it("returns null for non-array JSON", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      `${LOCAL_QUIZ_RESULTS_KEY}:deck:lesson`,
      JSON.stringify({ foo: "bar" }),
    );
    const store = createLocalProgressStore(storage);
    expect(store.loadQuizResults("deck", "lesson")).toBeNull();
  });

  it("returns empty array when all entries are malformed", () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      `${LOCAL_QUIZ_RESULTS_KEY}:deck:lesson`,
      JSON.stringify(["not-an-object", { wordId: "w1" }]),
    );
    const store = createLocalProgressStore(storage);
    expect(store.loadQuizResults("deck", "lesson")).toEqual([]);
  });

  it("handles storage errors gracefully on saveQuizResults", () => {
    const storage = makeMemoryStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createLocalProgressStore(storage);
    expect(() =>
      store.saveQuizResults("deck", "lesson", [
        { quizId: "q1", wordId: "w1", correct: true },
      ]),
    ).not.toThrow();
  });
});
