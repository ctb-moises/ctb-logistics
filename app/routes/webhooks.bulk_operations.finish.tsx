import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { completeInventorySync } from "../services/inventory-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Processing a large catalog can exceed the webhook timeout, so acknowledge
  // right away and finish in the background.
  if (admin) {
    completeInventorySync(admin, shop, payload.admin_graphql_api_id).catch(
      (error) => console.error(`Inventory sync failed for ${shop}`, error),
    );
  }

  return new Response();
};
