import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  createRoundWithOrders,
  findOrdersReservedElsewhere,
  OrdersTakenError,
  replaceRoundOrders,
  type PickingFilters,
  type ReservableOrder,
} from "../models/picking.server";
import { fetchCandidateOrders } from "./shopify-orders.server";

// Stop scanning Shopify after this many pages (50 orders each) per attempt.
const MAX_ORDER_PAGES = 20;
// Retries when a concurrent round reserves one of the selected orders first.
const MAX_ATTEMPTS = 3;

// Oldest matching orders not reserved by another round, up to the limit. Each
// page costs one Shopify query and one database query.
async function findFreeOrders(
  admin: AdminApiContext,
  shop: string,
  locationId: string,
  filters: PickingFilters,
  roundId: number | null,
) {
  const selected: ReservableOrder[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const result = await fetchCandidateOrders(
      admin,
      locationId,
      filters,
      after,
    );
    const reserved = await findOrdersReservedElsewhere(
      shop,
      roundId,
      result.orders.map((order) => order.orderId),
    );
    for (const order of result.orders) {
      if (!reserved.has(order.orderId)) selected.push(order);
      if (selected.length === filters.orderLimit) return selected;
    }
    if (!result.hasNextPage) break;
    after = result.endCursor;
  }
  return selected;
}

type ReserveResult =
  | { ok: true; roundId: number; reserved: number }
  | { ok: false; reason: "no-orders" | "has-boxes" };

// Reserves orders for a new round (roundId null) or re-reserves them for an
// existing in-progress round after its filters change.
export async function reserveRoundOrders(
  admin: AdminApiContext,
  shop: string,
  locationId: string,
  createdBy: string | null,
  filters: PickingFilters,
  roundId: number | null,
): Promise<ReserveResult> {
  for (let attempt = 1; ; attempt++) {
    const orders = await findFreeOrders(
      admin,
      shop,
      locationId,
      filters,
      roundId,
    );
    if (orders.length === 0) return { ok: false, reason: "no-orders" };

    try {
      if (roundId === null) {
        const round = await createRoundWithOrders(
          shop,
          locationId,
          createdBy,
          filters,
          orders,
        );
        return { ok: true, roundId: round.id, reserved: orders.length };
      }
      const replaced = await replaceRoundOrders(shop, roundId, filters, orders);
      return replaced
        ? { ok: true, roundId, reserved: orders.length }
        : { ok: false, reason: "has-boxes" };
    } catch (error) {
      if (!(error instanceof OrdersTakenError) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
}
