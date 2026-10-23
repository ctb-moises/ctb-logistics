import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  finishFulfilling,
  markPackedTagged,
  PackingError,
  startFulfilling,
} from "../models/packing.server";
import { releaseOrder } from "../models/picking.server";
import { refreshFulfillmentStock } from "./inventory-sync.server";
import { PACKED_ORDER_TAG } from "../utils/packing";
import {
  addOrderTags,
  FulfillmentError,
  fulfillOrderAtLocation,
  type Tracking,
} from "./shopify-orders.server";

// Adds the "packed" tag in Shopify to a packed order, once. Returns whether the
// order has the tag. Retried when the order page loads again.
export async function tagPackedOrder(
  admin: AdminApiContext,
  order: {
    id: number;
    orderId: string;
    packedAt: Date | null;
    packedTaggedAt: Date | null;
  },
) {
  if (!order.packedAt) return false;
  if (order.packedTaggedAt) return true;
  try {
    const tagged = await addOrderTags(
      admin,
      [order.orderId],
      [PACKED_ORDER_TAG],
    );
    if (tagged.length === 0) return false;
    await markPackedTagged(order.id);
    return true;
  } catch (error) {
    console.error(`Tagging packed order ${order.orderId} failed`, error);
    return false;
  }
}

// Fulfills a packed order in Shopify with tracking, once (guarded by a lock), and
// frees its box right away — the orders/fulfilled webhook would do it later, but
// only for orders fully fulfilled across all locations.
export async function fulfillPackedOrder(
  admin: AdminApiContext,
  shop: string,
  order: { id: number; orderId: string; locationId: string },
  tracking: Tracking,
  notifyCustomer: boolean,
) {
  if (!(await startFulfilling(shop, order.id))) {
    throw new PackingError("This order is already being fulfilled.");
  }
  let fulfillmentId: string;
  try {
    fulfillmentId = await fulfillOrderAtLocation(
      admin,
      order.orderId,
      order.locationId,
      tracking,
      notifyCustomer,
    );
  } catch (error) {
    await finishFulfilling(order.id, null);
    if (error instanceof FulfillmentError)
      throw new PackingError(error.message);
    throw error;
  }
  await finishFulfilling(order.id, {
    company: tracking.company,
    number: tracking.number,
  });
  await releaseOrder(shop, order.orderId);
  // Shopify's on-hand dropped; no inventory webhook reports that.
  try {
    await refreshFulfillmentStock(admin, shop, order.locationId, fulfillmentId);
  } catch (error) {
    console.error(
      `Refreshing stock after fulfillment ${fulfillmentId} failed`,
      error,
    );
  }
}
