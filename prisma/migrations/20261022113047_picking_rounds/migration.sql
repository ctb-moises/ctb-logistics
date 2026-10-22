-- CreateTable
CREATE TABLE "PickingRound" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "financialStatus" TEXT NOT NULL,
    "orderTag" TEXT,
    "orderLimit" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PickingRound_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT,
    "locationName" TEXT,
    "syncOperationId" TEXT,
    "syncStatus" TEXT,
    "syncedAt" DATETIME,
    "pickingBatchSizes" TEXT NOT NULL DEFAULT '1,4,8,16,32',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shop" ("createdAt", "locationId", "locationName", "shop", "syncOperationId", "syncStatus", "syncedAt", "updatedAt") SELECT "createdAt", "locationId", "locationName", "shop", "syncOperationId", "syncStatus", "syncedAt", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PickingRound_shop_status_idx" ON "PickingRound"("shop", "status");
