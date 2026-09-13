import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { prefersReducedMotion, useCountUp } from "./useCountUp";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q) =>
      ({
        matches: q.includes("reduced-motion") ? matches : false,
        media: q,
      }) as unknown as ReturnType<typeof window.matchMedia>,
  );
}

describe("useCountUp", () => {
  it("shows the target instantly under prefers-reduced-motion (no animation frames)", () => {
    mockReducedMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { result } = renderHook(() => useCountUp(80, 600));
    expect(result.current).toBe(80);
    expect(prefersReducedMotion()).toBe(true);
    expect(raf).not.toHaveBeenCalled();
  });

  it("animates from 0 to target and lands exactly on it", async () => {
    mockReducedMotion(false);
    let time = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      callbacks.delete(id);
    });
    const { result } = renderHook(() => useCountUp(100, 600));
    expect(result.current).toBe(0);
    // drive frames: 0 → 300 → 600ms (each inside act so React flushes)
    for (const t of [0, 300, 600]) {
      time = t;
      await act(async () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const cb of pending) cb(time);
      });
    }
    expect(result.current).toBe(100);
  });

  it("cancels its rAF chain on unmount (no second counter keeps running)", () => {
    mockReducedMotion(false);
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = callbacks.size + 1;
      callbacks.set(id, cb);
      return id;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = renderHook(() => useCountUp(50, 600));
    expect(callbacks.size).toBe(1);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
