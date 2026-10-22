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
