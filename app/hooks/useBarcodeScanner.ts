import { useEffect, useRef, useState } from "react";

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
