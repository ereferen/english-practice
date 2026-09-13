import { describe, expect, it, vi } from "vitest";
import {
  actionScreenName,
  directionFor,
  runScreenTransition,
  type TransitionDoc,
} from "./viewTransition";

describe("actionScreenName", () => {
  it("maps every screen-changing action to its target screen", () => {
    expect(actionScreenName({ type: "go", screen: { name: "settings" } })).toBe(
      "settings",
    );
    expect(
      actionScreenName({ type: "startLesson", deckId: "d", lessonId: "l" }),
    ).toBe("flash");
    expect(
      actionScreenName({
        type: "startGeneratedQuiz",
        deckId: "d",
        lessonId: "l",
        gen: "llm-supplement",
      }),
    ).toBe("quiz");
    expect(
      actionScreenName({
        type: "finishQuiz",
        deckId: "d",
        lessonId: "l",
        answers: [],
      }),
    ).toBe("result");
    expect(actionScreenName({ type: "setDecks", decks: [] })).toBeNull();
  });
});

describe("directionFor", () => {
  it("treats drill-down as forward and drill-up as back", () => {
    expect(directionFor("home", "deckList")).toBe("forward");
    expect(directionFor("deckHome", "flash")).toBe("forward");
    expect(directionFor("flash", "deckHome")).toBe("back");
    expect(directionFor("result", "home")).toBe("back");
    // unlisted screens sit at deckList depth
    expect(directionFor("result", "progress")).toBe("back");
  });
});

describe("runScreenTransition", () => {
  it("falls back to a direct update when startViewTransition is missing (Firefox path)", () => {
    const update = vi.fn();
    const doc = {
      documentElement: document.documentElement,
    } as unknown as TransitionDoc;
    runScreenTransition(update, "forward", doc);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips the transition entirely under prefers-reduced-motion", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (q) =>
        ({
          matches: true,
          media: q,
        }) as unknown as ReturnType<typeof window.matchMedia>,
    );
    const startViewTransition = vi.fn(() => ({ finished: Promise.resolve() }));
    const doc = {
      startViewTransition,
      documentElement: document.documentElement,
    } as unknown as TransitionDoc;
    const update = vi.fn();
    runScreenTransition(update, "forward", doc);
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    matchMedia.mockRestore();
  });

  it("runs the update inside startViewTransition and tags the root with the direction class", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (q) =>
        ({
          matches: false,
          media: q,
        }) as unknown as ReturnType<typeof window.matchMedia>,
    );
    document.documentElement.classList.remove("vt-forward", "vt-back");
    let captured: (() => void) | null = null;
    let resolveFinished: () => void = () => {};
    const finished = new Promise<void>((r) => {
      resolveFinished = r;
    });
    const doc = {
      startViewTransition: vi.fn((cb: () => void) => {
        captured = cb;
        return { finished };
      }),
      documentElement: document.documentElement,
    } as unknown as TransitionDoc;
    const update = vi.fn();
    runScreenTransition(update, "back", doc);
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("vt-back")).toBe(true);
    // simulate the UA calling the update callback
    captured!();
    expect(update).toHaveBeenCalledTimes(1);
    resolveFinished();
    await finished;
    // class cleanup happens on the finished promise
    await Promise.resolve();
    expect(document.documentElement.classList.contains("vt-back")).toBe(false);
    matchMedia.mockRestore();
  });

  it("does nothing extra when startViewTransition throws (nested transition)", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (q) =>
        ({
          matches: false,
          media: q,
        }) as unknown as ReturnType<typeof window.matchMedia>,
    );
    const doc = {
      startViewTransition: vi.fn(() => {
        throw new Error("already transitioning");
      }),
      documentElement: document.documentElement,
    } as unknown as TransitionDoc;
    const update = vi.fn();
    expect(() => runScreenTransition(update, "forward", doc)).not.toThrow();
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("vt-forward")).toBe(
      false,
    );
    matchMedia.mockRestore();
  });
});
