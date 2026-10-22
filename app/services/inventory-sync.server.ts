import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  deleteInventoryLevel,
  replaceInventoryLevels,
  upsertInventoryLevel,
  type InventoryLevelInput,
} from "../models/inventory.server";

// Item selection for the bulk query; keep in sync with ITEM_LEVEL_QUERY so both
// map through toInventoryLevel.
const ITEM_FIELDS = `
  id
  sku
  tracked
  variant {
    id
    title
    barcode
    product {
      id
      title
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

const BULK_RUN_MUTATION = `#graphql
  mutation InventorySyncRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
      }
      userErrors {
        message
      }
    }
  }
`;

const BULK_STATUS_QUERY = `#graphql
  query InventorySyncStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        status
        errorCode
        url
      }
    }
  }
`;

const ITEM_LEVEL_QUERY = `#graphql
  query InventorySyncItem($itemId: ID!, $locationId: ID!) {
    inventoryItem(id: $itemId) {
      id
      sku
      tracked
      variant {
        id
        title
        barcode
        product {
          id
          title
          featuredMedia {
            preview {
              image {
                url
              }
            }
          }
        }
      }
      inventoryLevel(locationId: $locationId) {
        quantities(names: ["on_hand"]) {
          quantity
        }
      }
    }
  }
`;

function bulkInventoryQuery(locationId: string) {
  return `{
    location(id: ${JSON.stringify(locationId)}) {
      inventoryLevels {
        edges {
          node {
            quantities(names: ["on_hand"]) {
              quantity
            }
            item {
              ${ITEM_FIELDS}
            }
          }
        }
      }
    }
  }`;
}

type ItemNode = {
  id: string;
  sku?: string | null;
  variant?: {
    id: string;
    title: string;
    barcode?: string | null;
    product: {
      id: string;
      title: string;
      featuredMedia?: {
        preview?: { image?: { url: string } | null } | null;
      } | null;
    };
  } | null;
};

// Parent (configurable) products imported from Magento as standalone products.
const PARENT_SKU_PREFIX = "config_";

// Only tracked, sellable variants take part in inventory and picking.
function isManagedItem(item: {
  tracked?: boolean | null;
  sku?: string | null;
}) {
  return (
    !!item.tracked && !item.sku?.toLowerCase().startsWith(PARENT_SKU_PREFIX)
  );
}

function toInventoryLevel(item: ItemNode, onHand: number): InventoryLevelInput {
  const variant = item.variant;
  return {
    inventoryItemId: item.id,
    variantId: variant?.id ?? null,
    productId: variant?.product.id ?? null,
    productTitle: variant?.product.title ?? item.sku ?? item.id,
    variantTitle:
      variant && variant.title !== "Default Title" ? variant.title : null,
    sku: item.sku || null,
    barcode: variant?.barcode || null,
    imageUrl: variant?.product.featuredMedia?.preview?.image?.url ?? null,
    onHand,
  };
}

// Starts a full sync of the location's inventory. The result is processed when
// Shopify sends bulk_operations/finish (see completeInventorySync).
export async function startInventorySync(
  admin: AdminApiContext,
  shop: string,
  locationId: string,
) {
  const response = await admin.graphql(BULK_RUN_MUTATION, {
    variables: { query: bulkInventoryQuery(locationId) },
  });
  const { data } = await response.json();
  const result = data?.bulkOperationRunQuery;
  const operationId = result?.bulkOperation?.id;

  // Leave the stored state alone: a sync that is already running stays tracked.
  if (!operationId) {
    const message = result?.userErrors?.[0]?.message ?? "Unknown error";
    throw new Error(`Inventory sync failed to start: ${message}`);
  }

  await prisma.shop.update({
    where: { shop },
    data: { syncStatus: "RUNNING", syncOperationId: operationId },
  });
}

export async function completeInventorySync(
  admin: AdminApiContext,
  shop: string,
  operationId: string,
) {
  const settings = await prisma.shop.findUnique({ where: { shop } });
  // Ignore operations we didn't start or that a newer sync superseded.
  if (!settings?.locationId || settings.syncOperationId !== operationId) {
    return;
  }

  const response = await admin.graphql(BULK_STATUS_QUERY, {
    variables: { id: operationId },
  });
  const { data } = await response.json();
  const operation = data?.node;

  if (operation?.status !== "COMPLETED") {
    console.error(
      `Inventory sync ${operationId} for ${shop} ended with ${operation?.status} (${operation?.errorCode})`,
    );
    await prisma.shop.update({
      where: { shop },
      data: { syncStatus: "FAILED" },
    });
    return;
  }

  // No url means the location has no inventory levels.
  const levels: InventoryLevelInput[] = [];
  if (operation.url) {
    const jsonl = await (await fetch(operation.url)).text();
    for (const line of jsonl.split("\n")) {
      if (!line) continue;
      const node = JSON.parse(line);
      if (!node.item) continue; // the root location object
      if (!isManagedItem(node.item)) continue;
      levels.push(
        toInventoryLevel(node.item, node.quantities?.[0]?.quantity ?? 0),
      );
    }
  }

  await replaceInventoryLevels(shop, settings.locationId, levels);
  await prisma.shop.update({
    where: { shop },
    data: { syncStatus: "COMPLETED", syncedAt: new Date() },
  });
}

// Refreshes one item after an inventory_levels/update or inventory_items/update
// webhook. The webhooks don't carry on-hand, so it is read from the API. Items no
// longer managed (see isManagedItem) or stocked at the location are removed.
export async function syncInventoryItem(
  admin: AdminApiContext,
  shop: string,
  locationId: string,
  inventoryItemId: string,
) {
  const response = await admin.graphql(ITEM_LEVEL_QUERY, {
    variables: { itemId: inventoryItemId, locationId },
  });
  const { data } = await response.json();
  const item = data?.inventoryItem;
  if (!item || !isManagedItem(item) || !item.inventoryLevel) {
    await deleteInventoryLevel(shop, locationId, inventoryItemId);
    return;
  }

  await upsertInventoryLevel(
    shop,
    locationId,
    toInventoryLevel(item, item.inventoryLevel.quantities?.[0]?.quantity ?? 0),
  );
}
