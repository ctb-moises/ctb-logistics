import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import type { FinancialStatus, PickingStatus } from "../utils/picking";

export const PICKING_PAGE_SIZE = 50;

export type PickingFilters = {
  financialStatus: FinancialStatus;
  orderTag: string | null;
  orderLimit: number;
};

export type ReservableOrder = {
  orderId: string;
  orderName: string;
  orderCreatedAt: Date;
  itemCount: number;
};

// Another round reserved one of the orders between checking and writing.
export class OrdersTakenError extends Error {}

export class BoxError extends Error {}

const reservationKey = (shop: string, orderId: string) => `${shop}|${orderId}`;
const boxKey = (shop: string, boxCode: string) => `${shop}|${boxCode}`;

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function getPickingRound(shop: string, id: number) {
  return prisma.pickingRound.findFirst({ where: { id, shop } });
}

// Round with its orders (oldest first) in one query.
export async function getRoundWithOrders(shop: string, id: number) {
  return prisma.pickingRound.findFirst({
    where: { id, shop },
    include: {
      orders: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          orderId: true,
          orderName: true,
          orderCreatedAt: true,
          itemCount: true,
          boxCode: true,
        },
      },
    },
  });
}

// Which of these orders are reserved by a round other than `roundId`.
export async function findOrdersReservedElsewhere(
  shop: string,
  roundId: number | null,
  orderIds: string[],
) {
  if (orderIds.length === 0) return new Set<string>();
  const rows = await prisma.pickingOrder.findMany({
    where: {
      reservationKey: { in: orderIds.map((id) => reservationKey(shop, id)) },
      ...(roundId !== null ? { NOT: { roundId } } : {}),
    },
    select: { orderId: true },
  });
  return new Set(rows.map((row) => row.orderId));
}

function orderRows(shop: string, roundId: number, orders: ReservableOrder[]) {
  return orders.map((order, position) => ({
    ...order,
    shop,
    roundId,
    position,
    reservationKey: reservationKey(shop, order.orderId),
  }));
}

// Creates a round holding `orders`, atomically. The unique reservation key makes
// the insert fail if a concurrent round took one of them.
export async function createRoundWithOrders(
  shop: string,
  locationId: string,
  createdBy: string | null,
  filters: PickingFilters,
  orders: ReservableOrder[],
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const round = await tx.pickingRound.create({
        data: { shop, locationId, createdBy, ...filters },
        select: { id: true },
      });
      await tx.pickingOrder.createMany({
        data: orderRows(shop, round.id, orders),
      });
      return round;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new OrdersTakenError();
    throw error;
  }
}

// Changes an in-progress round's filters and replaces its orders, atomically.
// Only allowed before any box is assigned. Returns false if not allowed.
export async function replaceRoundOrders(
  shop: string,
  roundId: number,
  filters: PickingFilters,
  orders: ReservableOrder[],
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const { count } = await tx.pickingRound.updateMany({
        where: {
          id: roundId,
          shop,
          status: "IN_PROGRESS",
          orders: { none: { boxCode: { not: null } } },
        },
        data: filters,
      });
      if (count === 0) return false;
      await tx.pickingOrder.deleteMany({ where: { roundId } });
      await tx.pickingOrder.createMany({
        data: orderRows(shop, roundId, orders),
      });
      return true;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new OrdersTakenError();
    throw error;
  }
}

// Deletes an in-progress round; its orders and boxes are released with it.
export async function cancelRound(shop: string, roundId: number) {
  const { count } = await prisma.pickingRound.deleteMany({
    where: { id: roundId, shop, status: "IN_PROGRESS" },
  });
  return count > 0;
}

// Puts an order of an in-progress round into a box. A box holds one order until
// that order is fulfilled or cancelled (boxKey is unique while set).
export async function assignBox(
  shop: string,
  roundId: number,
  pickingOrderId: number,
  boxCode: string,
) {
  const key = boxKey(shop, boxCode);
  const holder = await prisma.pickingOrder.findUnique({
    where: { boxKey: key },
    select: { id: true, orderName: true, roundId: true },
  });
  if (holder) {
    if (holder.id === pickingOrderId) return;
    throw new BoxError(
      `Box ${boxCode} is in use by order ${holder.orderName} (round #${holder.roundId}).`,
    );
  }

  try {
    const { count } = await prisma.pickingOrder.updateMany({
      where: {
        id: pickingOrderId,
        roundId,
        shop,
        boxCode: null,
        round: { status: "IN_PROGRESS" },
      },
      data: { boxCode, boxKey: key, boxAssignedAt: new Date() },
    });
    if (count === 0) throw new BoxError("This order already has a box.");
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new BoxError(`Box ${boxCode} was just used for another order.`);
    }
    throw error;
  }
}

export async function clearBox(
  shop: string,
  roundId: number,
  pickingOrderId: number,
) {
  await prisma.pickingOrder.updateMany({
    where: {
      id: pickingOrderId,
      roundId,
      shop,
      round: { status: "IN_PROGRESS" },
    },
    data: { boxCode: null, boxKey: null, boxAssignedAt: null },
  });
}

// Shopify fulfilled or cancelled the order: free its box. A cancelled order also
// stops being reserved.
export async function releaseOrder(
  shop: string,
  orderId: string,
  { cancelled }: { cancelled: boolean },
) {
  await prisma.pickingOrder.updateMany({
    where: {
      shop,
      orderId,
      OR: [{ boxKey: { not: null } }, { reservationKey: { not: null } }],
    },
    data: {
      boxKey: null,
      releasedAt: new Date(),
      ...(cancelled ? { reservationKey: null } : {}),
    },
  });
}

// Newest first, one query per page (cursor pagination on id). Fetches one extra
// row to know whether there is another page in the requested direction.
export async function listPickingRounds(
  shop: string,
  {
    status,
    after,
    before,
  }: { status: PickingStatus | null; after?: number; before?: number },
) {
  const where: Prisma.PickingRoundWhereInput = { shop };
  if (status) where.status = status;

  const cursorId = before ?? after;
  const backwards = before !== undefined;
  const rows = await prisma.pickingRound.findMany({
    where,
    orderBy: { id: "desc" },
    take: backwards ? -(PICKING_PAGE_SIZE + 1) : PICKING_PAGE_SIZE + 1,
    ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      financialStatus: true,
      orderTag: true,
      orderLimit: true,
      createdAt: true,
      _count: { select: { orders: true } },
    },
  });

  const hasMore = rows.length > PICKING_PAGE_SIZE;
  return {
    rounds: backwards
      ? rows.slice(hasMore ? 1 : 0)
      : rows.slice(0, PICKING_PAGE_SIZE),
    hasNextPage: backwards ? true : hasMore,
    hasPreviousPage: backwards ? hasMore : cursorId !== undefined,
  };
}
