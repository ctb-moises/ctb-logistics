import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useActionData, useLoaderData, useSubmit } from "react-router";
import {
  BlockingOverlay,
  usePageActivity,
} from "../components/BlockingOverlay";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  getShop,
  setPackingMode,
  setPickingBatchSizes,
  setShopLocation,
} from "../models/shop.server";
import { MAX_ORDERS_PER_ROUND, parseBatchSizes } from "../utils/picking";
import { isPackingMode, PACKING_MODES } from "../utils/packing";
import { startInventorySync } from "../services/inventory-sync.server";

type ShopifyLocation = {
  id: string;
  name: string;
  fulfillsOnlineOrders: boolean;
};

const LOCATIONS_QUERY = `#graphql
  query SettingsLocations {
    locations(first: 250, includeInactive: false) {
      nodes {
        id
        name
        fulfillsOnlineOrders
      }
    }
  }
`;

const LOCATION_QUERY = `#graphql
  query SettingsLocation($id: ID!) {
    location(id: $id) {
      id
      name
      isActive
    }
  }
`;

async function fetchLocations(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
): Promise<ShopifyLocation[]> {
  const response = await admin.graphql(LOCATIONS_QUERY);
  const { data } = await response.json();
  return data?.locations?.nodes ?? [];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [locations, settings] = await Promise.all([
    fetchLocations(admin),
    getShop(session.shop),
  ]);

  return { locations, settings };
};

type SettingsErrors = {
  locationId?: string;
  pickingBatchSizes?: string;
  packingMode?: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const locationId = String(formData.get("locationId") ?? "");
  const batchSizes = parseBatchSizes(
    String(formData.get("pickingBatchSizes") ?? ""),
  );
  const packingMode = String(formData.get("packingMode") ?? "");
  const errors: SettingsErrors = {};

  // Validate against Shopify so we never store an invalid id or one from another shop.
  let location: { id: string; name: string } | null = null;
  if (locationId.startsWith("gid://shopify/Location/")) {
    const response = await admin.graphql(LOCATION_QUERY, {
      variables: { id: locationId },
    });
    const { data } = await response.json();
    if (data?.location?.isActive) location = data.location;
  }
  if (!location) errors.locationId = "Select a valid location.";
  if (!batchSizes) {
    errors.pickingBatchSizes = `Enter whole numbers from 1 to ${MAX_ORDERS_PER_ROUND}, separated by commas, without repeats.`;
  }
  if (!isPackingMode(packingMode))
    errors.packingMode = "Select a packing mode.";
  if (!location || !batchSizes || !isPackingMode(packingMode)) {
    return { ok: false, errors };
  }

  const previous = await getShop(session.shop);
  await setShopLocation(session.shop, location);
  await setPickingBatchSizes(session.shop, batchSizes);
  await setPackingMode(session.shop, packingMode);
  // A new warehouse needs a fresh copy of its Shopify stock.
  if (previous?.locationId !== location.id) {
    await startInventorySync(admin, session.shop, location.id);
  }
  return { ok: true, errors };
};

export default function Settings() {
  const { locations, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  // Saving may start a full inventory sync when the warehouse changes.
  const activity = usePageActivity(false, {
    message: "Saving settings…",
    immediate: true,
  });
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok) shopify.toast.show("Settings saved");
  }, [actionData, shopify]);

  // Saving goes through the admin contextual save bar (data-save-bar), as in
  // Shopify's settings page template; no in-page Save button.
  return (
    <form
      data-save-bar
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget, { method: "post" });
      }}
    >
      <s-page heading="Settings" inlineSize="small">
        <s-section
          heading="Warehouse"
          subheading="Bin stock and all picking operations run against the inventory of this Shopify location."
        >
          <s-select
            name="locationId"
            label="Shopify location"
            placeholder="Select a location"
            value={settings?.locationId ?? ""}
            error={actionData?.errors.locationId}
          >
            {locations.map((location) => (
              <s-option key={location.id} value={location.id}>
                {location.fulfillsOnlineOrders
                  ? location.name
                  : `${location.name} (doesn't fulfill online orders)`}
              </s-option>
            ))}
          </s-select>
        </s-section>
        <s-section
          heading="Picking"
          subheading="Options offered when starting a picking round."
        >
          <s-text-field
            name="pickingBatchSizes"
            label="Orders per round"
            details="Comma-separated, e.g. 1, 4, 8, 16, 32. The first one is selected by default."
            value={(settings?.pickingBatchSizes ?? "1,4,8,16,32")
              .split(",")
              .join(", ")}
            error={actionData?.errors.pickingBatchSizes}
          />
        </s-section>
        <s-section
          heading="Packing & Fulfillment"
          subheading="What happens when every unit of an order is packed."
        >
          <s-choice-list
            name="packingMode"
            label="After packing"
            labelAccessibilityVisibility="exclusive"
            error={actionData?.errors.packingMode}
          >
            {PACKING_MODES.map((mode) => (
              <s-choice
                key={mode.value}
                value={mode.value}
                selected={(settings?.packingMode ?? "PACK") === mode.value}
              >
                {mode.label}
                <s-text slot="details">{mode.details}</s-text>
              </s-choice>
            ))}
          </s-choice-list>
        </s-section>
        <BlockingOverlay {...activity} />
      </s-page>
    </form>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
