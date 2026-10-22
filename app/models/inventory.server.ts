import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

export const INVENTORY_PAGE_SIZE = 50;

export type StockStatusFilter = "all" | "mismatch";

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
    // Prisma field references don't support `not`, so express != as < or >.
    const binQuantity = prisma.inventoryLevel.fields.binQuantity;
    filters.push({
      OR: [{ onHand: { lt: binQuantity } }, { onHand: { gt: binQuantity } }],
    });
  }
  if (query) {
    // SQLite LIKE: case-insensitive for ASCII. Scans the shop's location rows;
    // move to full-text search if catalogs grow large.
    filters.push({
      OR: [
        { productTitle: { contains: query } },
        { variantTitle: { contains: query } },
        { sku: { contains: query } },
        { barcode: { contains: query } },
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

// Replaces the shop's local inventory copy with the given location's levels (rows
// of a previously selected location are dropped) in a single transaction, and
// recomputes the bin totals in one statement.
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
      await tx.$executeRaw`
        UPDATE "InventoryLevel" SET "binQuantity" = COALESCE((
          SELECT SUM(bs."quantity") FROM "BinStock" bs
          JOIN "Bin" b ON b."id" = bs."binId"
          WHERE b."shop" = "InventoryLevel"."shop"
            AND b."locationId" = "InventoryLevel"."locationId"
            AND bs."inventoryItemId" = "InventoryLevel"."inventoryItemId"
        ), 0)
        WHERE "shop" = ${shop} AND "locationId" = ${locationId}`;
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
  const binTotal = await prisma.binStock.aggregate({
    where: {
      shop,
      inventoryItemId: level.inventoryItemId,
      bin: { locationId },
    },
    _sum: { quantity: true },
  });
  const binQuantity = binTotal._sum.quantity ?? 0;

  return prisma.inventoryLevel.upsert({
    where: {
      shop_locationId_inventoryItemId: {
        shop,
        locationId,
        inventoryItemId: level.inventoryItemId,
      },
    },
    create: { ...level, shop, locationId, binQuantity },
    update: { ...level, binQuantity },
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
