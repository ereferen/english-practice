import { flushSync } from "react-dom";
import type { Action } from "./types";

/**
 * Issue #95: View Transitions API wrapper for screen (route) switches.
 *
 * - Browsers without document.startViewTransition (Firefox today) fall
 *   back to an instant swap — no polyfill is bundled.
 * - prefers-reduced-motion skips the transition entirely (update runs
 *   synchronously, no startViewTransition call).
 * - Direction is derived from a coarse screen-depth order so 戻る-style
 *   navigation slides in from the left and drill-in from the right.
 */

export type TransitionDirection = "forward" | "back";

/** Rough drill-down depth; unlisted screens sit at deckList level. */
const SCREEN_DEPTH: Record<string, number> = {
  home: 0,
  deckList: 1,
  conversation: 1,
  settings: 1,
  progress: 1,
  dashboard: 1,
  review: 2,
  deckHome: 2,
  flash: 3,
  quiz: 4,
  result: 5,
};

/** The screen an action will switch to, or null if it keeps the screen. */
export function actionScreenName(action: Action): string | null {
  switch (action.type) {
    case "go":
      return action.screen.name;
    case "startLesson":
      return "flash";
    case "startGeneratedQuiz":
      return "quiz";
    case "finishQuiz":
      return "result";
    default:
      return null;
  }
}

export function directionFor(from: string, to: string): TransitionDirection {
  const depth = (n: string) => SCREEN_DEPTH[n] ?? 1;
  return depth(to) < depth(from) ? "back" : "forward";
}

interface ViewTransitionDoc {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  documentElement: HTMLElement;
}

export type TransitionDoc = Document & ViewTransitionDoc;

/**
 * Run `update` (a synchronous React dispatch) inside a view transition
 * when available. Falls back to an immediate swap otherwise, and skips
 * the transition under prefers-reduced-motion.
 */
export function runScreenTransition(
  update: () => void,
  direction: TransitionDirection,
  doc: Document & ViewTransitionDoc = document,
): void {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  if (
    reduced ||
    typeof doc.startViewTransition !== "function" ||
    // nested transitions are rejected by the UA; never break navigation
    !doc.documentElement
  ) {
    update();
    return;
  }
  const cls = direction === "back" ? "vt-back" : "vt-forward";
  const root = doc.documentElement;
  root.classList.add(cls);
  try {
    const vt = doc.startViewTransition(() => {
      // React state update must land synchronously for the new snapshot
      // (same pattern as the official React docs guidance).
      flushSync(update);
    });
    void vt.finished.finally(() => root.classList.remove(cls));
  } catch {
    root.classList.remove(cls);
    update();
  }
}
