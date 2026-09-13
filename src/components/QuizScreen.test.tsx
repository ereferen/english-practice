import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../app/types";
import type { StorageProvider } from "../storage/types";
import { fixtureWords } from "../app/fixtures";
import type { Deck } from "../content/schema";
import QuizScreen from "./QuizScreen";

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

/** Deck with no authored quizzes → loader auto-generates choose-meaning
    quizzes from the words (needs >= 4 words in the pool). */
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
    screen: {
      name: "quiz",
      deckId: deck.deckId,
      lessonId: deck.lessons[0].lessonId,
    },
    decks: [deck],
    selectedDeckId: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuizScreen", () => {
  it("marks the answer choice with the choice-correct feedback class (issue #94 gold-flash hook)", async () => {
    const deck = makeTestDeck();
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
      />,
    );
    const buttons = screen.getAllByRole("button", { name: /選択肢/ });
    // Click the first choice; whichever way it scores, feedback appears.
    await userEvent.click(buttons[0]);
    expect(await screen.findByText(/[○×] (正解|不正解)/)).toBeTruthy();
    // The correct answer always carries the choice-correct class, which is
    // the element the #94 gold-flash keyframe animates.
    const marked = document.querySelectorAll(".choice-correct");
    expect(marked.length).toBe(1);
  });
});
