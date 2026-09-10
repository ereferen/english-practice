/**
 * Issue #85: NPC talk sprite — a 2-frame bust that "patters" its mouth
 * next to an assistant bubble while read-aloud (TTS) is active.
 *
 * Asset contract (docs/art/sprite-prompt.md): 2 frames @ 24x24
 * (48x24 sheet), nightfall palette, no anti-aliasing. Generated PoC via
 * scripts/make-npc-talk-sprite.py, validated by
 * scripts/validate-sprite.py --frames 2 — swap in the AI-generated
 * production asset with the same checks when it arrives.
 * Motion is CSS steps(2) at 3x; reduced-motion stands on the
 * closed-mouth frame.
 */
import talkSheet from "../assets/npc-talk-sheet.png";
import styles from "./TalkSprite.module.css";

export default function TalkSprite() {
  return (
    <span
      aria-hidden="true"
      className={styles.sprite}
      style={{ backgroundImage: `url(${talkSheet})` }}
    />
  );
}
