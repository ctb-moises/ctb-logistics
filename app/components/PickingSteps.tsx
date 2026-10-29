const STEPS = ["Filters", "Orders & boxes", "Pick"];

// Wizard progress for a picking round. `current` is 1-based. On handhelds only
// the current step keeps its name (the others show their number), so the steps
// fit on one line. Needs an s-query-container around it.
export function PickingSteps({ current }: { current: number }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        return (
          <s-stack
            key={label}
            direction="inline"
            gap="small-200"
            alignItems="center"
          >
            {index > 0 && (
              <s-icon type="chevron-right" tone="neutral" size="small" />
            )}
            <s-badge
              tone={done ? "success" : step === current ? "info" : "neutral"}
              icon={done ? "check" : undefined}
            >
              {String(step)}
            </s-badge>
            <s-box
              display={
                step === current
                  ? "auto"
                  : "@container (inline-size <= 480px) none, auto"
              }
            >
              <s-text
                type={step === current ? "strong" : undefined}
                color={step > current ? "subdued" : undefined}
              >
                {label}
              </s-text>
            </s-box>
          </s-stack>
        );
      })}
    </s-stack>
  );
}
