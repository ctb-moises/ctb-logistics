import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

// Blocks the page while an action is saved or the next step loads, with a
// spinner and what's happening. Warehouse staff must not scan or tap twice, nor
// wonder whether a scan registered.
//
// Quick actions (single scans) only show it after `delayMs`, so it doesn't
// flash on every scan; long transitions pass delayMs={0}.
//
// Don't also call shopify.loading(): the admin then draws its own unlabelled
// spinner over the app, on top of this one.
//
// Polaris has no blocking overlay, so this fixed layer is the one piece of
// custom positioning; its content is Polaris.
export function BlockingOverlay({
  active,
  message,
  delayMs = 250,
}: {
  active: boolean;
  message: string;
  delayMs?: number;
}) {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delayMs]);

  const visible = active && (delayMs === 0 || elapsed);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: "16px",
        background: "rgba(241, 241, 241, 0.8)",
        cursor: "progress",
      }}
    >
      <s-box
        background="base"
        border="base"
        borderRadius="large"
        padding="large"
      >
        <s-stack gap="base" alignItems="center">
          <s-spinner size="large" accessibilityLabel={message} />
          <s-text type="strong">{message}</s-text>
        </s-stack>
      </s-box>
    </div>
  );
}

export type PendingAction = { message: string; immediate?: boolean };

// Where a navigation is going says what's happening (e.g. a redirect to step 3
// means the picking route is being built). These are the long transitions.
const NAVIGATION_MESSAGES: [RegExp, string][] = [
  [/^\/app\/picking\/\d+\/pick$/, "Preparing the picking route…"],
  [/^\/app\/picking\/\d+\/done$/, "Finishing the picking round…"],
  [/^\/app\/picking\/\d+$/, "Opening the picking round…"],
  [/^\/app\/packing\/\d+\/done$/, "Finishing the order…"],
  [/^\/app\/packing\/\d+$/, "Opening the order…"],
];

// What the page is busy with: its own action (set when submitting) while it
// runs, then the navigation it leads to until the next page is ready.
export function usePageActivity(
  actionBusy: boolean,
  action: PendingAction,
): { active: boolean; message: string; delayMs: number } {
  const navigation = useNavigation();
  const delay = (immediate?: boolean) => (immediate ? 0 : 250);

  if (actionBusy) {
    return {
      active: true,
      message: action.message,
      delayMs: delay(action.immediate),
    };
  }
  if (navigation.state === "submitting") {
    return {
      active: true,
      message: action.message,
      delayMs: delay(action.immediate),
    };
  }
  if (navigation.state === "loading") {
    const known = NAVIGATION_MESSAGES.find(([pattern]) =>
      pattern.test(navigation.location.pathname),
    );
    return {
      active: true,
      message: known?.[1] ?? "Loading…",
      delayMs: delay(known !== undefined),
    };
  }
  return { active: false, message: action.message, delayMs: 250 };
}
