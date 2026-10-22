/*
  Warnings:

  - You are about to drop the `ShopSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ShopSettings";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Shop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT,
    "locationName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bin_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Bin" ("active", "code", "createdAt", "description", "id", "locationId", "shop", "updatedAt") SELECT "active", "code", "createdAt", "description", "id", "locationId", "shop", "updatedAt" FROM "Bin";
DROP TABLE "Bin";
ALTER TABLE "new_Bin" RENAME TO "Bin";
CREATE INDEX "Bin_shop_locationId_idx" ON "Bin"("shop", "locationId");
CREATE UNIQUE INDEX "Bin_shop_locationId_code_key" ON "Bin"("shop", "locationId", "code");
CREATE TABLE "new_BinStock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "binId" INTEGER NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BinStock_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BinStock_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BinStock" ("binId", "createdAt", "id", "inventoryItemId", "quantity", "shop", "sku", "updatedAt", "variantId") SELECT "binId", "createdAt", "id", "inventoryItemId", "quantity", "shop", "sku", "updatedAt", "variantId" FROM "BinStock";
DROP TABLE "BinStock";
ALTER TABLE "new_BinStock" RENAME TO "BinStock";
CREATE INDEX "BinStock_shop_inventoryItemId_idx" ON "BinStock"("shop", "inventoryItemId");
CREATE INDEX "BinStock_shop_sku_idx" ON "BinStock"("shop", "sku");
CREATE UNIQUE INDEX "BinStock_binId_inventoryItemId_key" ON "BinStock"("binId", "inventoryItemId");
CREATE TABLE "new_StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "binId" INTEGER NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("binId", "createdAt", "delta", "id", "inventoryItemId", "reason", "reference", "shop", "userId") SELECT "binId", "createdAt", "delta", "id", "inventoryItemId", "reason", "reference", "shop", "userId" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_shop_inventoryItemId_createdAt_idx" ON "StockMovement"("shop", "inventoryItemId", "createdAt");
CREATE INDEX "StockMovement_binId_createdAt_idx" ON "StockMovement"("binId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
