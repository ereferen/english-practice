import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Action } from "../app/types";
import type { LocalProgressStore } from "../storage/localProgress";
import ProgressScreen from "./ProgressScreen";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockProgress(
  overrides?: Partial<LocalProgressStore>,
): LocalProgressStore {
  return {
    load: vi.fn(() => ({
      learnedWords: [],
      sessions: [],
      version: 1,
    })),
    save: vi.fn(),
    clear: vi.fn(),
    markLearned: vi.fn(),
    recordSession: vi.fn(),
    saveQuizResults: vi.fn(),
    loadQuizResults: vi.fn(() => null),
    ...overrides,
  };
}

function renderProgressScreen(
  dispatch?: React.Dispatch<Action>,
  progress?: LocalProgressStore,
) {
  const dispatchFn = dispatch ?? vi.fn();
  const progressStore = progress ?? makeMockProgress();
  return {
    dispatch: dispatchFn,
    progress: progressStore,
    ...render(
      <ProgressScreen
        dispatch={dispatchFn}
        localProgress={progressStore}
      />,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProgressScreen", () => {
  it("shows empty state when no data exists", () => {
    renderProgressScreen();
    expect(
      screen.getByText("まだ学習データがありません。デッキから学習を始めてください。"),
    ).toBeTruthy();
  });

  it("shows empty state when both arrays are empty", () => {
    const progress = makeMockProgress();
    renderProgressScreen(undefined, progress);
    expect(
      screen.getByText("まだ学習データがありません。デッキから学習を始めてください。"),
    ).toBeTruthy();
  });

  it("displays the number of learned words", () => {
    const progress = makeMockProgress({
      load: vi.fn(() => ({
        learnedWords: [
          { deckId: "d1", wordId: "w1", learnedAt: "2026-09-06T10:00:00Z" },
          { deckId: "d1", wordId: "w2", learnedAt: "2026-09-06T10:00:00Z" },
          { deckId: "d1", wordId: "w3", learnedAt: "2026-09-06T10:00:00Z" },
        ],
        sessions: [],
        version: 1,
      })),
    });
    renderProgressScreen(undefined, progress);
    expect(screen.getByText("3 語")).toBeTruthy();
  });

  it("displays quiz session history with scores", () => {
    const progress = makeMockProgress({
      load: vi.fn(() => ({
        learnedWords: [],
        sessions: [
          {
            askedCount: 10,
            correctCount: 7,
            answeredAt: "2026-09-06T10:00:00Z",
          },
          {
            askedCount: 5,
            correctCount: 5,
            answeredAt: "2026-09-07T14:30:00Z",
          },
        ],
        version: 1,
      })),
    });
    renderProgressScreen(undefined, progress);
    // Session 1: 2026-09-06, 7/10 (70%)
    expect(screen.getByText("2026-09-06")).toBeTruthy();
    expect(screen.getByText("7/10 問 (70%)")).toBeTruthy();
    // Session 2: 2026-09-07, 5/5 (100%)
    expect(screen.getByText("2026-09-07")).toBeTruthy();
    expect(screen.getByText("5/5 問 (100%)")).toBeTruthy();
  });

  it("shows learned words and sessions together", () => {
    const progress = makeMockProgress({
      load: vi.fn(() => ({
        learnedWords: [
          { deckId: "d1", wordId: "w1", learnedAt: "2026-09-06T10:00:00Z" },
        ],
        sessions: [
          {
            askedCount: 3,
            correctCount: 2,
            answeredAt: "2026-09-06T11:00:00Z",
          },
        ],
        version: 1,
      })),
    });
    renderProgressScreen(undefined, progress);
    expect(screen.getByText("1 語")).toBeTruthy();
    expect(screen.getByText("2/3 問 (67%)")).toBeTruthy();
  });

  it("renders navigation header with title", () => {
    renderProgressScreen();
    expect(screen.getByText("進捗確認")).toBeTruthy();
  });

  it("navigates home via header 戻る button", async () => {
    const { dispatch } = renderProgressScreen();
    const backBtn = screen.getByRole("button", { name: "戻る" });
    await userEvent.click(backBtn);
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "home" },
    });
  });

  it("navigates home via ホームへ button when data exists", async () => {
    const progress = makeMockProgress({
      load: vi.fn(() => ({
        learnedWords: [
          { deckId: "d1", wordId: "w1", learnedAt: "2026-09-06T10:00:00Z" },
        ],
        sessions: [],
        version: 1,
      })),
    });
    const { dispatch } = renderProgressScreen(undefined, progress);
    const homeBtn = screen.getByRole("button", { name: "ホームへ" });
    await userEvent.click(homeBtn);
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "home" },
    });
  });

  it("shows learning badge when data exists", () => {
    const progress = makeMockProgress({
      load: vi.fn(() => ({
        learnedWords: [
          { deckId: "d1", wordId: "w1", learnedAt: "2026-09-06T10:00:00Z" },
        ],
        sessions: [],
        version: 1,
      })),
    });
    renderProgressScreen(undefined, progress);
    expect(screen.getByText("学習済み単語数")).toBeTruthy();
  });
});