// Issue #83: TTS support detection. Some environments (headless browsers,
// minimal Linux images) expose window.speechSynthesis but report zero
// voices — speak() silently no-ops there, which looks like a broken button.
// The app now checks availability and gives the user explicit feedback.

export type SpeechSupport = "ready" | "no-voices" | "unsupported";

/** Classify the browser's speech-synthesis capability right now.
 *  Voices load asynchronously in Chrome; `getVoices()` may be empty for a
 *  moment on first call even when voices exist, so callers should re-check
 *  after `voiceschanged` (see useSpeechSupport). */
export function speechSupport(): SpeechSupport {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return "unsupported";
  }
  try {
    return window.speechSynthesis.getVoices().length > 0
      ? "ready"
      : "no-voices";
  } catch {
    return "unsupported";
  }
}

/** Returns true if an utterance was actually queued for playback.
 *  false = no engine/voices; callers should surface feedback (issue #83). */
export function speak(text: string, onEnd?: () => void): boolean {
  if (!("speechSynthesis" in window)) {
    onEnd?.();
    return false;
  }
  if (window.speechSynthesis.getVoices().length === 0) {
    // no-voices env: speaking would be a silent no-op
    onEnd?.();
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
  return true;
}
