import { describe, expect, it, vi } from "vitest";
import {
  createSkyTintController,
  lerp,
  tintForHour,
  tintFromLocalTime,
  toCssVars,
} from "./skyTint";

describe("tintForHour", () => {
  it("night hours (19-5) are the untouched current look", () => {
    for (const h of [19, 21, 0, 2, 4.99]) {
      const t = tintForHour(h);
      expect(t.hueShift).toBe(0);
      expect(t.sat).toBe(1);
      expect(t.bright).toBe(1);
    }
  });

  it("dawn (9h) lifts brightness and saturation with slight warmth", () => {
    const dawn = tintForHour(9);
    expect(dawn.bright).toBeGreaterThan(1);
    expect(dawn.sat).toBeGreaterThan(1);
    expect(dawn.hueShift).toBeGreaterThan(0);
  });

  it("evening (16-19h) is the gold push: highest warmth of the day", () => {
    const gold = tintForHour(17.5);
    const noon = tintForHour(12.5);
    expect(gold.sat).toBeGreaterThan(noon.sat);
    expect(gold.hueShift).toBeGreaterThan(noon.hueShift);
  });

  it("interpolates linearly between keyframes", () => {
    // 7h sits midway on the dawn(9) -> lull(12:30)... use exact anchors:
    // dawn at 9h is c=4, lull at 12:30 is c=7.5; pick c=5.75 => 10.75h
    const a = tintForHour(9);
    const b = tintForHour(12.5);
    const mid = tintForHour(10.75);
    expect(mid.hueShift).toBeCloseTo(lerp(a.hueShift, b.hueShift, 0.5), 4);
    expect(mid.bright).toBeCloseTo(lerp(a.bright, b.bright, 0.5), 4);
  });

  it("wraps out-of-range hours", () => {
    expect(tintForHour(26)).toEqual(tintForHour(2));
    expect(tintForHour(-2)).toEqual(tintForHour(22));
  });

  it("is continuous across every hour step (no jumps > 0.08)", () => {
    let prev = tintForHour(0);
    for (let h = 0.25; h <= 24; h += 0.25) {
      const t = tintForHour(h);
      expect(Math.abs(t.bright - prev.bright)).toBeLessThan(0.05);
      expect(Math.abs(t.sat - prev.sat)).toBeLessThan(0.06);
      expect(Math.abs(t.hueShift - prev.hueShift)).toBeLessThan(4);
      prev = t;
    }
  });
});

describe("tintFromLocalTime / toCssVars", () => {
  it("derives fractional hour from a Date", () => {
    const d = new Date(2026, 0, 1, 9, 30);
    expect(tintFromLocalTime(d)).toEqual(tintForHour(9.5));
  });

  it("serialises to the CSS custom properties", () => {
    const vars = toCssVars({ hueShift: 8.123, sat: 1.1234, bright: 1.0777 });
    expect(vars["--sky-hue-shift"]).toBe("8.12deg");
    expect(vars["--sky-sat"]).toBe("1.123");
    expect(vars["--sky-bright"]).toBe("1.078");
  });
});

describe("createSkyTintController", () => {
  function mockDoc() {
    const style = { setProperty: vi.fn() };
    return { documentElement: { style } } as unknown as Document & {
      documentElement: { style: typeof style };
    };
  }
  function mockWin() {
    return {
      clearInterval: vi.fn(),
      setInterval: vi.fn(() => 2),
    } as unknown as Window & typeof globalThis;
  }

  it("writes all three vars immediately on start", () => {
    const doc = mockDoc();
    const win = mockWin();
    createSkyTintController(doc, win).start();
    const keys = doc.documentElement.style.setProperty.mock.calls.map(
      (c) => c[0],
    );
    expect(keys).toContain("--sky-hue-shift");
    expect(keys).toContain("--sky-sat");
    expect(keys).toContain("--sky-bright");
    expect(win.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it("the minute tick re-applies the current tint", () => {
    const doc = mockDoc();
    const win = mockWin();
    createSkyTintController(doc, win).start();
    doc.documentElement.style.setProperty.mockClear();
    const cb = (
      win.setInterval as unknown as {
        mock: { calls: [() => void, number][] };
      }
    ).mock.calls[0][0];
    cb();
    expect(doc.documentElement.style.setProperty).toHaveBeenCalledTimes(3);
  });

  it("stop() cancels the running interval (no leaks)", () => {
    const doc = mockDoc();
    const win = mockWin();
    const c = createSkyTintController(doc, win);
    c.start();
    c.stop();
    expect(win.clearInterval).toHaveBeenCalledTimes(1);
    // stop() twice must not clear twice
    c.stop();
    expect(win.clearInterval).toHaveBeenCalledTimes(1);
  });

  it("start() twice does not leak a second interval", () => {
    const doc = mockDoc();
    const win = mockWin();
    const c = createSkyTintController(doc, win);
    c.start();
    c.start();
    expect(win.setInterval).toHaveBeenCalledTimes(1);
    // restart after stop still works
    c.stop();
    c.start();
    expect(win.setInterval).toHaveBeenCalledTimes(2);
  });

  it("applyNow updates vars for an explicit time", () => {
    const doc = mockDoc();
    const win = mockWin();
    const c = createSkyTintController(doc, win);
    const t = c.applyNow(new Date(2026, 0, 1, 17, 30));
    expect(t).toEqual(tintForHour(17.5));
    expect(doc.documentElement.style.setProperty).toHaveBeenCalledWith(
      "--sky-hue-shift",
      expect.stringMatching(/deg$/),
    );
  });
});
