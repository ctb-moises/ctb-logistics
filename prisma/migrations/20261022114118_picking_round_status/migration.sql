-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PickingRound" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "financialStatus" TEXT NOT NULL,
    "orderTag" TEXT,
    "orderLimit" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PickingRound_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PickingRound" ("createdAt", "createdBy", "financialStatus", "id", "locationId", "orderLimit", "orderTag", "shop", "status", "updatedAt") SELECT "createdAt", "createdBy", "financialStatus", "id", "locationId", "orderLimit", "orderTag", "shop", "status", "updatedAt" FROM "PickingRound";
DROP TABLE "PickingRound";
ALTER TABLE "new_PickingRound" RENAME TO "PickingRound";
CREATE INDEX "PickingRound_shop_status_idx" ON "PickingRound"("shop", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Rounds no longer have a draft state.
UPDATE "PickingRound" SET "status" = 'IN_PROGRESS' WHERE "status" = 'DRAFT';
