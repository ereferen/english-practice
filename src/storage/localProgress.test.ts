import { describe, expect, it } from "vitest";
import {
  createLocalProgressStore,
  LOCAL_PROGRESS_KEY,
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

describe("parseProgressSnapshot", () => {
  it("returns defaults for null/undefined", () => {
    expect(parseProgressSnapshot(null)).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
    expect(parseProgressSnapshot(undefined)).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("returns defaults for invalid JSON shapes", () => {
    expect(parseProgressSnapshot("not an object")).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
    expect(parseProgressSnapshot({})).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("filters malformed entries but keeps valid ones", () => {
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
    expect(parsed.learnedWords[0].wordId).toBe("w1");
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].askedCount).toBe(5);
    expect(parsed.version).toBe(2);
  });

  it("falls back to defaults on invalid version", () => {
    const parsed = parseProgressSnapshot({
      learnedWords: [],
      sessions: [],
      version: "foo",
    });
    expect(parsed.version).toBe(1);
  });
});

describe("createLocalProgressStore", () => {
  it("uses the configured key namespace", () => {
    const storage = makeMemoryStorage();
    const store = createLocalProgressStore(storage);
    store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-06T10:00:00Z",
    });
    expect(storage.getItem(LOCAL_PROGRESS_KEY)).toBeTruthy();
  });

  it("loads an empty snapshot when nothing is stored", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    expect(store.load()).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("marks a word as learned", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    const snapshot = store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-06T10:00:00Z",
    });
    expect(snapshot.learnedWords).toHaveLength(1);
    expect(snapshot.learnedWords[0]).toEqual({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-06T10:00:00Z",
    });
  });

  it("updates learnedAt when marking the same word again", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-05T10:00:00Z",
    });
    const snapshot = store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-06T12:00:00Z",
    });
    expect(snapshot.learnedWords).toHaveLength(1);
    expect(snapshot.learnedWords[0].learnedAt).toBe("2026-09-06T12:00:00Z");
  });

  it("records a session", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    const snapshot = store.recordSession({
      askedCount: 10,
      correctCount: 7,
      answeredAt: "2026-09-06T10:00:00Z",
    });
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].askedCount).toBe(10);
    expect(snapshot.sessions[0].correctCount).toBe(7);
  });

  it("normalizes invalid session counts", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    const snapshot = store.recordSession({
      askedCount: -3,
      correctCount: 99,
      answeredAt: "2026-09-06T10:00:00Z",
    });
    expect(snapshot.sessions[0].askedCount).toBe(0);
    expect(snapshot.sessions[0].correctCount).toBe(0);
  });

  it("clears stored progress", () => {
    const storage = makeMemoryStorage();
    const store = createLocalProgressStore(storage);
    store.markLearned({
      deckId: "d1",
      wordId: "w1",
      learnedAt: "2026-09-06T10:00:00Z",
    });
    store.clear();
    expect(storage.getItem(LOCAL_PROGRESS_KEY)).toBeNull();
    expect(store.load()).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("falls back to defaults when stored JSON is corrupted", () => {
    const storage = makeMemoryStorage();
    storage.setItem(LOCAL_PROGRESS_KEY, "{not valid json");
    const store = createLocalProgressStore(storage);
    expect(store.load()).toEqual({
      learnedWords: [],
      sessions: [],
      version: 1,
    });
  });

  it("persists across store instances", () => {
    const storage = makeMemoryStorage();
    const first = createLocalProgressStore(storage);
    first.recordSession({
      askedCount: 3,
      correctCount: 2,
      answeredAt: "2026-09-06T10:00:00Z",
    });

    const second = createLocalProgressStore(storage);
    expect(second.load().sessions).toHaveLength(1);
  });
});

describe("saveQuizResults / loadQuizResults", () => {
  it("saves and loads quiz results for a deck/lesson pair", () => {
    const storage = makeMemoryStorage();
    const store = createLocalProgressStore(storage);
    const results = [
      { quizId: "q1", wordId: "w1", correct: true },
      { quizId: "q2", wordId: "w2", correct: false },
    ];

    store.saveQuizResults("deck-a", "lesson-1", results);

    const loaded = store.loadQuizResults("deck-a", "lesson-1");
    expect(loaded).toEqual(results);
  });

  it("stores under the correct localStorage key", () => {
    const storage = makeMemoryStorage();
    const store = createLocalProgressStore(storage);
    const results = [{ quizId: "q1", wordId: "w1", correct: true }];

    store.saveQuizResults("deck-a", "lesson-1", results);

    const raw = storage.getItem(`${LOCAL_QUIZ_RESULTS_KEY}:deck-a:lesson-1`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(results);
  });

  it("loadQuizResults returns null for unknown pair", () => {
    const store = createLocalProgressStore(makeMemoryStorage());
    expect(store.loadQuizResults("deck-a", "lesson-1")).toBeNull();
  });

  it("loadQuizResults returns null for corrupted data", () => {
    const storage = makeMemoryStorage();
    storage.setItem(`${LOCAL_QUIZ_RESULTS_KEY}:deck-a:lesson-1`, "{bad json");
    const store = createLocalProgressStore(storage);
    expect(store.loadQuizResults("deck-a", "lesson-1")).toBeNull();
  });

  it("loadQuizResults filters out malformed entries", () => {
    const storage = makeMemoryStorage();
    const store = createLocalProgressStore(storage);
    storage.setItem(
      `${LOCAL_QUIZ_RESULTS_KEY}:deck-a:lesson-1`,
      JSON.stringify([
        { quizId: "q1", wordId: "w1", correct: true },
        { quizId: "q2", wordId: "w2" }, // missing correct
        { wordId: "w3", correct: false }, // missing quizId
        "not an object",
      ]),
    );

    const loaded = store.loadQuizResults("deck-a", "lesson-1");
    expect(loaded).toHaveLength(1);
    expect(loaded![0]).toEqual({ quizId: "q1", wordId: "w1", correct: true });
  });

  it("persists across store instances", () => {
    const storage = makeMemoryStorage();
    const first = createLocalProgressStore(storage);
    first.saveQuizResults("deck-a", "lesson-1", [
      { quizId: "q1", wordId: "w1", correct: true },
    ]);

    const second = createLocalProgressStore(storage);
    const loaded = second.loadQuizResults("deck-a", "lesson-1");
    expect(loaded).toHaveLength(1);
  });

  it("disjoint keyspaces: results for different pairs do not collide", () => {
    const storage = makeMemoryStorage();
    const store = createLocalProgressStore(storage);
    store.saveQuizResults("deck-a", "lesson-1", [
      { quizId: "q1", wordId: "w1", correct: true },
    ]);
    store.saveQuizResults("deck-b", "lesson-2", [
      { quizId: "q2", wordId: "w2", correct: false },
    ]);

    expect(store.loadQuizResults("deck-a", "lesson-1")).toHaveLength(1);
    expect(store.loadQuizResults("deck-b", "lesson-2")).toHaveLength(1);
    expect(store.loadQuizResults("deck-a", "lesson-2")).toBeNull();
    expect(store.loadQuizResults("deck-b", "lesson-1")).toBeNull();
  });
});
