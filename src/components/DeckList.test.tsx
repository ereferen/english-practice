import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../app/types";
import type { Deck } from "../content/schema";
import { loadBundledDecks } from "../content/loader";
import { CONVERSATION_DECK_ID } from "../domain/conversationExtract";
import { MANUAL_DECK_ID } from "../domain/manualDeck";
import type { StorageProvider } from "../storage/types";
import DeckList from "./DeckList";

// ---------------------------------------------------------------------------
// Issue #42: deck rows are .menu-item buttons with a ▸ caret that follows
// hover / keyboard focus (pseudo-element, checked via class + focus state).
// ---------------------------------------------------------------------------

function makeState(decks: Deck[]): AppState {
  return { screen: { name: "deckList" }, decks, selectedDeckId: null };
}

async function firstDeck(): Promise<Deck> {
  const { decks } = await loadBundledDecks();
  return decks[0].deck;
}

/** Escape a literal string for use inside a RegExp. */
function reLiteral(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

describe("DeckList menu-item rows (issue #42)", () => {
  it("renders each deck as a menu-item button (no separate 開く button)", async () => {
    const deck = await firstDeck();
    render(<DeckList state={makeState([deck])} dispatch={vi.fn()} />);

    const row = screen.getByRole("button", { name: reLiteral(deck.title) });
    expect(row.className).toContain("menu-item");
    expect(screen.queryByRole("button", { name: "開く" })).toBeNull();
  });

  it("clicking a deck row dispatches go → deckHome with the deck id", async () => {
    const deck = await firstDeck();
    const dispatch = vi.fn();
    render(<DeckList state={makeState([deck])} dispatch={dispatch} />);

    await userEvent.click(
      screen.getByRole("button", { name: reLiteral(deck.title) }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "go",
      screen: { name: "deckHome", deckId: deck.deckId },
    });
  });

  it("keyboard focus lands on the deck row so the caret can follow", async () => {
    const deck = await firstDeck();
    const user = userEvent.setup();
    render(<DeckList state={makeState([deck])} dispatch={vi.fn()} />);

    const row = screen.getByRole("button", { name: reLiteral(deck.title) });
    await user.tab(); // 単語を追加 button
    await user.tab(); // 戻る button
    await user.tab(); // deck row
    expect(document.activeElement).toBe(row);
  });
});

describe("DeckList の並び（issue #151）", () => {
  it("会話から抽出したデッキはサンプルより上に出す", async () => {
    const { decks } = await loadBundledDecks();
    const sample: Deck = decks[0].deck;
    const mine: Deck = {
      ...sample,
      deckId: CONVERSATION_DECK_ID,
      source: "conversation",
      level: "beginner",
      title: "会話から抽出 (2026-09-29)",
    };

    // state ではサンプルが先（追加順のまま）でも、表示は自分のデッキが先頭
    render(<DeckList state={makeState([sample, mine])} dispatch={vi.fn()} />);

    // ナビのボタン（単語を追加 / 戻る）を除いたデッキ行だけを見る。
    const deckRows = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("menu-item"));
    expect(deckRows[0].textContent).toContain("会話から抽出 (2026-09-29)");
    expect(deckRows[1].textContent).toContain(sample.title);
    expect(deckRows[0].textContent).toContain("beginner");

    // まとまりの見出し（複数たまったときにここへ集まる）
    expect(screen.getByText("自分のデッキ")).toBeTruthy();
    expect(screen.getByText("サンプル")).toBeTruthy();
  });

  it("自分のデッキが無いときは見出しを増やさない", async () => {
    const { decks } = await loadBundledDecks();
    render(<DeckList state={makeState([decks[0].deck])} dispatch={vi.fn()} />);

    expect(screen.queryByText("自分のデッキ")).toBeNull();
    expect(screen.getByText("デッキ")).toBeTruthy();
  });
});

describe("DeckList 単語を追加（issue #178）", () => {
  it("貼り付けた語を検証して保存し、一覧を更新する", async () => {
    const { decks } = await loadBundledDecks();
    const dispatch = vi.fn();
    const saveUserDeck = vi.fn().mockResolvedValue(undefined);
    const storage = { saveUserDeck } as unknown as StorageProvider;

    render(
      <DeckList
        state={makeState([decks[0].deck])}
        dispatch={dispatch}
        storage={storage}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "単語を追加" }));
    await user.type(
      screen.getByRole("textbox"),
      "commute, 通勤する, I commute by train.",
    );
    await user.click(screen.getByRole("button", { name: "追加する" }));

    expect(saveUserDeck).toHaveBeenCalledTimes(1);
    const saved = saveUserDeck.mock.calls[0][0];
    expect(saved.deckId).toBe(MANUAL_DECK_ID);
    expect(saved.deck.lessons[0].words[0].term).toBe("commute");

    expect(dispatch).toHaveBeenCalledWith({
      type: "setDecks",
      decks: expect.arrayContaining([
        expect.objectContaining({ deckId: MANUAL_DECK_ID }),
      ]),
    });
  });

  it("区切りの無い入力はエラーを出し、保存しない", async () => {
    const { decks } = await loadBundledDecks();
    const saveUserDeck = vi.fn();
    const storage = { saveUserDeck } as unknown as StorageProvider;

    render(
      <DeckList
        state={makeState([decks[0].deck])}
        dispatch={vi.fn()}
        storage={storage}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "単語を追加" }));
    await user.type(screen.getByRole("textbox"), "commute");
    await user.click(screen.getByRole("button", { name: "追加する" }));

    expect(saveUserDeck).not.toHaveBeenCalled();
    expect(screen.getByText(/1行目/)).toBeTruthy();
  });
});
