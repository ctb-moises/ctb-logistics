import prisma from "../db.server";
import { sameBarcode } from "../utils/barcodes";

// Packing: checking a picked order's units into its parcel, then (optionally)
// recording its fulfillment.

export class PackingError extends Error {}

const boxKey = (shop: string, boxCode: string) => `${shop}|${boxCode}`;

const linesWithPicked = {
  select: {
    id: true,
    productTitle: true,
    variantTitle: true,
    sku: true,
    barcode: true,
    imageUrl: true,
    packed: true,
    tasks: { select: { picked: true, short: true } },
  },
  orderBy: { productTitle: "asc" },
} as const;

// Packing is done once packed, plus fulfilled if it was packed in pack-and-
// fulfill mode (or fulfilled/cancelled in Shopify meanwhile, which frees the box).
export function isPackingDone(order: {
  packedAt: Date | null;
  fulfillAfterPacking: boolean;
  fulfilledAt: Date | null;
  boxKey: string | null;
}) {
  return (
    order.packedAt !== null &&
    (!order.fulfillAfterPacking ||
      order.fulfilledAt !== null ||
      order.boxKey === null)
  );
}

type BoxLookup =
  | { status: "ready"; id: number }
  | {
      status: "not-found" | "picking" | "incomplete" | "done";
      orderName?: string;
      roundId?: number;
    };

// The order in a box, if it can be packed now: its round is completed, every
// unit was picked, and its packing isn't done yet (see isPackingDone).
export async function findBoxForPacking(
  shop: string,
  boxCode: string,
): Promise<BoxLookup> {
  const order = await prisma.pickingOrder.findUnique({
    where: { boxKey: boxKey(shop, boxCode) },
    select: {
      id: true,
      orderName: true,
      roundId: true,
      boxKey: true,
      packedAt: true,
      fulfillAfterPacking: true,
      fulfilledAt: true,
      round: { select: { status: true } },
      lines: { select: { tasks: { select: { short: true } } } },
    },
  });
  if (!order) return { status: "not-found" };
  const info = { orderName: order.orderName, roundId: order.roundId };
  if (order.round.status !== "COMPLETED") return { status: "picking", ...info };
  if (order.lines.some((line) => line.tasks.some((task) => task.short > 0))) {
    return { status: "incomplete", ...info };
  }
  if (isPackingDone(order)) return { status: "done", ...info };
  return { status: "ready", id: order.id };
}

// Boxes of completed rounds at the location still to pack, or packed in
// pack-and-fulfill mode and waiting to be fulfilled. Oldest rounds first.
export async function listBoxesToPack(shop: string, locationId: string) {
  return prisma.pickingOrder.findMany({
    where: {
      shop,
      boxKey: { not: null },
      round: { status: "COMPLETED", locationId },
      lines: { none: { tasks: { some: { short: { gt: 0 } } } } },
      OR: [
        { packedAt: null },
        { fulfillAfterPacking: true, fulfilledAt: null },
      ],
    },
    orderBy: [{ round: { completedAt: "asc" } }, { slot: "asc" }],
    take: 50,
    select: {
      id: true,
      orderName: true,
      boxCode: true,
      roundId: true,
      packedAt: true,
      itemCount: true,
    },
  });
}

// The order being packed with its lines; `expected` is what was picked.
export async function getPackingOrder(shop: string, id: number) {
  const order = await prisma.pickingOrder.findFirst({
    where: { id, shop },
    select: {
      id: true,
      orderId: true,
      orderName: true,
      boxCode: true,
      boxKey: true,
      packedAt: true,
      packedTaggedAt: true,
      fulfillAfterPacking: true,
      fulfilledAt: true,
      trackingCompany: true,
      trackingNumber: true,
      round: { select: { id: true, status: true, locationId: true } },
      lines: linesWithPicked,
    },
  });
  if (!order) return null;
  return {
    ...order,
    lines: order.lines.map(({ tasks, ...line }) => ({
      ...line,
      expected: tasks.reduce((sum, task) => sum + task.picked, 0),
      short: tasks.reduce((sum, task) => sum + task.short, 0),
    })),
  };
}

// Checks one unit into the parcel: a scanned barcode, or a line validated by
// hand (+). Returns whether the order is now fully packed (it is then marked
// packed, once, recording whether it still has to be fulfilled from the app).
export async function packUnit(
  shop: string,
  pickingOrderId: number,
  unit: { barcode: string } | { lineId: number },
  userId: string | null,
  fulfillAfterPacking: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.pickingOrder.findFirst({
      where: {
        id: pickingOrderId,
        shop,
        packedAt: null,
        round: { status: "COMPLETED" },
      },
      select: { lines: linesWithPicked },
    });
    if (!order) throw new PackingError("This order is already packed.");

    const lines = order.lines.map((line) => ({
      ...line,
      expected: line.tasks.reduce((sum, task) => sum + task.picked, 0),
    }));
    const matching = lines.filter((line) =>
      "lineId" in unit
        ? line.id === unit.lineId
        : sameBarcode(line.barcode, unit.barcode),
    );
    if (matching.length === 0) {
      throw new PackingError(
        "lineId" in unit
          ? "This product isn't in this order."
          : `Barcode ${unit.barcode} isn't a product of this order.`,
      );
    }
    const line = matching.find((l) => l.packed < l.expected);
    if (!line) {
      throw new PackingError(
        `Every unit of ${matching[0].productTitle} is already packed.`,
      );
    }

    // Conditional on the value read, so concurrent scans can't over-pack.
    const { count } = await tx.pickingLine.updateMany({
      where: { id: line.id, packed: line.packed },
      data: { packed: { increment: 1 } },
    });
    if (count === 0)
      throw new PackingError("Scanned twice too fast. Try again.");
    line.packed += 1;

    const complete = lines.every((l) => l.packed >= l.expected);
    if (complete) {
      await tx.pickingOrder.updateMany({
        where: { id: pickingOrderId, packedAt: null },
        data: { packedAt: new Date(), packedBy: userId, fulfillAfterPacking },
      });
    }
    return complete;
  });
}

// Takes one unit out of the parcel (a wrong scan), while still packing.
export async function unpackUnit(
  shop: string,
  pickingOrderId: number,
  lineId: number,
) {
  await prisma.pickingLine.updateMany({
    where: {
      id: lineId,
      packed: { gt: 0 },
      pickingOrder: { id: pickingOrderId, shop, packedAt: null },
    },
    data: { packed: { decrement: 1 } },
  });
}

export async function markPackedTagged(pickingOrderId: number) {
  await prisma.pickingOrder.update({
    where: { id: pickingOrderId },
    data: { packedTaggedAt: new Date() },
  });
}

// A fulfillment request still "running" after this long is assumed to have died.
const FULFILLING_LOCK_MS = 2 * 60 * 1000;

// Takes the fulfillment lock of a packed, unfulfilled order. False if another
// request holds it or it's already fulfilled.
export async function startFulfilling(shop: string, pickingOrderId: number) {
  const { count } = await prisma.pickingOrder.updateMany({
    where: {
      id: pickingOrderId,
      shop,
      packedAt: { not: null },
      fulfillAfterPacking: true,
      fulfilledAt: null,
      OR: [
        { fulfillingAt: null },
        { fulfillingAt: { lt: new Date(Date.now() - FULFILLING_LOCK_MS) } },
      ],
    },
    data: { fulfillingAt: new Date() },
  });
  return count > 0;
}

export async function finishFulfilling(
  pickingOrderId: number,
  tracking: { company: string | null; number: string | null } | null,
) {
  await prisma.pickingOrder.update({
    where: { id: pickingOrderId },
    data: tracking
      ? {
          fulfillingAt: null,
          fulfilledAt: new Date(),
          trackingCompany: tracking.company,
          trackingNumber: tracking.number,
        }
      : { fulfillingAt: null },
  });
}
