import type { ReactNode } from "react";

const SIZES = {
  // Inline next to a form field, within its height (e.g. the next cart slot).
  compact: "1.75rem",
  // Bin codes: read while walking the warehouse.
  large: "clamp(2.25rem, 9vw, 3.25rem)",
  // Slot numbers: read at arm's length on the cart.
  extraLarge: "clamp(2.75rem, 12vw, 4rem)",
};

// Polaris web components have no display-size text, but on scan screens the bin
// code and slot number guide the picker and must be readable from a handheld
// scanner at a distance. The only custom styling in the app: font size and
// weight; colour and font family come from Polaris.
export function DisplayText({
  children,
  size = "large",
  align = "center",
}: {
  children: ReactNode;
  size?: keyof typeof SIZES;
  align?: "start" | "center";
}) {
  return (
    <span
      style={{
        display: "block",
        fontSize: SIZES[size],
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
        overflowWrap: "anywhere",
        textAlign: align,
      }}
    >
      {children}
    </span>
  );
}
