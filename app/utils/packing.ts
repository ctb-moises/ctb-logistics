// Shared by the packing UI, settings and server validation.

export const PACKING_MODES = [
  {
    value: "PACK",
    label: "Pack only",
    details: 'Packed orders get the "packed" tag. Fulfill them in Shopify.',
  },
  {
    value: "PACK_AND_FULFILL",
    label: "Pack and fulfill",
    details:
      "After packing, enter the carrier and tracking number and the app fulfills the order in Shopify.",
  },
] as const;

export type PackingMode = (typeof PACKING_MODES)[number]["value"];

export function isPackingMode(value: string): value is PackingMode {
  return PACKING_MODES.some((mode) => mode.value === value);
}

// Shopify order tag added once every picked unit is checked into the parcel.
export const PACKED_ORDER_TAG = "packed";

// Carrier names as Shopify knows them, so it builds the tracking URL itself.
// Any other carrier needs a tracking URL.
export const CARRIERS = [
  "CTT",
  "CTT Express",
  "DPD",
  "DHL Express",
  "GLS",
  "UPS",
  "FedEx",
  "SEUR",
  "Nacex",
  "MRW",
  "Correos Express",
] as const;

export const OTHER_CARRIER = "other";
export const TRACKING_MAX_LENGTH = 255;
