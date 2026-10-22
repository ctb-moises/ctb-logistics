import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../models/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    // Sent ~48h after uninstall: delete all shop data.
    case "SHOP_REDACT":
      await deleteShopData(shop);
      break;
    // The app stores no customer data; nothing to return or delete.
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;
  }

  return new Response();
};
