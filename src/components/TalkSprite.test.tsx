import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import TalkSprite from "./TalkSprite";

describe("TalkSprite (#85)", () => {
  it("renders a decorative sprite with the talk sheet as background", () => {
    const { container } = render(<TalkSprite />);
    const sprite = container.querySelector("span");
    expect(sprite).not.toBeNull();
    expect(sprite?.getAttribute("aria-hidden")).toBe("true");
    expect(sprite?.style.backgroundImage).toContain("npc-talk-sheet");
  });
});
