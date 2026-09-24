import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AppState } from "../app/types";
import type { StorageProvider } from "../storage/types";
import type { LocalProgressStore } from "../storage/localProgress";
import type { AnswerRecord } from "../domain/session";
import ResultScreen from "./ResultScreen";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorageMock(): StorageProvider {
  const noop = vi.fn(async () => undefined);
  return {
    loadSettings: vi.fn(async () => ({ llmProviders: [] })),
    saveSettings: noop,
    loadReview: vi.fn(async () => undefined),
    saveReview: noop,
    loadDueReviews: vi.fn(async () => []),
    loadWeakWords: vi.fn(async () => []),
    startSession: noop,
    endSession: noop,
    listSessions: vi.fn(async () => []),
    recordAnswer: noop,
    countAnswersSince: vi.fn(async () => 0),
    listAnswersSince: vi.fn(async () => []),
    saveGeneratedQuiz: noop,
    listGeneratedQuizzes: vi.fn(async () => []),
    deleteGeneratedQuiz: noop,
    saveUserDeck: noop,
    listUserDecks: vi.fn(async () => []),
    deleteUserDeck: noop,
    saveImprovementAction: noop,
    listImprovementActions: vi.fn(async () => []),
  } as unknown as StorageProvider;
}

function makeProgress(
  sessions: Array<{ askedCount: number; correctCount: number }>,
): LocalProgressStore {
  return {
    load: vi.fn(() => ({
      learnedWords: [],
      sessions: sessions.map((s) => ({
        ...s,
        answeredAt: "2026-09-01T00:00:00Z",
      })),
      version: 1,
    })),
    save: vi.fn(),
    clear: vi.fn(),
    markLearned: vi.fn(),
    recordSession: vi.fn(),
    saveQuizResults: vi.fn(),
    loadQuizResults: vi.fn(() => null),
  };
}

function answers(correct: boolean[], latencyMs = 1000): AnswerRecord[] {
  return correct.map((c, i) => ({
    quizId: `q${i}`,
    wordId: `w${i}`,
    choiceId: `c${i}`,
    correct: c,
    latencyMs,
  }));
}

const deck = {
  $schema: "",
  schemaVersion: "1.0" as const,
  deckId: "test-deck",
  level: "beginner" as const,
  title: "Test Deck",
  lessons: [
    {
      lessonId: "lesson-1",
      title: "Lesson 1",
      words: [
        {
          wordId: "w0",
          term: "apple",
          reading: "アップル",
          meaning: "りんご",
          partOfSpeech: "noun",
          examples: [{ en: "An apple.", ja: "りんごです。" }],
        },
      ],
      quizzes: [],
    },
  ],
};

function makeState(): AppState {
  return {
    screen: {
      name: "result",
      deckId: "test-deck",
      lessonId: "lesson-1",
      answers: [],
    },
    decks: [deck],
    selectedDeckId: "test-deck",
  } as unknown as AppState;
}

function renderResult(
  a: AnswerRecord[],
  sessions: Array<{ askedCount: number; correctCount: number }>,
) {
  const progress = makeProgress(sessions);
  render(
    <ResultScreen
      state={makeState()}
      dispatch={vi.fn()}
      storage={makeStorageMock()}
      deckId="test-deck"
      lessonId="lesson-1"
      answers={a}
      progress={progress}
    />,
  );
  return progress;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResultScreen (#96 celebration)", () => {
  it("counts the score up to the final percentage", async () => {
    renderResult(answers([true, true, true]), []);
    // reduced-motion is false in jsdom → animation runs; wait for the end
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy(), {
      timeout: 2000,
    });
  });

  it("shows the NEW RECORD badge when the previous best is beaten", async () => {
    renderResult(answers([true, true]), [{ askedCount: 2, correctCount: 1 }]);
    expect(await screen.findByText("NEW RECORD")).toBeTruthy();
  });

  it("does NOT show the badge with no previous sessions", async () => {
    renderResult(answers([true, true]), []);
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy(), {
      timeout: 2000,
    });
    expect(screen.queryByText("NEW RECORD")).toBeNull();
  });

  it("does NOT show the badge when the record is merely matched", async () => {
    renderResult(answers([true, true]), [{ askedCount: 2, correctCount: 2 }]);
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy(), {
      timeout: 2000,
    });
    expect(screen.queryByText("NEW RECORD")).toBeNull();
  });

  it("never double-starts the count when the record state settles", async () => {
    // regression guard for the acceptance criterion: the displayed value
    // must move monotonically toward the target (two racing rAF chains
    // would visibly jump back down)
    renderResult(answers([true, true, true, false]), []);
    const seen: number[] = [];
    const iv = setInterval(() => {
      const n = parseInt(
        (document.querySelector(".result-rate")?.textContent ?? "0").replace(
          /\D/g,
          "",
        ),
        10,
      );
      if (!Number.isNaN(n)) seen.push(n);
    }, 20);
    await waitFor(
      () =>
        expect(document.querySelector(".result-rate")?.textContent).toBe("75%"),
      { timeout: 2000 },
    );
    clearInterval(iv);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Issue #131: 誤答語の ▶ が無反応だった（TTS未対応の案内が出ない）
// ---------------------------------------------------------------------------

const VOICE = {} as unknown as SpeechSynthesisVoice;

function stubVoices(voices: SpeechSynthesisVoice[]) {
  const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: {
      getVoices: () => voices,
      speak: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  return () => {
    if (original) Object.defineProperty(window, "speechSynthesis", original);
    else Reflect.deleteProperty(window, "speechSynthesis");
  };
}

describe("ResultScreen (#131 wrong-word TTS feedback)", () => {
  it("no-voices環境では案内を出し、ボタンを 🔇 にする", () => {
    const restore = stubVoices([]);
    try {
      renderResult(answers([false]), []);
      expect(
        screen.getAllByText(
          "このブラウザは音声未対応です（TTSボイスがありません）",
        ).length,
      ).toBeGreaterThan(0);
      const btn = screen.getByLabelText("apple の発音を再生");
      expect(btn.textContent).toContain("🔇");
    } finally {
      // unmount while the stub is still installed: the hook removes its
      // voiceschanged listener on cleanup
      cleanup();
      restore();
    }
  });

  it("ボイスがあれば ▶ を出し、案内は出さない", async () => {
    const restore = stubVoices([VOICE]);
    try {
      renderResult(answers([false]), []);
      const btn = await screen.findByLabelText("apple の発音を再生");
      expect(btn.textContent).toContain("▶");
      expect(
        screen.queryByText(
          "このブラウザは音声未対応です（TTSボイスがありません）",
        ),
      ).toBeNull();
    } finally {
      cleanup();
      restore();
    }
  });
});
