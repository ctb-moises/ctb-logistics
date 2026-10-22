import prisma from "../db.server";
import { dayKey, lastDays, startOfDay } from "../utils/time-zone";

const HOUR_MS = 60 * 60 * 1000;
// A round still in progress after this long probably holds orders for nothing.
const STALE_ROUND_MS = 2 * HOUR_MS;
// Packed in pack-and-fulfill mode but not fulfilled after this long.
const LATE_FULFILLMENT_MS = 24 * HOUR_MS;
const TREND_DAYS = 7;
const FAST_MOVERS = 5;

// Everything the dashboard shows, from the app's own tables: a fixed number of
// aggregated queries run in parallel, whatever the volume.
export async function getDashboard(
  shop: string,
  locationId: string,
  timeZone: string,
) {
  const now = new Date();
  const todayStart = startOfDay(now, timeZone);
  const days = lastDays(TREND_DAYS, timeZone, now);
  const trendStart = startOfDay(
    new Date(now.getTime() - (TREND_DAYS - 1) * 24 * HOUR_MS),
    timeZone,
  );
  const atLocation = { shop, locationId };
  // Boxes of completed rounds still held, i.e. not fulfilled or cancelled yet.
  const heldBox = {
    shop,
    boxKey: { not: null },
    round: { status: "COMPLETED", locationId },
  } as const;
  const noShortage = {
    lines: { none: { tasks: { some: { short: { gt: 0 } } } } },
  };

  const [
    roundsInProgress,
    ordersInPicking,
    toPack,
    toFulfill,
    withMissing,
    staleRounds,
    lateFulfillments,
    inventory,
    rounds,
    packed,
    fastMovers,
  ] = await Promise.all([
    prisma.pickingRound.count({
      where: { ...atLocation, status: "IN_PROGRESS" },
    }),
    prisma.pickingOrder.count({
      where: { shop, round: { status: "IN_PROGRESS", locationId } },
    }),
    prisma.pickingOrder.count({
      where: { ...heldBox, packedAt: null, ...noShortage },
    }),
    prisma.pickingOrder.count({
      where: {
        ...heldBox,
        packedAt: { not: null },
        fulfillAfterPacking: true,
        fulfilledAt: null,
      },
    }),
    prisma.pickingOrder.count({
      where: {
        ...heldBox,
        packedAt: null,
        lines: { some: { tasks: { some: { short: { gt: 0 } } } } },
      },
    }),
    prisma.pickingRound.findMany({
      where: {
        ...atLocation,
        status: "IN_PROGRESS",
        createdAt: { lt: new Date(now.getTime() - STALE_ROUND_MS) },
      },
      orderBy: { createdAt: "asc" },
      take: 3,
      select: {
        id: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    }),
    prisma.pickingOrder.count({
      where: {
        ...heldBox,
        fulfillAfterPacking: true,
        fulfilledAt: null,
        packedAt: { lt: new Date(now.getTime() - LATE_FULFILLMENT_MS) },
      },
    }),
    prisma.$queryRaw<
      {
        products: bigint;
        consolidated: bigint | null;
        unaccounted: bigint | null;
        excess: bigint | null;
        withoutBin: bigint | null;
        inBoxes: bigint | null;
      }[]
    >`
      SELECT COUNT(*) AS products,
        SUM("onHand" = "accountedQuantity") AS consolidated,
        SUM(MAX("onHand" - "accountedQuantity", 0)) AS unaccounted,
        SUM(MAX("accountedQuantity" - "onHand", 0)) AS excess,
        SUM("onHand" > 0 AND "binQuantity" = 0) AS withoutBin,
        SUM("boxQuantity") AS inBoxes
      FROM "InventoryLevel"
      WHERE "shop" = ${shop} AND "locationId" = ${locationId}`,
    // Completed rounds of the trend window with their orders and units.
    prisma.$queryRaw<
      {
        createdAt: Date | number;
        completedAt: Date | number;
        orders: bigint;
        picked: bigint | null;
        short: bigint | null;
      }[]
    >`
      SELECT r."createdAt", r."completedAt",
        (SELECT COUNT(*) FROM "PickingOrder" o WHERE o."roundId" = r."id") AS orders,
        SUM(t."picked") AS picked, SUM(t."short") AS short
      FROM "PickingRound" r
      LEFT JOIN "PickingTask" t ON t."roundId" = r."id"
      WHERE r."shop" = ${shop} AND r."locationId" = ${locationId}
        AND r."completedAt" >= ${trendStart}
      GROUP BY r."id"`,
    prisma.pickingOrder.findMany({
      where: {
        shop,
        round: { locationId },
        OR: [
          { packedAt: { gte: todayStart } },
          { fulfilledAt: { gte: todayStart } },
        ],
      },
      select: { packedAt: true, fulfilledAt: true },
    }),
    prisma.$queryRaw<
      {
        inventoryItemId: string;
        productTitle: string;
        sku: string | null;
        imageUrl: string | null;
        units: bigint;
        orders: bigint;
      }[]
    >`
      SELECT l."inventoryItemId", l."productTitle", l."sku", l."imageUrl",
        SUM(t."picked") AS units, COUNT(DISTINCT l."pickingOrderId") AS orders
      FROM "PickingTask" t
      JOIN "PickingLine" l ON l."id" = t."lineId"
      JOIN "PickingRound" r ON r."id" = t."roundId"
      WHERE r."shop" = ${shop} AND r."locationId" = ${locationId}
        AND r."completedAt" >= ${trendStart} AND t."picked" > 0
      GROUP BY l."inventoryItemId"
      ORDER BY units DESC
      LIMIT ${FAST_MOVERS}`,
  ]);

  // Where the fast movers live now: their fullest bin, one query.
  const moverBins = await prisma.binStock.findMany({
    where: {
      shop,
      inventoryItemId: { in: fastMovers.map((mover) => mover.inventoryItemId) },
      quantity: { gt: 0 },
      bin: { locationId },
    },
    orderBy: { quantity: "desc" },
    select: { inventoryItemId: true, bin: { select: { code: true } } },
  });
  const mainBin = new Map<string, string>();
  for (const stock of moverBins) {
    if (!mainBin.has(stock.inventoryItemId)) {
      mainBin.set(stock.inventoryItemId, stock.bin.code);
    }
  }

  // SQLite returns raw dates as epoch ms.
  const toDate = (value: Date | number) => new Date(value);
  const todayKey = dayKey(now, timeZone);
  const pickedByDay = new Map(days.map((day) => [day.key, 0]));
  let today = { orders: 0, units: 0, missing: 0 };
  let roundMinutes = 0;
  let weekUnits = 0;
  for (const round of rounds) {
    const completedAt = toDate(round.completedAt);
    const key = dayKey(completedAt, timeZone);
    const orders = Number(round.orders);
    const units = Number(round.picked ?? 0);
    pickedByDay.set(key, (pickedByDay.get(key) ?? 0) + orders);
    roundMinutes +=
      (completedAt.getTime() - toDate(round.createdAt).getTime()) / 60000;
    weekUnits += units;
    if (key === todayKey) {
      today = {
        orders: today.orders + orders,
        units: today.units + units,
        missing: today.missing + Number(round.short ?? 0),
      };
    }
  }

  const [health] = inventory;
  const products = Number(health?.products ?? 0);
  const consolidated = Number(health?.consolidated ?? 0);

  return {
    flow: {
      roundsInProgress,
      ordersInPicking,
      toPack,
      toFulfill,
      packedToday: packed.filter((o) => o.packedAt && o.packedAt >= todayStart)
        .length,
      fulfilledToday: packed.filter(
        (o) => o.fulfilledAt && o.fulfilledAt >= todayStart,
      ).length,
    },
    today,
    pace: {
      rounds: rounds.length,
      averageRoundMinutes:
        rounds.length > 0 ? Math.round(roundMinutes / rounds.length) : null,
      unitsPerHour:
        roundMinutes > 0 ? Math.round(weekUnits / (roundMinutes / 60)) : null,
    },
    attention: {
      staleRounds: staleRounds.map((round) => ({
        id: round.id,
        orders: round._count.orders,
        hours: Math.floor(
          (now.getTime() - round.createdAt.getTime()) / HOUR_MS,
        ),
      })),
      withMissing,
      lateFulfillments,
      mismatched: products - consolidated,
    },
    inventory: {
      products,
      consolidated,
      unaccounted: Number(health?.unaccounted ?? 0),
      excess: Number(health?.excess ?? 0),
      withoutBin: Number(health?.withoutBin ?? 0),
      inBoxes: Number(health?.inBoxes ?? 0),
    },
    trend: days.map((day) => ({
      ...day,
      orders: pickedByDay.get(day.key) ?? 0,
    })),
    fastMovers: fastMovers.map((mover) => ({
      inventoryItemId: mover.inventoryItemId,
      productTitle: mover.productTitle,
      sku: mover.sku,
      imageUrl: mover.imageUrl,
      units: Number(mover.units),
      orders: Number(mover.orders),
      bin: mainBin.get(mover.inventoryItemId) ?? null,
    })),
  };
}
