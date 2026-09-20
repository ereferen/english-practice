import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../app/types";
import type { StorageProvider, ReviewState } from "../storage/types";
import { fixtureWords } from "../app/fixtures";
import type { Deck } from "../content/schema";
import ReviewSession from "./ReviewSession";

function makeStorageMock(
  reviews: ReviewState[] = [
    {
      deckId: "test-deck",
      wordId: "ability",
      level: 1,
      lastResult: "correct",
      lastSeenAt: "2026-09-01T00:00:00.000Z",
      dueAt: "2026-09-20",
      correctStreak: 1,
      wrongTotal: 0,
    },
  ],
): StorageProvider {
  const noop = vi.fn(async () => undefined);
  return {
    loadSettings: vi.fn(
      async () =>
        ({
          srsParams: { intervalDays: [0, 0, 1, 4], level3WrongDemotesTo: 1 },
        }) as never,
    ),
    saveSettings: noop,
    loadReview: vi.fn(async () => undefined),
    saveReview: vi.fn(async () => undefined),
    loadDueReviews: vi.fn(async () => reviews),
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

function makeTestDeck(): Deck {
  return {
    $schema: "",
    schemaVersion: "1.0",
    deckId: "test-deck",
    level: "beginner",
    title: "Test Deck",
    description: "A test deck",
    lessons: [
      {
        lessonId: "lesson-1",
        title: "Lesson 1",
        words: fixtureWords.slice(0, 6),
        quizzes: [],
      },
    ],
  };
}

function makeState(deck: Deck): AppState {
  return {
    screen: { name: "review" },
    decks: [deck],
    selectedDeckId: null,
  };
}

describe("ReviewSession (issue #114)", () => {
  it("starts a due-word review session directly from the home shortcut", async () => {
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock()}
      />,
    );
    // One due word → the session shows question 1/1 with choices.
    expect(await screen.findByText(/復習セッション/)).toBeTruthy();
    expect(screen.getByText("(1/1)")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /選択肢/ });
    expect(buttons).toHaveLength(4);
    await userEvent.click(buttons[0]);
    expect(await screen.findByText(/[○×] (正解|不正解)/)).toBeTruthy();
    // Last question → finishing shows the summary instead of a dead end.
    await userEvent.click(screen.getByRole("button", { name: "完了する" }));
    expect(await screen.findByText("復習セッション完了")).toBeTruthy();
  });

  it("shows the all-clear card when nothing is due", async () => {
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock([])}
      />,
    );
    expect(await screen.findByText("復習する語はありません")).toBeTruthy();
    expect(screen.getByText(/今日の復習はすべて終わっています/)).toBeTruthy();
  });
});
