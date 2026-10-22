import prisma from "../db.server";

// Ensures the shop row exists. Called from afterAuth and before any write that
// depends on the shop (covers shops installed before this table existed).
export async function ensureShop(shop: string) {
  return prisma.shop.upsert({ where: { shop }, create: { shop }, update: {} });
}

export async function getShop(shop: string) {
  return prisma.shop.findUnique({ where: { shop } });
}

export async function setShopLocation(
  shop: string,
  location: { id: string; name: string },
) {
  return prisma.shop.upsert({
    where: { shop },
    create: { shop, locationId: location.id, locationName: location.name },
    update: { locationId: location.id, locationName: location.name },
  });
}

export async function setPickingBatchSizes(shop: string, sizes: number[]) {
  return prisma.shop.update({
    where: { shop },
    data: { pickingBatchSizes: sizes.join(",") },
  });
}

// Removes all shop data (bins, stock and movements cascade).
export async function deleteShopData(shop: string) {
  await prisma.$transaction([
    prisma.shop.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
