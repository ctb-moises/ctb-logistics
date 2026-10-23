import { useEffect, useRef, type RefObject } from "react";

// A rejected scan, as a popup instead of an inline banner, so the scan screen
// keeps its space for what the picker works with. It opens for each new
// rejection (`trigger` is the action result) and closes with OK, Enter, or the
// next scan (pages call `closeScanError` before processing a scan).
export function ScanErrorModal({
  id,
  heading,
  error,
  trigger,
  modal,
}: {
  id: string;
  heading: string;
  error: string | null;
  trigger: unknown;
  modal?: RefObject<HTMLElementTagNameMap["s-modal"]>;
}) {
  const ownRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const ref = modal ?? ownRef;

  useEffect(() => {
    if (error) ref.current?.showOverlay();
    // Only a new action result opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <s-modal ref={ref} id={id} heading={heading} size="small">
      <s-grid gridTemplateColumns="auto 1fr" gap="small" alignItems="start">
        <s-icon type="alert-circle" tone="critical" />
        <s-paragraph>{error}</s-paragraph>
      </s-grid>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor={id}
        command="--hide"
      >
        OK
      </s-button>
    </s-modal>
  );
}

export function closeScanError(
  modal: RefObject<HTMLElementTagNameMap["s-modal"]>,
) {
  modal.current?.hideOverlay();
}
