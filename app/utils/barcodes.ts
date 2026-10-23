// Product barcodes are GTINs: the same code can be stored or printed as
// GTIN-12 (UPC-A), GTIN-13 (EAN-13) or GTIN-14, differing only in leading
// zeros (e.g. Shopify has "0022600200031", the label scans as "022600200031").
// Compare them as GTINs; non-numeric codes are compared as they are.

const GTIN_LENGTHS = [8, 12, 13, 14];

function isGtin(code: string) {
  return /^\d+$/.test(code) && GTIN_LENGTHS.includes(code.length);
}

// The GTIN without leading zeros, or the trimmed code if it isn't a GTIN.
export function canonicalBarcode(code: string) {
  const trimmed = code.trim();
  return isGtin(trimmed) ? trimmed.replace(/^0+/, "") : trimmed;
}

export function sameBarcode(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  if (!a || !b) return false;
  return canonicalBarcode(a) === canonicalBarcode(b);
}

// Every way a scanned code may be stored, for database lookups by equality.
export function barcodeVariants(code: string) {
  const trimmed = code.trim();
  if (!isGtin(trimmed)) return [trimmed];
  const digits = canonicalBarcode(trimmed);
  return GTIN_LENGTHS.filter((length) => length >= digits.length).map(
    (length) => digits.padStart(length, "0"),
  );
}
