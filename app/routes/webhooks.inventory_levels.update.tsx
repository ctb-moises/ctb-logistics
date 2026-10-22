import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShop } from "../models/shop.server";
import { syncInventoryItem } from "../services/inventory-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop } = await authenticate.webhook(request);

  // Fires for every location; only the selected warehouse is tracked.
  const settings = await getShop(shop);
  const locationId = `gid://shopify/Location/${payload.location_id}`;
  if (admin && settings?.locationId === locationId) {
    await syncInventoryItem(
      admin,
      shop,
      locationId,
      `gid://shopify/InventoryItem/${payload.inventory_item_id}`,
    );
  }

  return new Response();
};
