-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InventoryLevel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "imageUrl" TEXT,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "binQuantity" INTEGER NOT NULL DEFAULT 0,
    "boxQuantity" INTEGER NOT NULL DEFAULT 0,
    "accountedQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLevel_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InventoryLevel" ("barcode", "binQuantity", "id", "imageUrl", "inventoryItemId", "locationId", "onHand", "productId", "productTitle", "shop", "sku", "updatedAt", "variantId", "variantTitle") SELECT "barcode", "binQuantity", "id", "imageUrl", "inventoryItemId", "locationId", "onHand", "productId", "productTitle", "shop", "sku", "updatedAt", "variantId", "variantTitle" FROM "InventoryLevel";
DROP TABLE "InventoryLevel";
ALTER TABLE "new_InventoryLevel" RENAME TO "InventoryLevel";
CREATE INDEX "InventoryLevel_shop_locationId_productTitle_id_idx" ON "InventoryLevel"("shop", "locationId", "productTitle", "id");
CREATE UNIQUE INDEX "InventoryLevel_shop_locationId_inventoryItemId_key" ON "InventoryLevel"("shop", "locationId", "inventoryItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Units already picked into boxes whose orders aren't fulfilled or cancelled yet.
UPDATE "InventoryLevel" SET "boxQuantity" = COALESCE((
  SELECT SUM(t."picked") FROM "PickingTask" t
  JOIN "PickingLine" l ON l."id" = t."lineId"
  JOIN "PickingOrder" o ON o."id" = l."pickingOrderId"
  JOIN "PickingRound" r ON r."id" = t."roundId"
  WHERE r."shop" = "InventoryLevel"."shop"
    AND r."locationId" = "InventoryLevel"."locationId"
    AND l."inventoryItemId" = "InventoryLevel"."inventoryItemId"
    AND o."releasedAt" IS NULL
), 0);
UPDATE "InventoryLevel" SET "accountedQuantity" = "binQuantity" + "boxQuantity";
