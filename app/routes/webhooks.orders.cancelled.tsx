import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { releaseOrder } from "../models/picking.server";

// The order no longer needs its picking box or its reservation.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);

  await releaseOrder(shop, `gid://shopify/Order/${payload.id}`);

  return new Response();
};
