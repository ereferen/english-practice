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

  it("shows the source deck badge on each question (issue #221)", async () => {
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock()}
      />,
    );
    const badge = await screen.findByTestId("review-deck-badge");
    expect(badge.textContent).toBe("Test Deck");
  });

  it("summarises which deck each reviewed word came from (issue #221)", async () => {
    const deckA = makeTestDeck();
    const deckB: Deck = {
      ...makeTestDeck(),
      deckId: "other-deck",
      title: "Other Deck",
    };
    const reviews: ReviewState[] = [
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
      {
        deckId: "other-deck",
        wordId: "ability",
        level: 1,
        lastResult: "correct",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
        dueAt: "2026-09-20",
        correctStreak: 1,
        wrongTotal: 0,
      },
    ];
    const user = userEvent.setup();
    render(
      <ReviewSession
        state={{ ...makeState(deckA), decks: [deckA, deckB] }}
        dispatch={vi.fn()}
        storage={makeStorageMock(reviews)}
      />,
    );
    const badge = await screen.findByTestId("review-deck-badge");
    expect(badge.textContent).toBeTruthy();
    // 2問とも答えて完了画面へ
    for (let i = 0; i < 2; i += 1) {
      const choices = await screen.findAllByRole("button", {
        name: /選択肢/,
      });
      await user.click(choices[0]);
      await screen.findByText(/[○×] (正解|不正解)/);
      const next = screen.getByRole("button", {
        name: i === 0 ? "次へ" : "完了する",
      });
      await user.click(next);
    }
    const breakdown = await screen.findByTestId("review-deck-breakdown");
    expect(breakdown.textContent).toContain("Test Deck");
    expect(breakdown.textContent).toContain("Other Deck");
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

describe("ReviewSession feedback parity (issue #210 / #212)", () => {
  it("shows the word's reading, meaning and example after answering", async () => {
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock()}
      />,
    );
    expect(await screen.findByText("(1/1)")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: /選択肢/ })[0]);

    const detail = await screen.findByTestId("answer-detail");
    expect(detail).toHaveTextContent("ability");
    expect(detail).toHaveTextContent("アビリティ");
    expect(detail).toHaveTextContent("能力");
    expect(detail).toHaveTextContent(
      "She has the ability to speak four languages.",
    );
  });

  it("advertises the 1-4 key hint like the quiz screen", async () => {
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={makeStorageMock()}
      />,
    );
    expect(await screen.findByText("(1/1)")).toBeTruthy();
    expect(
      screen.getByText("1 - 4 キーでも選べます（? でショートカット一覧）"),
    ).toBeTruthy();
  });
});

describe("ReviewSession completion (issue #204)", () => {
  async function finishSingleWordSession(storage: StorageProvider) {
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );
    expect(await screen.findByText("(1/1)")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: /選択肢/ })[0]);
    await screen.findByText(/[○×] (正解|不正解)/);
    await userEvent.click(screen.getByRole("button", { name: "完了する" }));
    expect(await screen.findByText("復習セッション完了")).toBeTruthy();
  }

  it("explains the leftover due words and offers a second round in place", async () => {
    const storage = makeStorageMock();
    await finishSingleWordSession(storage);

    const note = await screen.findByTestId("review-remaining-note");
    expect(note).toHaveTextContent("今日の復習はあと 1 語");
    const again = await screen.findByTestId("review-again");
    expect(again).toHaveTextContent("もう一周（1 語）");

    // 2周目 stays in the same screen and shows the round marker.
    await userEvent.click(again);
    expect(await screen.findByText("2周目")).toBeTruthy();
    expect(await screen.findByText("(1/1)")).toBeTruthy();
  });

  it("celebrates when nothing is left due and links back home", async () => {
    const reviews = await makeStorageMock().loadDueReviews(null, "2026-10-21");
    const storage = makeStorageMock();
    let calls = 0;
    storage.loadDueReviews = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? reviews : [];
    });
    const dispatch = vi.fn();
    const deck = makeTestDeck();
    render(
      <ReviewSession
        state={makeState(deck)}
        dispatch={dispatch}
        storage={storage}
      />,
    );
    expect(await screen.findByText("(1/1)")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: /選択肢/ })[0]);
    await screen.findByText(/[○×] (正解|不正解)/);
    await userEvent.click(screen.getByRole("button", { name: "完了する" }));

    expect(
      await screen.findByTestId("review-remaining-note"),
    ).toHaveTextContent("今日の復習はすべて完了しました");
    expect(screen.queryByTestId("review-again")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "ホームへ" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "home" },
    });
  });
});
