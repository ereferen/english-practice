import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../app/types";
import type { Deck } from "../content/schema";
import { loadBundledDecks } from "../content/loader";
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
    await user.tab(); // 戻る button
    await user.tab(); // deck row
    expect(document.activeElement).toBe(row);
  });
});
