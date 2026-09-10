import { useEffect, useState } from "react";
import { speechSupport, type SpeechSupport } from "./speech";

// Issue #83: voices arrive asynchronously (Chrome fires `voiceschanged`
// after getVoices() first returns []). Subscribe so the UI settles on the
// true support state instead of disabling the button too eagerly.
export function useSpeechSupport(): SpeechSupport {
  const [support, setSupport] = useState<SpeechSupport>(() => speechSupport());

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupport("unsupported");
      return;
    }
    const refresh = () => setSupport(speechSupport());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    // Some engines populate voices well after voiceschanged; re-probe once.
    const t = window.setTimeout(refresh, 500);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
      window.clearTimeout(t);
    };
  }, []);

  return support;
}
