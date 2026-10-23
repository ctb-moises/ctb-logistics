import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { canonicalBarcode } from "../utils/barcodes";

export const INVENTORY_PAGE_SIZE = 50;

export type StockStatusFilter = "all" | "mismatch" | "in-boxes";

export const STOCK_STATUS_FILTERS: StockStatusFilter[] = [
  "all",
  "mismatch",
  "in-boxes",
];

export type InventoryLevelInput = {
  inventoryItemId: string;
  variantId: string | null;
  productId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  onHand: number;
};

type ListInventoryOptions = {
  status: StockStatusFilter;
  query?: string;
  after?: number;
  before?: number;
};

// One indexed query per page (cursor pagination on productTitle, id). Fetches one
// extra row to know whether there is another page in the requested direction.
export async function listInventory(
  shop: string,
  locationId: string,
  { status, query, after, before }: ListInventoryOptions,
) {
  const filters: Prisma.InventoryLevelWhereInput[] = [];
  if (status === "mismatch") {
    // Shopify's on-hand should equal what the app accounts for (bins + boxes).
    // Prisma field references don't support `not`, so express != as < or >.
    const accounted = prisma.inventoryLevel.fields.accountedQuantity;
    filters.push({
      OR: [{ onHand: { lt: accounted } }, { onHand: { gt: accounted } }],
    });
  }
  if (status === "in-boxes") {
    // Picked into boxes whose orders aren't fulfilled yet.
    filters.push({ boxQuantity: { gt: 0 } });
  }
  if (query) {
    // SQLite LIKE: case-insensitive for ASCII. Scans the shop's location rows;
    // move to full-text search if catalogs grow large.
    filters.push({
      OR: [
        { productTitle: { contains: query } },
        { variantTitle: { contains: query } },
        { sku: { contains: query } },
        // GTINs match with or without leading zeros (UPC-A vs EAN-13).
        { barcode: { contains: canonicalBarcode(query) } },
      ],
    });
  }
  const where: Prisma.InventoryLevelWhereInput = {
    shop,
    locationId,
    AND: filters,
  };

  const cursorId = before ?? after;
  const backwards = before !== undefined;
  const rows = await prisma.inventoryLevel.findMany({
    where,
    orderBy: [{ productTitle: "asc" }, { id: "asc" }],
    take: backwards ? -(INVENTORY_PAGE_SIZE + 1) : INVENTORY_PAGE_SIZE + 1,
    ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      inventoryItemId: true,
      productTitle: true,
      variantTitle: true,
      sku: true,
      barcode: true,
      imageUrl: true,
      onHand: true,
      binQuantity: true,
      boxQuantity: true,
      accountedQuantity: true,
    },
  });

  const hasMore = rows.length > INVENTORY_PAGE_SIZE;
  const items = backwards
    ? rows.slice(hasMore ? 1 : 0)
    : rows.slice(0, INVENTORY_PAGE_SIZE);

  // Bins holding each item on this page: one grouped query for the whole page.
  const binCounts = await prisma.binStock.groupBy({
    by: ["inventoryItemId"],
    where: {
      shop,
      inventoryItemId: { in: items.map((item) => item.inventoryItemId) },
      quantity: { gt: 0 },
      bin: { locationId },
    },
    _count: { _all: true },
  });
  const binCountByItem = new Map(
    binCounts.map((row) => [row.inventoryItemId, row._count._all]),
  );

  return {
    items: items.map((item) => ({
      ...item,
      binCount: binCountByItem.get(item.inventoryItemId) ?? 0,
    })),
    hasNextPage: backwards ? true : hasMore,
    hasPreviousPage: backwards ? hasMore : cursorId !== undefined,
  };
}

type LevelKey = { shop: string; locationId: string; inventoryItemId: string };

// Changes an item's app totals by deltas, keeping accountedQuantity in step.
// Call it in the same transaction as the BinStock / picking rows that changed.
export async function adjustLevelTotals(
  tx: Prisma.TransactionClient,
  { shop, locationId, inventoryItemId }: LevelKey,
  { bin = 0, box = 0 }: { bin?: number; box?: number },
) {
  if (bin === 0 && box === 0) return;
  await tx.inventoryLevel.updateMany({
    where: { shop, locationId, inventoryItemId },
    data: {
      binQuantity: { increment: bin },
      boxQuantity: { increment: box },
      accountedQuantity: { increment: bin + box },
    },
  });
}

// Recomputes the app totals from their sources: bin stock, and units picked into
// boxes whose orders aren't fulfilled or cancelled yet. For the whole location,
// or one item. Three statements, whatever the number of rows.
export async function recomputeLevelTotals(
  tx: Prisma.TransactionClient,
  shop: string,
  locationId: string,
  inventoryItemId?: string,
) {
  const itemFilter = inventoryItemId
    ? Prisma.sql`AND "inventoryItemId" = ${inventoryItemId}`
    : Prisma.empty;
  await tx.$executeRaw`
    UPDATE "InventoryLevel" SET "binQuantity" = COALESCE((
      SELECT SUM(bs."quantity") FROM "BinStock" bs
      JOIN "Bin" b ON b."id" = bs."binId"
      WHERE b."shop" = "InventoryLevel"."shop"
        AND b."locationId" = "InventoryLevel"."locationId"
        AND bs."inventoryItemId" = "InventoryLevel"."inventoryItemId"
    ), 0)
    WHERE "shop" = ${shop} AND "locationId" = ${locationId} ${itemFilter}`;
  await tx.$executeRaw`
    UPDATE "InventoryLevel" SET "boxQuantity" = COALESCE((
      SELECT SUM(t."picked") FROM "PickingTask" t
      JOIN "PickingLine" l ON l."id" = t."lineId"
      JOIN "PickingOrder" o ON o."id" = l."pickingOrderId"
      JOIN "PickingRound" r ON r."id" = t."roundId"
      WHERE r."shop" = "InventoryLevel"."shop"
        AND r."locationId" = "InventoryLevel"."locationId"
        AND l."inventoryItemId" = "InventoryLevel"."inventoryItemId"
        AND o."releasedAt" IS NULL
    ), 0)
    WHERE "shop" = ${shop} AND "locationId" = ${locationId} ${itemFilter}`;
  await tx.$executeRaw`
    UPDATE "InventoryLevel" SET "accountedQuantity" = "binQuantity" + "boxQuantity"
    WHERE "shop" = ${shop} AND "locationId" = ${locationId} ${itemFilter}`;
}

// Replaces the shop's local inventory copy with the given location's levels (rows
// of a previously selected location are dropped) in a single transaction, and
// recomputes the app totals in a few statements.
export async function replaceInventoryLevels(
  shop: string,
  locationId: string,
  levels: InventoryLevelInput[],
) {
  const CHUNK = 500;
  await prisma.$transaction(
    async (tx) => {
      await tx.inventoryLevel.deleteMany({ where: { shop } });
      for (let i = 0; i < levels.length; i += CHUNK) {
        await tx.inventoryLevel.createMany({
          data: levels
            .slice(i, i + CHUNK)
            .map((level) => ({ ...level, shop, locationId })),
        });
      }
      await recomputeLevelTotals(tx, shop, locationId);
    },
    { timeout: 120_000 },
  );
}

// Upserts a single item (inventory_levels/update webhook).
export async function upsertInventoryLevel(
  shop: string,
  locationId: string,
  level: InventoryLevelInput,
) {
  await prisma.$transaction(async (tx) => {
    await tx.inventoryLevel.upsert({
      where: {
        shop_locationId_inventoryItemId: {
          shop,
          locationId,
          inventoryItemId: level.inventoryItemId,
        },
      },
      create: { ...level, shop, locationId },
      update: level,
    });
    await recomputeLevelTotals(tx, shop, locationId, level.inventoryItemId);
  });
}

export async function deleteInventoryLevel(
  shop: string,
  locationId: string,
  inventoryItemId: string,
) {
  return prisma.inventoryLevel.deleteMany({
    where: { shop, locationId, inventoryItemId },
  });
}

// Sets Shopify's on-hand for several items read from the API (absolute values).
export async function setOnHand(
  shop: string,
  locationId: string,
  onHand: Map<string, number>,
) {
  if (onHand.size === 0) return;
  await prisma.$transaction(
    [...onHand].map(([inventoryItemId, quantity]) =>
      prisma.inventoryLevel.updateMany({
        where: { shop, locationId, inventoryItemId },
        data: { onHand: quantity },
      }),
    ),
  );
}
