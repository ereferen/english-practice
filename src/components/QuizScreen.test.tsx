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

  // Issue #107: any throw in the generation-prep pipeline (e.g. the old
  // unindexed wrongTotal query) used to leave the spinner running forever.
  it("leaves the loading state with an error when loadWeakWords rejects (#107)", async () => {
    const deck = makeTestDeck();
    const storage = makeStorageMock();
    (storage.loadSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      llmApiEndpoint: "http://localhost:11434/v1",
      llmModel: "test",
      llmApiKey: "",
      llmFallbackApiEndpoint: "",
    });
    storage.loadWeakWords = vi.fn(async () => {
      throw new Error("SchemaError: KeyPath wrongTotal is not indexed");
    });
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={storage}
        deckId="test-deck"
        lessonId="lesson-1"
        gen="llm-wrong-focus"
      />,
    );
    expect(await screen.findByText("生成に失敗しました")).toBeTruthy();
    expect(screen.getByText(/wrongTotal/)).toBeTruthy();
    // Recovery path: link into Settings (issue #107 expectation 2)
    expect(screen.getByRole("button", { name: "設定を開く" })).toBeTruthy();
  });

  it("shows the not-configured error instead of a spinner when LLM is unset (#107)", async () => {
    const deck = makeTestDeck();
    const storage = makeStorageMock();
    (storage.loadSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      llmApiEndpoint: "",
      llmModel: "",
      llmApiKey: "",
      llmFallbackApiEndpoint: "",
    });
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={storage}
        deckId="test-deck"
        lessonId="lesson-1"
        gen="llm-wrong-focus"
      />,
    );
    expect(await screen.findByText(/LLMが設定されていません/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "設定を開く" })).toBeTruthy();
  });

  // Issue #116: zero weak words is a normal empty state — neutral heading,
  // no "生成に失敗しました" face, no 設定を開く CTA.
  it("shows a neutral empty card (not a failure) when no weak words exist (#116)", async () => {
    const deck = makeTestDeck();
    const storage = makeStorageMock();
    (storage.loadSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      llmApiEndpoint: "https://api.example.com/v1",
      llmModel: "test",
      llmApiKey: "",
      llmFallbackApiEndpoint: "",
    });
    // loadWeakWords defaults to [] → no weak words in this lesson
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={storage}
        deckId="test-deck"
        lessonId="lesson-1"
        gen="llm-wrong-focus"
      />,
    );
    expect(await screen.findByText("まだ苦手語はありません")).toBeTruthy();
    expect(
      screen.getByText(/苦手語（誤答2回以上）はまだありません/),
    ).toBeTruthy();
    expect(screen.queryByText("生成に失敗しました")).toBeNull();
    expect(screen.queryByRole("button", { name: "設定を開く" })).toBeNull();
  });

  // Issue #134: < 4 words used to be a dead end ("クイズがありません" + 戻る).
  it("empty-quiz screen explains the 4-word rule and points at LLM generation (#134)", () => {
    const deck = makeTestDeck();
    deck.lessons[0].words = fixtureWords.slice(0, 3); // too few for a quiz
    const { container } = render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
      />,
    );
    expect(screen.getByText("クイズがありません")).toBeTruthy();
    expect(screen.getByText(/クイズには4語以上必要です/)).toBeTruthy();
    expect(screen.getByText(/このレッスンは現在\s*3\s*語です/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /デッキ画面で補充問題を生成する/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "戻る" })).toBeTruthy();
    expect(container.textContent).toContain("LLMで補充問題を生成");
  });

  it("補充問題を生成する CTA returns to the deck screen (#134)", async () => {
    const deck = makeTestDeck();
    deck.lessons[0].words = fixtureWords.slice(0, 3);
    const dispatch = vi.fn();
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={dispatch}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /デッキ画面で補充問題を生成する/ }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "deckHome", deckId: "test-deck" },
    });
  });

  // Issue #132: 進捗 must not throw the quiz session away.
  it("進捗 opens an in-session panel instead of navigating away (#132)", async () => {
    const deck = makeTestDeck();
    const dispatch = vi.fn();
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={dispatch}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
      />,
    );
    await userEvent.click(screen.getByTestId("quiz-progress-button"));
    expect(screen.getByText("このセッションの進み具合")).toBeTruthy();
    expect(containerText(/クイズ 1\//)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("学習の記録を開く warns before discarding, then navigates on confirm (#132)", async () => {
    const deck = makeTestDeck();
    const dispatch = vi.fn();
    render(
      <QuizScreen
        state={makeState(deck)}
        dispatch={dispatch}
        storage={makeStorageMock()}
        deckId="test-deck"
        lessonId="lesson-1"
      />,
    );
    await userEvent.click(screen.getByTestId("quiz-progress-button"));
    await userEvent.click(screen.getByTestId("quiz-open-record"));
    expect(screen.getByText(/このクイズは閉じます/)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "それでも記録を見る" }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "progress" },
    });
  });
});

/** Text search over the whole rendered document (helpers above use screen). */
function containerText(pattern: RegExp): boolean {
  return pattern.test(document.body.textContent ?? "");
}
