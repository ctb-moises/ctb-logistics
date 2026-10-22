-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PickingOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "roundId" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderCreatedAt" DATETIME NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "reservationKey" TEXT,
    "boxCode" TEXT,
    "boxKey" TEXT,
    "boxAssignedAt" DATETIME,
    "releasedAt" DATETIME,
    "slot" INTEGER,
    "taggedAt" DATETIME,
    "packedAt" DATETIME,
    "packedBy" TEXT,
    "packedTaggedAt" DATETIME,
    "fulfillAfterPacking" BOOLEAN NOT NULL DEFAULT false,
    "fulfillingAt" DATETIME,
    "fulfilledAt" DATETIME,
    "trackingCompany" TEXT,
    "trackingNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingOrder_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingOrder_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PickingRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PickingOrder" ("boxAssignedAt", "boxCode", "boxKey", "createdAt", "fulfilledAt", "fulfillingAt", "id", "itemCount", "orderCreatedAt", "orderId", "orderName", "packedAt", "packedBy", "packedTaggedAt", "position", "releasedAt", "reservationKey", "roundId", "shop", "slot", "taggedAt", "trackingCompany", "trackingNumber") SELECT "boxAssignedAt", "boxCode", "boxKey", "createdAt", "fulfilledAt", "fulfillingAt", "id", "itemCount", "orderCreatedAt", "orderId", "orderName", "packedAt", "packedBy", "packedTaggedAt", "position", "releasedAt", "reservationKey", "roundId", "shop", "slot", "taggedAt", "trackingCompany", "trackingNumber" FROM "PickingOrder";
DROP TABLE "PickingOrder";
ALTER TABLE "new_PickingOrder" RENAME TO "PickingOrder";
CREATE UNIQUE INDEX "PickingOrder_reservationKey_key" ON "PickingOrder"("reservationKey");
CREATE UNIQUE INDEX "PickingOrder_boxKey_key" ON "PickingOrder"("boxKey");
CREATE INDEX "PickingOrder_shop_orderId_idx" ON "PickingOrder"("shop", "orderId");
CREATE UNIQUE INDEX "PickingOrder_roundId_orderId_key" ON "PickingOrder"("roundId", "orderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

