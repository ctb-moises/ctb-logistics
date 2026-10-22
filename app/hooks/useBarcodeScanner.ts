import { useEffect, useRef, useState, type RefObject } from "react";

type ScannerOptions = {
  enabled?: boolean;
  // Codes shorter than this are ignored (stray key presses).
  minLength?: number;
  // Scanners type much faster than people: a longer pause between keys starts
  // a new code, so manual typing never ends up as a scan.
  maxKeyIntervalMs?: number;
};

// Keys typed into a field belong to that field, not to the scanner.
function isEditableTarget(event: KeyboardEvent) {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

// Listens for keyboard-wedge barcode scanners: buffers the characters they type
// and calls onScan with the code when the terminating Enter arrives.
export function useBarcodeScanner(
  onScan: (code: string) => void,
  {
    enabled = true,
    minLength = 3,
    maxKeyIntervalMs = 100,
  }: ScannerOptions = {},
) {
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event)) return;
      if (event.timeStamp - lastKeyAt.current > maxKeyIntervalMs) {
        buffer.current = "";
      }
      lastKeyAt.current = event.timeStamp;

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        if (code.length >= minLength) {
          event.preventDefault();
          handler.current(code);
        }
      } else if (event.key.length === 1) {
        buffer.current += event.key;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, minLength, maxKeyIntervalMs]);
}

// Embedded apps run in an iframe that only receives key presses while focused.
export function useWindowFocus() {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    const update = () => setFocused(document.hasFocus());
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return focused;
}

const INTERACTIVE_TAGS = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "S-BUTTON",
  "S-LINK",
  "S-CLICKABLE",
  "S-TEXT-FIELD",
  "S-NUMBER-FIELD",
  "S-SELECT",
  "S-MODAL",
]);

// Makes a text field the scan target: Enter in the field calls onEnter (Polaris
// fields don't submit forms on Enter), and the field keeps focus so the scanner
// types straight into it — on load, when the app regains focus, and after clicks
// on non-interactive parts of the page. (An embedded app can't take focus from
// the rest of the admin by itself; that case is covered by the "Scanner paused"
// banner.)
export function useScanField(
  field: RefObject<HTMLElement | null>,
  { enabled, onEnter }: { enabled: boolean; onEnter: () => void },
) {
  const handler = useRef(onEnter);
  useEffect(() => {
    handler.current = onEnter;
  });

  useEffect(() => {
    const element = field.current;
    if (!enabled || !element) return;

    const focus = () => element.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      handler.current();
    };
    const onPointerUp = (event: PointerEvent) => {
      const interactive = event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement && INTERACTIVE_TAGS.has(node.tagName),
        );
      // Leave text selections alone (e.g. copying an order number).
      if (!interactive && !window.getSelection()?.toString()) focus();
    };

    focus();
    element.addEventListener("keydown", onKeyDown);
    window.addEventListener("focus", focus);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focus", focus);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, [field, enabled]);
}
