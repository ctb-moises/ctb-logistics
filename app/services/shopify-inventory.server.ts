import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const RECEIVE_MUTATION = `#graphql
  mutation ReceiveStock(
    $input: InventoryAdjustQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventoryAdjustQuantities(input: $input)
      @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        # Only the adjusted quantity ("available") is returned unless asked.
        changes(quantityNames: ["on_hand"]) {
          name
          quantityAfterChange
        }
      }
      userErrors {
        code
        message
      }
    }
  }
`;

const ON_HAND_QUERY = `#graphql
  query ReceiveStockOnHand($itemId: ID!, $locationId: ID!) {
    inventoryItem(id: $itemId) {
      inventoryLevel(locationId: $locationId) {
        quantities(names: ["on_hand"]) {
          quantity
        }
      }
    }
  }
`;

export class ShopifyInventoryError extends Error {}

// Adds received units to Shopify's available (and so on-hand) stock. Retrying
// with the same idempotency key is applied once by Shopify. Returns the on-hand
// quantity after the change, read back from Shopify if the response lacks it, so
// the page never shows the stale value.
export async function receiveShopifyStock(
  admin: AdminApiContext,
  change: {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    idempotencyKey: string;
  },
) {
  const response = await admin.graphql(RECEIVE_MUTATION, {
    variables: {
      idempotencyKey: change.idempotencyKey,
      input: {
        name: "available",
        reason: "received",
        referenceDocumentUri: `gid://ctb-logistics/StockReceipt/${change.idempotencyKey}`,
        changes: [
          {
            inventoryItemId: change.inventoryItemId,
            locationId: change.locationId,
            delta: change.quantity,
            // Receiving only adds units, so a concurrent change can't be
            // overwritten; skip the compare-and-swap check.
            changeFromQuantity: null,
          },
        ],
      },
    },
  });
  const { data } = await response.json();
  const result = data?.inventoryAdjustQuantities;
  const error = result?.userErrors?.[0];
  if (error) throw new ShopifyInventoryError(error.message);

  const onHand = result?.inventoryAdjustmentGroup?.changes.find(
    (change) => change.name === "on_hand",
  )?.quantityAfterChange;
  if (onHand != null) return onHand;

  const levelResponse = await admin.graphql(ON_HAND_QUERY, {
    variables: {
      itemId: change.inventoryItemId,
      locationId: change.locationId,
    },
  });
  const level = (await levelResponse.json()).data?.inventoryItem
    ?.inventoryLevel;
  return level?.quantities?.[0]?.quantity ?? null;
}
