-- AlterTable
ALTER TABLE "PickingOrder" ADD COLUMN "fulfilledAt" DATETIME;
ALTER TABLE "PickingOrder" ADD COLUMN "fulfillingAt" DATETIME;
ALTER TABLE "PickingOrder" ADD COLUMN "packedAt" DATETIME;
ALTER TABLE "PickingOrder" ADD COLUMN "packedBy" TEXT;
ALTER TABLE "PickingOrder" ADD COLUMN "packedTaggedAt" DATETIME;
ALTER TABLE "PickingOrder" ADD COLUMN "trackingCompany" TEXT;
ALTER TABLE "PickingOrder" ADD COLUMN "trackingNumber" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PickingLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "roundId" INTEGER NOT NULL,
    "pickingOrderId" INTEGER NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "packed" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PickingLine_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingLine_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PickingRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingLine_pickingOrderId_fkey" FOREIGN KEY ("pickingOrderId") REFERENCES "PickingOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PickingLine" ("barcode", "id", "imageUrl", "inventoryItemId", "pickingOrderId", "productTitle", "quantity", "roundId", "shop", "sku", "variantId", "variantTitle") SELECT "barcode", "id", "imageUrl", "inventoryItemId", "pickingOrderId", "productTitle", "quantity", "roundId", "shop", "sku", "variantId", "variantTitle" FROM "PickingLine";
DROP TABLE "PickingLine";
ALTER TABLE "new_PickingLine" RENAME TO "PickingLine";
CREATE INDEX "PickingLine_roundId_idx" ON "PickingLine"("roundId");
CREATE UNIQUE INDEX "PickingLine_pickingOrderId_inventoryItemId_key" ON "PickingLine"("pickingOrderId", "inventoryItemId");
CREATE TABLE "new_Shop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT,
    "locationName" TEXT,
    "syncOperationId" TEXT,
    "syncStatus" TEXT,
    "syncedAt" DATETIME,
    "pickingBatchSizes" TEXT NOT NULL DEFAULT '1,4,8,16,32',
    "packingMode" TEXT NOT NULL DEFAULT 'PACK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shop" ("createdAt", "locationId", "locationName", "pickingBatchSizes", "shop", "syncOperationId", "syncStatus", "syncedAt", "updatedAt") SELECT "createdAt", "locationId", "locationName", "pickingBatchSizes", "shop", "syncOperationId", "syncStatus", "syncedAt", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

