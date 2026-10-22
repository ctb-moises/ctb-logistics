import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import type { OrderLine } from "../services/shopify-orders.server";
import { buildPickingPlan } from "../utils/picking-plan";
import { adjustLevelTotals } from "./inventory.server";

// Step 3 of a picking round: the plan (lines + tasks) and picking itself.

export class PickingError extends Error {}

const movementReference = (roundId: number) => `picking-round:${roundId}`;

type Context = { shop: string; userId: string | null };

// Round, orders, lines and tasks for the picking page, in one query.
export async function getPickingRun(shop: string, roundId: number) {
  return prisma.pickingRound.findFirst({
    where: { id: roundId, shop },
    include: {
      orders: {
        orderBy: { slot: "asc" },
        select: { id: true, orderName: true, boxCode: true, slot: true },
      },
      lines: {
        select: {
          id: true,
          pickingOrderId: true,
          inventoryItemId: true,
          productTitle: true,
          variantTitle: true,
          sku: true,
          barcode: true,
          imageUrl: true,
        },
      },
      tasks: {
        orderBy: [{ step: "asc" }, { id: "asc" }],
        select: {
          id: true,
          lineId: true,
          step: true,
          binCode: true,
          quantity: true,
          picked: true,
          short: true,
        },
      },
    },
  });
}

// Saves the plan once: slots in box scan order, lines from Shopify, and tasks
// along the route using current bin stock. Returns false if another request
// already planned the round.
export async function savePickingPlan(
  shop: string,
  roundId: number,
  locationId: string,
  orderLines: OrderLine[],
) {
  return prisma.$transaction(
    async (tx) => {
      const { count } = await tx.pickingRound.updateMany({
        where: { id: roundId, shop, status: "IN_PROGRESS", plannedAt: null },
        data: { plannedAt: new Date() },
      });
      if (count === 0) return false;

      const orders = await tx.pickingOrder.findMany({
        where: { roundId },
        orderBy: [{ boxAssignedAt: "asc" }, { position: "asc" }],
        select: { id: true, orderId: true },
      });
      const slots = new Map(
        orders.map((order, index) => [order.id, index + 1]),
      );
      const pickingOrderIds = new Map(orders.map((o) => [o.orderId, o.id]));
      if (orders.length > 0) {
        await tx.$executeRaw`
          UPDATE "PickingOrder" SET "slot" = CASE "id"
            ${Prisma.join(
              orders.map(
                (o) => Prisma.sql`WHEN ${o.id} THEN ${slots.get(o.id)}`,
              ),
              " ",
            )}
          END
          WHERE "roundId" = ${roundId}`;
      }

      const lines = await tx.pickingLine.createManyAndReturn({
        data: orderLines
          .filter((line) => pickingOrderIds.has(line.orderId))
          .map(({ orderId, ...line }) => ({
            ...line,
            shop,
            roundId,
            pickingOrderId: pickingOrderIds.get(orderId)!,
          })),
        select: {
          id: true,
          pickingOrderId: true,
          inventoryItemId: true,
          productTitle: true,
          quantity: true,
        },
      });

      const binStock = await tx.binStock.findMany({
        where: {
          shop,
          inventoryItemId: {
            in: [...new Set(lines.map((l) => l.inventoryItemId))],
          },
          quantity: { gt: 0 },
          bin: { locationId, active: true },
        },
        select: {
          inventoryItemId: true,
          binId: true,
          quantity: true,
          bin: { select: { code: true } },
        },
      });

      const tasks = buildPickingPlan(
        lines.map((line) => ({
          lineId: line.id,
          inventoryItemId: line.inventoryItemId,
          productTitle: line.productTitle,
          slot: slots.get(line.pickingOrderId)!,
          quantity: line.quantity,
        })),
        binStock.map((stock) => ({
          inventoryItemId: stock.inventoryItemId,
          binId: stock.binId,
          binCode: stock.bin.code,
          quantity: stock.quantity,
        })),
      );
      await tx.pickingTask.createMany({
        data: tasks.map((task) => ({ ...task, shop, roundId })),
      });
      return true;
    },
    { timeout: 30_000 },
  );
}

type TaskWithLine = {
  id: number;
  binId: number | null;
  quantity: number;
  picked: number;
  short: number;
  stockTaken: number;
  line: { inventoryItemId: string };
};

// Moves one unit between a bin and a task: -1 from the bin when picking, +1
// back when undoing, with its movement. Callers update the item totals.
async function moveBinUnit(
  tx: Prisma.TransactionClient,
  { shop, userId }: Context,
  roundId: number,
  task: TaskWithLine,
  delta: 1 | -1,
) {
  if (task.binId === null) return false;
  const inventoryItemId = task.line.inventoryItemId;
  const { count } = await tx.binStock.updateMany({
    where: {
      binId: task.binId,
      inventoryItemId,
      ...(delta < 0 ? { quantity: { gt: 0 } } : {}),
    },
    data: { quantity: { increment: delta } },
  });
  if (count === 0) return false;

  await tx.stockMovement.create({
    data: {
      shop,
      binId: task.binId,
      inventoryItemId,
      delta,
      reason: "PICK",
      reference: movementReference(roundId),
      userId,
    },
  });
  return true;
}

const taskSelect = {
  id: true,
  binId: true,
  quantity: true,
  picked: true,
  short: true,
  stockTaken: true,
  line: {
    select: { inventoryItemId: true, pickingOrder: { select: { slot: true } } },
  },
} as const;

async function lockedRound(
  tx: Prisma.TransactionClient,
  shop: string,
  roundId: number,
) {
  const round = await tx.pickingRound.findFirst({
    where: {
      id: roundId,
      shop,
      status: "IN_PROGRESS",
      plannedAt: { not: null },
    },
    select: { locationId: true },
  });
  if (!round) throw new PickingError("This picking round isn't in progress.");
  return round;
}

// Picks one unit for a step: into the given task, or the next unfinished task in
// cart slot order. Returns whether the step is now complete.
export async function pickUnit(
  context: Context,
  roundId: number,
  step: number,
  taskId: number | null,
) {
  return prisma.$transaction(async (tx) => {
    const { locationId } = await lockedRound(tx, context.shop, roundId);
    const tasks = await tx.pickingTask.findMany({
      where: { roundId, step },
      select: taskSelect,
    });
    tasks.sort(
      (a, b) =>
        (a.line.pickingOrder.slot ?? 0) - (b.line.pickingOrder.slot ?? 0),
    );
    const open = (task: (typeof tasks)[number]) =>
      task.picked + task.short < task.quantity;
    const task =
      taskId !== null ? tasks.find((t) => t.id === taskId) : tasks.find(open);
    if (!task || !open(task)) {
      throw new PickingError(
        "Every unit of this product is already picked here.",
      );
    }

    const taken = await moveBinUnit(tx, context, roundId, task, -1);
    // Conditional on the value read, so concurrent scans can't over-pick.
    const { count } = await tx.pickingTask.updateMany({
      where: { id: task.id, picked: task.picked },
      data: {
        picked: { increment: 1 },
        ...(taken ? { stockTaken: { increment: 1 } } : {}),
      },
    });
    if (count === 0)
      throw new PickingError("Scanned twice too fast. Try again.");
    // The unit leaves its bin (if it was there) and is now in a box.
    await adjustLevelTotals(
      tx,
      {
        shop: context.shop,
        locationId,
        inventoryItemId: task.line.inventoryItemId,
      },
      { bin: taken ? -1 : 0, box: 1 },
    );

    task.picked += 1;
    return tasks.every((t) => !open(t));
  });
}

// Undoes one picked unit of a task, returning it to its bin if it came from it.
export async function unpickUnit(
  context: Context,
  roundId: number,
  taskId: number,
) {
  await prisma.$transaction(async (tx) => {
    const { locationId } = await lockedRound(tx, context.shop, roundId);
    const task = await tx.pickingTask.findFirst({
      where: { id: taskId, roundId, picked: { gt: 0 } },
      select: taskSelect,
    });
    if (!task) return;

    const returned =
      task.stockTaken > 0 && (await moveBinUnit(tx, context, roundId, task, 1));
    const { count } = await tx.pickingTask.updateMany({
      where: { id: task.id, picked: task.picked },
      data: {
        picked: { decrement: 1 },
        ...(returned ? { stockTaken: { decrement: 1 } } : {}),
      },
    });
    if (count === 0) throw new PickingError("Changed meanwhile. Try again.");
    await adjustLevelTotals(
      tx,
      {
        shop: context.shop,
        locationId,
        inventoryItemId: task.line.inventoryItemId,
      },
      { bin: returned ? 1 : 0, box: -1 },
    );
  });
}

// Marks the units still to pick in a step as missing.
export async function skipStep(shop: string, roundId: number, step: number) {
  await prisma.$transaction(async (tx) => {
    await lockedRound(tx, shop, roundId);
    await tx.$executeRaw`
      UPDATE "PickingTask" SET "short" = "quantity" - "picked"
      WHERE "roundId" = ${roundId} AND "step" = ${step}
        AND "picked" + "short" < "quantity"`;
  });
}

// Completes the round once every task is picked or missing. Orders stay
// reserved and boxes in use until Shopify reports the orders fulfilled or
// cancelled: they're still unfulfilled, so another round must not pick them.
export async function completeRoundIfDone(shop: string, roundId: number) {
  const tasks = await prisma.pickingTask.findMany({
    where: { roundId },
    select: { quantity: true, picked: true, short: true },
  });
  if (tasks.some((task) => task.picked + task.short < task.quantity)) {
    return false;
  }
  const { count } = await prisma.pickingRound.updateMany({
    where: { id: roundId, shop, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return count > 0;
}

// Puts back into their bins the units a round took (before cancelling it).
export async function restorePickedStock(
  tx: Prisma.TransactionClient,
  context: Context,
  roundId: number,
  locationId: string,
) {
  // Orders already fulfilled or cancelled were released: their units left the
  // boxes then, and fulfilled ones left the warehouse. Only the rest come back.
  const tasks = await tx.pickingTask.findMany({
    where: {
      roundId,
      picked: { gt: 0 },
      line: { pickingOrder: { releasedAt: null } },
    },
    select: {
      binId: true,
      picked: true,
      stockTaken: true,
      line: { select: { inventoryItemId: true } },
    },
  });
  // Totals per product (units leaving boxes) and per bin and product (units
  // going back): one write each, not one per unit.
  const boxed = new Map<string, number>();
  const returns = new Map<
    string,
    { binId: number; inventoryItemId: string; units: number }
  >();
  for (const task of tasks) {
    const inventoryItemId = task.line.inventoryItemId;
    boxed.set(inventoryItemId, (boxed.get(inventoryItemId) ?? 0) + task.picked);
    if (task.binId === null || task.stockTaken === 0) continue;
    const key = `${task.binId}|${inventoryItemId}`;
    const total = returns.get(key) ?? {
      binId: task.binId,
      inventoryItemId,
      units: 0,
    };
    total.units += task.stockTaken;
    returns.set(key, total);
  }

  const binReturns = new Map<string, number>();
  for (const { binId, inventoryItemId, units } of returns.values()) {
    await tx.binStock.updateMany({
      where: { binId, inventoryItemId },
      data: { quantity: { increment: units } },
    });
    await tx.stockMovement.create({
      data: {
        shop: context.shop,
        binId,
        inventoryItemId,
        delta: units,
        reason: "PICK",
        reference: movementReference(roundId),
        userId: context.userId,
      },
    });
    binReturns.set(
      inventoryItemId,
      (binReturns.get(inventoryItemId) ?? 0) + units,
    );
  }
  for (const [inventoryItemId, units] of boxed) {
    await adjustLevelTotals(
      tx,
      { shop: context.shop, locationId, inventoryItemId },
      { bin: binReturns.get(inventoryItemId) ?? 0, box: -units },
    );
  }
}

// The product a step picks.
export async function getStepProduct(roundId: number, step: number) {
  const task = await prisma.pickingTask.findFirst({
    where: { roundId, step },
    select: { line: { select: { productTitle: true, barcode: true } } },
  });
  return task?.line ?? null;
}

// Which product of the round a scanned barcode belongs to, and its first step
// with units still to pick (to point the picker to it).
export async function findStepByBarcode(roundId: number, barcode: string) {
  const tasks = await prisma.pickingTask.findMany({
    where: { roundId, line: { barcode } },
    orderBy: { step: "asc" },
    select: {
      step: true,
      quantity: true,
      picked: true,
      short: true,
      line: { select: { productTitle: true } },
    },
  });
  if (tasks.length === 0) return null;
  const open = tasks.find((task) => task.picked + task.short < task.quantity);
  return { productTitle: tasks[0].line.productTitle, step: open?.step ?? null };
}

// A round's results by order (cart slot order): each order's lines with what
// was picked, what was missing and from which bins. One query.
export async function getRoundSummary(shop: string, roundId: number) {
  return prisma.pickingRound.findFirst({
    where: { id: roundId, shop },
    include: {
      orders: {
        orderBy: [{ slot: "asc" }, { position: "asc" }],
        select: {
          id: true,
          orderId: true,
          orderName: true,
          orderCreatedAt: true,
          boxCode: true,
          slot: true,
          lines: {
            orderBy: { productTitle: "asc" },
            select: {
              id: true,
              productTitle: true,
              variantTitle: true,
              sku: true,
              imageUrl: true,
              quantity: true,
              tasks: {
                orderBy: { step: "asc" },
                select: { binCode: true, picked: true, short: true },
              },
            },
          },
        },
      },
    },
  });
}
