// Shared by the picking wizard UI and server validation.

export const MAX_ORDERS_PER_ROUND = 100;
export const ORDER_TAG_MAX_LENGTH = 255;

export const PICKING_STATUSES = [
  { value: "IN_PROGRESS", label: "In progress", tone: "info" },
  { value: "COMPLETED", label: "Completed", tone: "success" },
] as const;

export type PickingStatus = (typeof PICKING_STATUSES)[number]["value"];

export function pickingStatus(value: string) {
  return PICKING_STATUSES.find((status) => status.value === value);
}

export function financialStatusLabel(value: string) {
  return (
    FINANCIAL_STATUSES.find((status) => status.value === value)?.label ?? value
  );
}

// Shopify order financial statuses offered as picking filters.
export const FINANCIAL_STATUSES = [
  { value: "paid", label: "Paid" },
  { value: "authorized", label: "Authorized" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "pending", label: "Payment pending" },
] as const;

export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number]["value"];

export function isFinancialStatus(value: string): value is FinancialStatus {
  return FINANCIAL_STATUSES.some((status) => status.value === value);
}

// Parses the "orders per round" setting ("1, 4, 8"). Returns null if any entry
// isn't a whole number between 1 and MAX_ORDERS_PER_ROUND or is repeated.
export function parseBatchSizes(text: string): number[] | null {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const sizes = parts.map(Number);
  const valid =
    sizes.length > 0 &&
    sizes.every(
      (size) =>
        Number.isInteger(size) && size >= 1 && size <= MAX_ORDERS_PER_ROUND,
    ) &&
    new Set(sizes).size === sizes.length;
  return valid ? sizes : null;
}

export const BOX_CODE_MAX_LENGTH = 64;

// Box barcodes are compared case-insensitively and without surrounding spaces.
export function normalizeBoxCode(code: string) {
  return code.trim().toUpperCase();
}

export function isValidBoxCode(code: string) {
  return (
    code.length > 0 && code.length <= BOX_CODE_MAX_LENGTH && !/\s/.test(code)
  );
}
