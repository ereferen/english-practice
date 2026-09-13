import { useEffect, useRef, useState } from "react";

/** True when the user asked for reduced motion (issue #96: numbers
 *  appear instantly instead of counting up). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Issue #96: animate an integer from 0 to `target` over `durationMs`
 * using requestAnimationFrame. StrictMode-safe: the effect owns a
 * single rAF chain and cancels it on cleanup, so a mount/unmount/remount
 * never leaves two counters racing. Reduced motion (or an environment
 * without rAF) jumps straight to the target.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(() =>
    prefersReducedMotion() || typeof window.requestAnimationFrame !== "function"
      ? target
      : 0,
  );
  // Guard against a second start for the same target (double effect run
  // with an active animation is a no-op; cleanup cancels the chain).
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      prefersReducedMotion() ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      setValue(target);
      return;
    }
    let cancelled = false;
    let start: number | null = null;
    const step = (now: number) => {
      if (cancelled) return;
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cube, integer output
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      }
    };
    frameRef.current = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [target, durationMs]);

  return value;
}
