/**
 * Issue #84: stage dressing — the app should feel like one picture,
 * with the UI set inside it. Two fixed decorative layers live in the
 * gutters of wide (≥1024px) viewports:
 *  - a distant rimlit mountain + castle silhouette (inline SVG, dim
 *    parchment-on-night, opacity ≤ 0.12)
 *  - a lantern-carrying traveler walking in place bottom-right
 *    (4-frame sprite sheet driven by CSS steps(), #85 style motion)
 * Purely decorative: aria-hidden, pointer-events none, below the UI
 * in z-order. Hidden entirely under prefers-reduced-motion's walker
 * (stands still on frame 0) and below 1024px.
 */
import type { CSSProperties } from "react";
import travelerSheet from "../assets/traveler-sheet.png";
import styles from "./StageDressing.module.css";

/* Nightfall palette rimlight silhouette (viewBox 400x120) */
const MOUNTAINS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" preserveAspectRatio="none">
  <polygon points="0,120 40,74 70,96 110,52 150,90 190,60 230,100 260,80 300,110 340,66 400,120" fill="#131c30"/>
  <polyline points="0,120 40,74 70,96 110,52 150,90 190,60 230,100 260,80 300,110 340,66 400,120" fill="none" stroke="#31415f" stroke-width="1.5"/>
  <g stroke="#8a7233" stroke-width="1.5" fill="none">
    <path d="M205 60 v-14 M201 46 h8 M203 50 h4"/>
  </g>
</svg>`;

const mountainsUrl = `url("data:image/svg+xml,${encodeURIComponent(MOUNTAINS_SVG)}")`;

/* Issue #93: firefly motes — deterministic positions/timings so SSR
   tests stay stable and reloads don't reshuffle the scene. Spread over
   the right-hand gutter where the traveler walks. */
interface Mote {
  x: string;
  y: string;
  dur: string;
  delay: string;
}

const MOTES: Mote[] = [
  { x: "8%", y: "18%", dur: "9s", delay: "0s" },
  { x: "26%", y: "9%", dur: "12s", delay: "-3s" },
  { x: "44%", y: "24%", dur: "10.5s", delay: "-6s" },
  { x: "61%", y: "6%", dur: "13s", delay: "-2s" },
  { x: "75%", y: "30%", dur: "8.5s", delay: "-5.5s" },
  { x: "90%", y: "14%", dur: "11s", delay: "-8s" },
  { x: "18%", y: "38%", dur: "14s", delay: "-4s" },
];

function moteStyle(m: Mote): CSSProperties {
  return {
    "--x": m.x,
    "--y": m.y,
    "--dur": m.dur,
    "--delay": m.delay,
  } as CSSProperties;
}

export default function StageDressing() {
  return (
    <>
      <div
        aria-hidden="true"
        className={styles.mountains}
        style={{ backgroundImage: mountainsUrl }}
      />
      <div
        aria-hidden="true"
        className={styles.traveler}
        style={{ backgroundImage: `url(${travelerSheet})` }}
      />
      {/* #93 ambient layers: star parallax, drifting mist, fireflies */}
      <div aria-hidden="true" className={styles.starsFar} />
      <div aria-hidden="true" className={styles.starsNear} />
      <div aria-hidden="true" className={styles.mist} />
      <div aria-hidden="true" className={styles.motes}>
        {MOTES.map((m, i) => (
          <span key={i} className={styles.mote} style={moteStyle(m)} />
        ))}
      </div>
    </>
  );
}
