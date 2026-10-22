import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShop } from "../models/shop.server";
import { syncInventoryItem } from "../services/inventory-sync.server";

// Fires when an item changes, e.g. "Track quantity" switched on or off, which
// adds the item to or removes it from the selected warehouse's inventory.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop } = await authenticate.webhook(request);

  const settings = await getShop(shop);
  if (admin && settings?.locationId) {
    await syncInventoryItem(
      admin,
      shop,
      settings.locationId,
      `gid://shopify/InventoryItem/${payload.id}`,
    );
  }

  return new Response();
};
