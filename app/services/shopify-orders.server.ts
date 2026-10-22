import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { PickingFilters } from "../models/picking.server";

export const ORDERS_PAGE_SIZE = 50;

const CANDIDATE_ORDERS_QUERY = `#graphql
  query PickingCandidateOrders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {
      nodes {
        id
        name
        createdAt
        currentSubtotalLineItemsQuantity
        fulfillmentOrders(first: 10, query: "status:open") {
          nodes {
            assignedLocation {
              location {
                id
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export type CandidateOrder = {
  orderId: string;
  orderName: string;
  orderCreatedAt: Date;
  itemCount: number;
};

function searchValue(value: string) {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

// Shopify search query for orders a picking round can take.
export function candidateOrdersQuery(filters: PickingFilters) {
  const terms = [
    "status:open",
    "fulfillment_status:unfulfilled",
    `financial_status:${filters.financialStatus}`,
  ];
  if (filters.orderTag) terms.push(`tag:${searchValue(filters.orderTag)}`);
  return terms.join(" ");
}

// One page of matching orders, oldest first, keeping only those with an open
// fulfillment order at the location.
export async function fetchCandidateOrders(
  admin: AdminApiContext,
  locationId: string,
  filters: PickingFilters,
  after: string | null,
) {
  const response = await admin.graphql(CANDIDATE_ORDERS_QUERY, {
    variables: { query: candidateOrdersQuery(filters), after },
  });
  const { data } = await response.json();
  const page = data?.orders;

  const orders: CandidateOrder[] = (page?.nodes ?? [])
    .filter((order) =>
      order.fulfillmentOrders.nodes.some(
        (fulfillmentOrder) =>
          fulfillmentOrder.assignedLocation.location?.id === locationId,
      ),
    )
    .map((order) => ({
      orderId: order.id,
      orderName: order.name,
      orderCreatedAt: new Date(order.createdAt),
      itemCount: order.currentSubtotalLineItemsQuantity,
    }));

  return {
    orders,
    endCursor: page?.pageInfo.endCursor ?? null,
    hasNextPage: page?.pageInfo.hasNextPage ?? false,
  };
}

// 5 orders × 5 fulfillment orders × 50 line items keeps each request well under
// the Admin API query cost limit.
const ORDER_LINES_BATCH = 5;

const ORDER_LINES_QUERY = `#graphql
  query PickingOrderLines($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        fulfillmentOrders(first: 5, query: "status:open") {
          nodes {
            assignedLocation {
              location {
                id
              }
            }
            lineItems(first: 50) {
              nodes {
                inventoryItemId
                remainingQuantity
                requiresShipping
                productTitle
                variantTitle
                sku
                image {
                  url
                }
                variant {
                  id
                  barcode
                }
              }
            }
          }
        }
      }
    }
  }
`;

export type OrderLine = {
  orderId: string;
  inventoryItemId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  quantity: number;
};

// Units still to ship from the location per order and inventory item, from the
// orders' open fulfillment orders. Batched requests; no request per order.
export async function fetchOrderLines(
  admin: AdminApiContext,
  locationId: string,
  orderIds: string[],
) {
  const lines = new Map<string, OrderLine>();

  for (let i = 0; i < orderIds.length; i += ORDER_LINES_BATCH) {
    const response = await admin.graphql(ORDER_LINES_QUERY, {
      variables: { ids: orderIds.slice(i, i + ORDER_LINES_BATCH) },
    });
    const { data } = await response.json();

    for (const node of data?.nodes ?? []) {
      if (!node || !("fulfillmentOrders" in node)) continue;
      for (const fulfillmentOrder of node.fulfillmentOrders.nodes) {
        if (fulfillmentOrder.assignedLocation.location?.id !== locationId) {
          continue;
        }
        for (const item of fulfillmentOrder.lineItems.nodes) {
          if (
            !item.inventoryItemId ||
            !item.requiresShipping ||
            item.remainingQuantity <= 0
          ) {
            continue;
          }
          const key = `${node.id}|${item.inventoryItemId}`;
          const existing = lines.get(key);
          if (existing) {
            existing.quantity += item.remainingQuantity;
            continue;
          }
          lines.set(key, {
            orderId: node.id,
            inventoryItemId: item.inventoryItemId,
            variantId: item.variant?.id ?? null,
            productTitle: item.productTitle,
            variantTitle:
              item.variantTitle && item.variantTitle !== "Default Title"
                ? item.variantTitle
                : null,
            sku: item.sku || null,
            barcode: item.variant?.barcode || null,
            imageUrl: item.image?.url ?? null,
            quantity: item.remainingQuantity,
          });
        }
      }
    }
  }

  return [...lines.values()];
}
