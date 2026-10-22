-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "syncOperationId" TEXT;
ALTER TABLE "Shop" ADD COLUMN "syncStatus" TEXT;
ALTER TABLE "Shop" ADD COLUMN "syncedAt" DATETIME;

-- CreateTable
CREATE TABLE "InventoryLevel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "imageUrl" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "binQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLevel_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InventoryLevel_shop_locationId_productTitle_id_idx" ON "InventoryLevel"("shop", "locationId", "productTitle", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLevel_shop_locationId_inventoryItemId_key" ON "InventoryLevel"("shop", "locationId", "inventoryItemId");
