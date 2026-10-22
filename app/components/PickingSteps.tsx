const STEPS = ["Filters", "Orders & boxes", "Pick"];

// Wizard progress for a picking round. `current` is 1-based.
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
            <s-text
              type={step === current ? "strong" : undefined}
              color={step > current ? "subdued" : undefined}
            >
              {label}
            </s-text>
          </s-stack>
        );
      })}
    </s-stack>
  );
}
