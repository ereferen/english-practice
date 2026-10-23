import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../app/types";
import type { Deck } from "../content/schema";
import { buildManualDeck } from "../domain/manualDeck";
import type { StorageProvider } from "../storage/types";
import { DEFAULT_SETTINGS } from "../storage/types";
import DeckHome from "./DeckHome";

// ---------------------------------------------------------------------------
// Issue #181: 自分で入れた語を後から直せる（名前変更・語の編集/削除）。
// ---------------------------------------------------------------------------

function manualDeck(): Deck {
  return buildManualDeck(
    [
      { term: "commute", meaning: "通勤する" },
      { term: "resilient", meaning: "粘り強い" },
    ],
    { now: "2026-10-11T00:00:00.000Z" },
  );
}

function fakeStorage(overrides: Partial<StorageProvider> = {}) {
  const base = {
    loadSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    loadReview: vi.fn().mockResolvedValue(undefined),
    countAnswersSince: vi.fn().mockResolvedValue(0),
    saveUserDeck: vi.fn().mockResolvedValue(undefined),
    deleteUserDeck: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides } as unknown as StorageProvider & {
    saveUserDeck: ReturnType<typeof vi.fn>;
    deleteUserDeck: ReturnType<typeof vi.fn>;
  };
}

function makeState(deck: Deck): AppState {
  return {
    screen: { name: "deckHome", deckId: deck.deckId },
    decks: [deck],
    selectedDeckId: deck.deckId,
  };
}

describe("DeckHome 自分のデッキを直す (issue #181)", () => {
  it("自分のデッキでは名前変更と語の一覧（編集/削除）が出る", async () => {
    const deck = manualDeck();
    render(
      <DeckHome
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={fakeStorage()}
        deckId={deck.deckId}
      />,
    );

    expect(screen.getByTestId("deck-edit-card")).toBeTruthy();
    const list = screen.getByTestId("deck-word-list");
    expect(list.textContent).toContain("commute");
    expect(list.textContent).toContain("resilient");
    expect(screen.getByRole("button", { name: "名前を変更" })).toBeTruthy();
  });

  it("デッキ名を変えると保存して一覧を更新する", async () => {
    const deck = manualDeck();
    const storage = fakeStorage();
    const dispatch = vi.fn();
    render(
      <DeckHome
        state={makeState(deck)}
        dispatch={dispatch}
        storage={storage}
        deckId={deck.deckId}
      />,
    );

    const user = userEvent.setup();
    const input = screen.getByLabelText("デッキ名");
    await user.clear(input);
    await user.type(input, "旅行の語");
    await user.click(screen.getByRole("button", { name: "名前を変更" }));

    await waitFor(() => expect(storage.saveUserDeck).toHaveBeenCalledTimes(1));
    expect(storage.saveUserDeck.mock.calls[0][0].deck.title).toBe("旅行の語");
    expect(dispatch).toHaveBeenCalledWith({
      type: "setDecks",
      decks: [expect.objectContaining({ title: "旅行の語" })],
    });
  });

  it("語の削除は確認ダイアログを挟んで1語だけ消す", async () => {
    const deck = manualDeck();
    const storage = fakeStorage();
    render(
      <DeckHome
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={storage}
        deckId={deck.deckId}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "resilient を削除" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(storage.saveUserDeck).toHaveBeenCalledTimes(1));
    const words = storage.saveUserDeck.mock.calls[0][0].deck.lessons[0].words;
    expect(words).toHaveLength(1);
    expect(words[0].term).toBe("commute");
  });

  it("語を編集すると意味を書き換えて保存する", async () => {
    const deck = manualDeck();
    const storage = fakeStorage();
    render(
      <DeckHome
        state={makeState(deck)}
        dispatch={vi.fn()}
        storage={storage}
        deckId={deck.deckId}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "commute を編集" }));
    const meaning = screen.getByLabelText("意味");
    await user.clear(meaning);
    await user.type(meaning, "通勤する、往復する");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(storage.saveUserDeck).toHaveBeenCalledTimes(1));
    expect(
      storage.saveUserDeck.mock.calls[0][0].deck.lessons[0].words[0].meaning,
    ).toBe("通勤する、往復する");
  });

  it("サンプルデッキ（bundled）には編集カードを出さない", async () => {
    const sample: Deck = { ...manualDeck(), deckId: "sample", source: "bundled" };
    render(
      <DeckHome
        state={makeState(sample)}
        dispatch={vi.fn()}
        storage={fakeStorage()}
        deckId={sample.deckId}
      />,
    );

    await waitFor(() => expect(screen.queryByText("読み込み中")).toBeNull());
    expect(screen.queryByTestId("deck-edit-card")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #209: LLM未設定のとき、押す前に「設定が必要」と分かる
// ---------------------------------------------------------------------------
describe("DeckHome LLM未設定時の補充問題ボタン (issue #209)", () => {
  const sample: Deck = { ...manualDeck(), deckId: "sample", source: "bundled" };

  function renderDeck(storage: StorageProvider) {
    render(
      <DeckHome
        state={makeState(sample)}
        dispatch={vi.fn()}
        storage={storage}
        deckId={sample.deckId}
      />,
    );
  }

  it("未設定（初期値エンドポイント）なら LLM ボタンが disabled で理由を出す", async () => {
    renderDeck(fakeStorage());

    const supplement = await screen.findByRole("button", {
      name: /LLMで補充問題を生成/,
    });
    const focus = screen.getByRole("button", { name: /苦手語集中トレーニング/ });
    await waitFor(() => expect(supplement).toBeDisabled());
    expect(focus).toBeDisabled();
    expect(supplement.getAttribute("title")).toContain("設定が必要");
    expect(screen.getByTestId("deck-llm-hint")).toBeTruthy();
  });

  it("接続テスト成功済みなら LLM ボタンは押せて、理由表示は出ない", async () => {
    renderDeck(
      fakeStorage({
        loadSettings: vi.fn().mockResolvedValue({
          ...DEFAULT_SETTINGS,
          llmApiEndpoint: "https://api.example.com/v1",
          llmVerifiedEndpoint: "https://api.example.com/v1",
        }),
      }),
    );

    const supplement = await screen.findByRole("button", {
      name: /LLMで補充問題を生成/,
    });
    await waitFor(() => expect(supplement).toBeEnabled());
    expect(supplement.getAttribute("title")).toBeNull();
    expect(screen.queryByTestId("deck-llm-hint")).toBeNull();
  });
});
