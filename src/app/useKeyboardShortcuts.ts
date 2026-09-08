import { useEffect, useRef } from "react";

export type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutHandler>;

let suppressed = 0;

/** Temporarily disable all window-level shortcuts (e.g. while a modal is open). */
export function setShortcutsSuppressed(on: boolean): void {
  suppressed = Math.max(0, suppressed + (on ? 1 : -1));
}

/** True when the event target is a place where typed text should win over shortcuts. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A" ||
    t.isContentEditable
  );
}

/**
 * Register window-level keyboard shortcuts.
 *
 * Skips events with modifier keys (Ctrl/Meta/Alt), IME composition, and
 * events whose target is an editable/form element so text input always wins.
 */
export function useKeyboardShortcuts(map: ShortcutMap): void {
  const mapRef = useRef<ShortcutMap>(map);
  mapRef.current = map;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (suppressed > 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing) return;
      if (isEditableTarget(e.target)) return;
      const handler = mapRef.current[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
