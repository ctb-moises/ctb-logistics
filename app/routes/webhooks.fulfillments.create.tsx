import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShop } from "../models/shop.server";
import { refreshFulfillmentStock } from "../services/inventory-sync.server";

// A fulfillment was created (in the app or in Shopify): on-hand changed without
// "available" changing, so no inventory_levels/update arrives. Re-read it.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop } = await authenticate.webhook(request);

  const settings = await getShop(shop);
  if (admin && settings?.locationId) {
    await refreshFulfillmentStock(
      admin,
      shop,
      settings.locationId,
      payload.admin_graphql_api_id,
    );
  }

  return new Response();
};
