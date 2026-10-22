import prisma from "../db.server";
import { adjustLevelTotals } from "./inventory.server";
import { normalizeBinCode } from "../utils/bins";

export class BinStockError extends Error {
  constructor(
    message: string,
    readonly field: "code" | "quantity",
  ) {
    super(message);
  }
}

// Item header and its bins at the location: two queries, run in parallel.
export async function getInventoryDetail(
  shop: string,
  locationId: string,
  inventoryItemId: string,
) {
  const [level, binStock] = await Promise.all([
    prisma.inventoryLevel.findUnique({
      where: {
        shop_locationId_inventoryItemId: { shop, locationId, inventoryItemId },
      },
    }),
    prisma.binStock.findMany({
      where: { shop, inventoryItemId, bin: { locationId } },
      select: {
        id: true,
        quantity: true,
        bin: { select: { code: true, description: true } },
      },
      orderBy: { bin: { code: "asc" } },
    }),
  ]);
  return level ? { level, binStock } : null;
}

type MovementContext = {
  shop: string;
  locationId: string;
  userId: string | null;
};

// Sets the quantity of an item in a bin. The BinStock row, its StockMovement and
// the item's app totals (InventoryLevel) change in one transaction.
export async function setBinQuantity(
  { shop, locationId, userId }: MovementContext,
  binStockId: number,
  quantity: number,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.binStock.findFirst({
      where: { id: binStockId, shop, bin: { locationId } },
      select: { quantity: true, binId: true, inventoryItemId: true },
    });
    if (!current) throw new BinStockError("Bin not found.", "quantity");

    const delta = quantity - current.quantity;
    if (delta === 0) return;

    await tx.binStock.update({ where: { id: binStockId }, data: { quantity } });
    await tx.stockMovement.create({
      data: {
        shop,
        binId: current.binId,
        inventoryItemId: current.inventoryItemId,
        delta,
        reason: "ADJUST",
        userId,
      },
    });
    await adjustLevelTotals(
      tx,
      { shop, locationId, inventoryItemId: current.inventoryItemId },
      { bin: delta },
    );
  });
}

export async function isMovementApplied(idempotencyKey: string) {
  const movement = await prisma.stockMovement.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  return movement !== null;
}

// Records received units (already added in Shopify) in a bin: creates the bin and
// the bin stock row if needed and raises binQuantity. onHand is set to Shopify's
// absolute value after the change (not incremented), so it can't double count
// with the inventory_levels/update webhook; null leaves it to the webhook.
export async function receiveIntoBin(
  { shop, locationId, userId }: MovementContext,
  item: {
    inventoryItemId: string;
    variantId: string | null;
    sku: string | null;
  },
  binCode: string,
  quantity: number,
  idempotencyKey: string,
  onHandAfter: number | null,
) {
  const code = normalizeBinCode(binCode);

  return prisma.$transaction(async (tx) => {
    const bin = await tx.bin.upsert({
      where: { shop_locationId_code: { shop, locationId, code } },
      create: { shop, locationId, code },
      update: {},
      select: { id: true },
    });
    await tx.binStock.upsert({
      where: {
        binId_inventoryItemId: {
          binId: bin.id,
          inventoryItemId: item.inventoryItemId,
        },
      },
      create: {
        shop,
        binId: bin.id,
        inventoryItemId: item.inventoryItemId,
        variantId: item.variantId,
        sku: item.sku,
        quantity,
      },
      update: { quantity: { increment: quantity } },
    });
    await tx.stockMovement.create({
      data: {
        shop,
        binId: bin.id,
        inventoryItemId: item.inventoryItemId,
        delta: quantity,
        reason: "RECEIVE",
        userId,
        idempotencyKey,
      },
    });
    await adjustLevelTotals(
      tx,
      { shop, locationId, inventoryItemId: item.inventoryItemId },
      { bin: quantity },
    );
    if (onHandAfter !== null) {
      await tx.inventoryLevel.updateMany({
        where: { shop, locationId, inventoryItemId: item.inventoryItemId },
        data: { onHand: onHandAfter },
      });
    }
  });
}

// Puts an item in a bin, creating the bin in this location if it doesn't exist.
export async function addToBin(
  { shop, locationId, userId }: MovementContext,
  item: {
    inventoryItemId: string;
    variantId: string | null;
    sku: string | null;
  },
  binCode: string,
  quantity: number,
) {
  const code = normalizeBinCode(binCode);

  return prisma.$transaction(async (tx) => {
    const bin = await tx.bin.upsert({
      where: { shop_locationId_code: { shop, locationId, code } },
      create: { shop, locationId, code },
      update: {},
      select: { id: true },
    });

    const existing = await tx.binStock.findUnique({
      where: {
        binId_inventoryItemId: {
          binId: bin.id,
          inventoryItemId: item.inventoryItemId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BinStockError(
        `Already in ${code}. Edit its quantity instead.`,
        "code",
      );
    }

    await tx.binStock.create({
      data: {
        shop,
        binId: bin.id,
        inventoryItemId: item.inventoryItemId,
        variantId: item.variantId,
        sku: item.sku,
        quantity,
      },
    });
    await tx.stockMovement.create({
      data: {
        shop,
        binId: bin.id,
        inventoryItemId: item.inventoryItemId,
        delta: quantity,
        reason: "ADJUST",
        userId,
      },
    });
    await adjustLevelTotals(
      tx,
      { shop, locationId, inventoryItemId: item.inventoryItemId },
      { bin: quantity },
    );
  });
}
