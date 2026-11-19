import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WordPopover from "./WordPopover";
import type { WordMeaning } from "../domain/wordLookup";

const meaning = (term: string): WordMeaning => ({
  term,
  reading: "",
  partOfSpeech: "noun",
  meaning: "意味",
  example: "",
  exampleJa: "",
});

const renderPopover = (term: string, resolved: WordMeaning | null) =>
  render(
    <WordPopover
      term={term}
      status={resolved ? "ready" : "loading"}
      meaning={resolved}
      error={null}
      canSpeak={false}
      addState="idle"
      onSpeak={vi.fn()}
      onAdd={vi.fn()}
      onClose={vi.fn()}
    />,
  );

describe("WordPopover (#290)", () => {
  it("見出し語がタップ語と違うときはタップ語を併記する", () => {
    renderPopover("same", meaning("seem"));
    expect(screen.getByTestId("word-popover-tapped")).toHaveTextContent(
      "タップした語: same",
    );
  });

  it("見出し語がタップ語と同じ（大小文字差のみ）なら併記しない", () => {
    renderPopover("Same", meaning("same"));
    expect(screen.queryByTestId("word-popover-tapped")).toBeNull();
  });

  it("意味が未取得のあいだは併記しない", () => {
    renderPopover("same", null);
    expect(screen.queryByTestId("word-popover-tapped")).toBeNull();
  });
});
