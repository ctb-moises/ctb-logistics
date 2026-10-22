-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT,
    "locationName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Bin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BinStock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "binId" INTEGER NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BinStock_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "binId" INTEGER NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Bin_shop_locationId_idx" ON "Bin"("shop", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_shop_locationId_code_key" ON "Bin"("shop", "locationId", "code");

-- CreateIndex
CREATE INDEX "BinStock_shop_inventoryItemId_idx" ON "BinStock"("shop", "inventoryItemId");

-- CreateIndex
CREATE INDEX "BinStock_shop_sku_idx" ON "BinStock"("shop", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "BinStock_binId_inventoryItemId_key" ON "BinStock"("binId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "StockMovement_shop_inventoryItemId_createdAt_idx" ON "StockMovement"("shop", "inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_binId_createdAt_idx" ON "StockMovement"("binId", "createdAt");
