/**
 * Issue #97: time-of-day ambient tint.
 *
 * The night scene (issues #40/#84/#93) gets a slow day cycle on top:
 * four keyframes (dawn / dusk / night / deep-night) define hue /
 * saturation / brightness adjustments for the blue-slate base tone,
 * and the current local time selects a segment whose endpoints are
 * linearly interpolated. Values land in CSS custom properties on
 * <html> (--sky-hue-shift / --sky-sat / --sky-bright) and the scene
 * layers filter with them.
 *
 * The engine re-lerps once a minute. Under prefers-reduced-motion the
 * colour still follows the clock (a colour change is not motion) but
 * the per-minute fade is skipped.
 */

export interface SkyTint {
  /** deg added to the base hue via filter: hue-rotate */
  hueShift: number;
  /** multiplier for filter: saturate */
  sat: number;
  /** multiplier for filter: brightness */
  bright: number;
}

/** Keyframe on a 24h local clock, hour may be fractional. */
interface SkyKeyframe extends SkyTint {
  hour: number;
  name: string;
}

/**
 * Night-first cycle (the app is a night scene — noon never becomes day),
 * authored on a cycle that starts at 05:00 local (dawn boundary):
 *  night (19-5):  current look, identity transform
 *  dawn  (5-9):   lift + warmth + a touch of colour
 *  lull  (9-16):  the "grey dusk" — slight dim, cool
 *  gold  (16-19): gold push (hue toward amber, warm boost)
 * The final keyframe repeats the night anchor at 5am so the 19→5 span
 * stays constant and the cycle wraps seamlessly.
 */
const CYCLE_START = 5;

export const SKY_KEYFRAMES: SkyKeyframe[] = [
  { name: "night", hour: 0, hueShift: 0, sat: 1.0, bright: 1.0 }, // 05:00
  { name: "dawn", hour: 4, hueShift: 8, sat: 1.12, bright: 1.08 }, // 09:00
  { name: "lull", hour: 7.5, hueShift: -2, sat: 0.96, bright: 0.95 }, // 12:30
  { name: "gold", hour: 11, hueShift: 10, sat: 1.14, bright: 1.04 }, // 16:00
  { name: "gold", hour: 13, hueShift: 14, sat: 1.2, bright: 1.06 }, // 18:00
  { name: "night", hour: 14, hueShift: 0, sat: 1.0, bright: 1.0 }, // 19:00
  { name: "night", hour: 24, hueShift: 0, sat: 1.0, bright: 1.0 }, // 05:00
];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolated tint for a fractional hour (0..24, local). */
export function tintForHour(hour: number): SkyTint {
  const h = ((hour % 24) + 24) % 24;
  const c = (h - CYCLE_START + 24) % 24;
  const kfs = SKY_KEYFRAMES;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (c >= a.hour && c <= b.hour) {
      const t = b.hour === a.hour ? 0 : (c - a.hour) / (b.hour - a.hour);
      return {
        hueShift: lerp(a.hueShift, b.hueShift, t),
        sat: lerp(a.sat, b.sat, t),
        bright: lerp(a.bright, b.bright, t),
      };
    }
  }
  const night = kfs[0];
  return { hueShift: night.hueShift, sat: night.sat, bright: night.bright };
}

export function tintFromLocalTime(date: Date): SkyTint {
  return tintForHour(date.getHours() + date.getMinutes() / 60);
}

export function toCssVars(t: SkyTint): Record<string, string> {
  return {
    "--sky-hue-shift": `${t.hueShift.toFixed(2)}deg`,
    "--sky-sat": t.sat.toFixed(3),
    "--sky-bright": t.bright.toFixed(3),
  };
}

export interface SkyTintController {
  start(): void;
  stop(): void;
  applyNow(date?: Date): SkyTint;
}

/**
 * Create a controller that writes the tint vars on <html>, immediately
 * and then every minute (smoothed by a 60s CSS transition, which the
 * stylesheet skips under prefers-reduced-motion).
 */
export function createSkyTintController(
  doc: Document = document,
  win: Window & typeof globalThis = window,
): SkyTintController {
  let interval: number | null = null;

  const apply = (date: Date): SkyTint => {
    const t = tintFromLocalTime(date);
    const vars = toCssVars(t);
    for (const [k, v] of Object.entries(vars)) {
      doc.documentElement.style.setProperty(k, v);
    }
    return t;
  };

  return {
    applyNow(date) {
      return apply(date ?? new Date());
    },
    start() {
      // double-start guard: never leak a second interval
      if (interval !== null) return;
      apply(new Date());
      // each tick re-reads local time, so a plain 60s cadence lerps the
      // vars minute by minute (the CSS 60s transition smooths the step)
      interval = win.setInterval(() => apply(new Date()), 60_000);
    },
    stop() {
      if (interval !== null) {
        win.clearInterval(interval);
        interval = null;
      }
    },
  };
}
