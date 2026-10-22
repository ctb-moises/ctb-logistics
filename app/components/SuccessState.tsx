import type { ReactNode } from "react";

// Polaris icons only render at small sizes; the end of a picking or packing flow
// needs a clear, large confirmation. Like Polaris empty states, it's an
// illustration in s-image (Polaris success colours).
const SUCCESS_ILLUSTRATION = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="36" fill="#cdfee1"/><circle cx="36" cy="36" r="24" fill="#29845a"/><path d="M26 36.5l7 7 13-14" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)}`;

const WARNING_ILLUSTRATION = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="36" fill="#fff1e3"/><circle cx="36" cy="36" r="24" fill="#b28400"/><path d="M36 25v14" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><circle cx="36" cy="47" r="2.75" fill="#fff"/></svg>`,
)}`;

type Detail = { label: string; value: ReactNode };

// End-of-flow confirmation: illustration, outcome, key details and the single
// next action (full width, easy to hit on handheld scanners).
export function SuccessState({
  heading,
  message,
  details,
  tone = "success",
  notice,
  action,
}: {
  heading: string;
  message: string;
  details: Detail[];
  tone?: "success" | "warning";
  notice?: ReactNode;
  action: { label: string; href: string };
}) {
  return (
    <s-section accessibilityLabel={heading}>
      <s-stack gap="large" alignItems="center" paddingBlock="large">
        <s-box inlineSize="72px" blockSize="72px">
          <s-image
            src={
              tone === "success" ? SUCCESS_ILLUSTRATION : WARNING_ILLUSTRATION
            }
            alt=""
            aspectRatio="1/1"
          />
        </s-box>

        <s-stack gap="small-300" alignItems="center">
          <s-heading>{heading}</s-heading>
          <s-paragraph color="subdued">{message}</s-paragraph>
        </s-stack>

        <s-box
          inlineSize="100%"
          background="subdued"
          borderRadius="large"
          padding="base"
        >
          <s-grid
            gridTemplateColumns={`repeat(${details.length}, 1fr)`}
            gap="base"
            justifyItems="center"
          >
            {details.map((detail) => (
              <s-stack key={detail.label} gap="small-400" alignItems="center">
                <s-text color="subdued">{detail.label}</s-text>
                <s-heading>{detail.value}</s-heading>
              </s-stack>
            ))}
          </s-grid>
        </s-box>

        {notice}

        <s-box inlineSize="100%">
          <s-button variant="primary" inlineSize="fill" href={action.href}>
            {action.label}
          </s-button>
        </s-box>
      </s-stack>
    </s-section>
  );
}
