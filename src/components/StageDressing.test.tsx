import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import StageDressing from "./StageDressing";

describe("StageDressing ambient layers (#93)", () => {
  it("renders the traveler, star fields, mist, and firefly motes as decorative layers", () => {
    const { container } = render(<StageDressing />);
    // every ambient node must be aria-hidden (pure decoration)
    const fixed = [...container.querySelectorAll("div")];
    expect(fixed.length).toBeGreaterThanOrEqual(5);
    for (const el of fixed) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
    const motes = container.querySelectorAll("span");
    expect(motes.length).toBe(7);
  });

  it("drives each mote with CSS custom properties for position and timing", () => {
    const { container } = render(<StageDressing />);
    const motes = [...container.querySelectorAll("span")];
    for (const m of motes) {
      const css = m.getAttribute("style") ?? "";
      expect(css).toContain("--x");
      expect(css).toContain("--y");
      expect(css).toContain("--dur");
      expect(css).toContain("--delay");
    }
    // deterministic layout: no two motes share the same spot
    const xs = motes.map((m) => m.getAttribute("style"));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("adds the #97 sky veil as a decorative layer", () => {
    const { container } = render(<StageDressing />);
    const veil = container.querySelector("[aria-hidden='true']");
    const veils = [...container.querySelectorAll("div")].filter((d) =>
      (d.className as string).includes("skyVeil"),
    );
    expect(veils).toHaveLength(1);
    expect(veils[0].getAttribute("aria-hidden")).toBe("true");
    expect(veil).not.toBeNull();
  });

  it("keeps the traveler sprite wired to the walk sheet", () => {
    const { container } = render(<StageDressing />);
    const traveler = container.querySelector(
      "[style*='traveler-sheet']",
    ) as HTMLElement | null;
    expect(traveler).not.toBeNull();
  });
});
