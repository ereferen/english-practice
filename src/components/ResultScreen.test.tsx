import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../app/types";
import type { StorageProvider } from "../storage/types";
import type { LocalProgressStore } from "../storage/localProgress";
import type { AnswerRecord } from "../domain/session";
import { isAbortedSession } from "../domain/session";
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
          ipa: "/ˈæp.əl/",
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

// ---------------------------------------------------------------------------
// Issue #232: 0 点で完走したセッションが中断扱いで消える
// Issue #235: 誤答語に読み・IPA・例文を出す / TTS 案内は 1 箇所だけ
// ---------------------------------------------------------------------------

describe("ResultScreen (#232 zero-score sessions stay visible)", () => {
  it("records a real start time so a 0% completed session is not treated as aborted", async () => {
    const storage = makeStorageMock();
    const recordSpy = vi.spyOn(storage, "startSession");
    render(
      <ResultScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
        deckId="test-deck"
        lessonId="lesson-1"
        answers={answers([false, false, false])}
        progress={makeProgress([])}
      />,
    );
    await waitFor(() => expect(recordSpy).toHaveBeenCalled());
    const record = recordSpy.mock.calls[0][0];
    expect(record.scoreRate).toBe(0);
    expect(record.endedAt).not.toBeNull();
    // 全問不正解でも「回答 5 件の完走」なので中断判定に落ちてはいけない
    expect(record.startedAt).not.toBe(record.endedAt);
    expect(isAbortedSession(record)).toBe(false);
  });

  it("passes the quiz start time through unchanged", async () => {
    const storage = makeStorageMock();
    const recordSpy = vi.spyOn(storage, "startSession");
    render(
      <ResultScreen
        state={makeState()}
        dispatch={vi.fn()}
        storage={storage}
        deckId="test-deck"
        lessonId="lesson-1"
        answers={answers([false])}
        startedAt="2026-10-29T10:00:00.000Z"
        progress={makeProgress([])}
      />,
    );
    await waitFor(() => expect(recordSpy).toHaveBeenCalled());
    expect(recordSpy.mock.calls[0][0].startedAt).toBe(
      "2026-10-29T10:00:00.000Z",
    );
    expect(isAbortedSession(recordSpy.mock.calls[0][0])).toBe(false);
  });
});

describe("ResultScreen (#235 wrong-word detail)", () => {
  it("shows reading, IPA and the example sentence for a wrong word", async () => {
    const restore = stubVoices([VOICE]);
    try {
      renderResult(answers([false]), []);
      expect(await screen.findByText("apple")).toBeTruthy();
      expect(screen.getByText("（アップル）")).toBeTruthy();
      expect(screen.getByText("/ˈæp.əl/")).toBeTruthy();
      expect(screen.getByText("An apple.")).toBeTruthy();
      expect(screen.getByText("りんごです。")).toBeTruthy();
    } finally {
      cleanup();
      restore();
    }
  });

  it("shows the no-voice notice only once (#235)", async () => {
    const restore = stubVoices([]);
    try {
      renderResult(answers([false]), []);
      const notice = screen.getAllByText(
        "このブラウザは音声未対応です（TTSボイスがありません）",
      );
      expect(notice).toHaveLength(1);
      await userEvent.click(screen.getByLabelText("apple の発音を再生"));
      expect(
        screen.getAllByText("このブラウザは音声未対応です（TTSボイスがありません）"),
      ).toHaveLength(1);
    } finally {
      cleanup();
      restore();
    }
  });
});

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

  // Issue #194: 誤答語がある画面から、その語だけをやり直せる導線を出す。
  it("offers a retry button that starts a quiz scoped to the wrong words (#194)", async () => {
    const dispatch = vi.fn();
    const quizAnswers: AnswerRecord[] = [
      { quizId: "q0", wordId: "w0", choiceId: "c1", correct: false, latencyMs: 900 },
    ];
    render(
      <ResultScreen
        state={makeState()}
        dispatch={dispatch}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
        answers={quizAnswers}
        progress={makeProgress([])}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /誤答した 1 語だけをもう一度/ }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: {
        name: "quiz",
        deckId: "test-deck",
        lessonId: "lesson-1",
        focusWordIds: ["w0"],
      },
    });
  });

  it("hides the retry button when every answer was correct (#194)", async () => {
    renderResult(answers([true, true]), []);
    expect(
      screen.queryByRole("button", { name: /もう一度/ }),
    ).toBeNull();
  });

  it("offers a card retry that opens flash cards for the wrong words (#194)", async () => {
    const dispatch = vi.fn();
    const quizAnswers: AnswerRecord[] = [
      { quizId: "q0", wordId: "w0", choiceId: "c1", correct: false, latencyMs: 900 },
    ];
    render(
      <ResultScreen
        state={makeState()}
        dispatch={dispatch}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
        answers={quizAnswers}
        progress={makeProgress([])}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /カードで確認/ }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: {
        name: "flash",
        deckId: "test-deck",
        lessonId: "lesson-1",
        focusWordIds: ["w0"],
      },
    });
  });
});
