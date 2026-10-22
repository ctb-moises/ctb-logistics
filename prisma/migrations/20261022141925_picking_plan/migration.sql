-- AlterTable
ALTER TABLE "PickingOrder" ADD COLUMN "slot" INTEGER;

-- AlterTable
ALTER TABLE "PickingRound" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "PickingRound" ADD COLUMN "plannedAt" DATETIME;

-- CreateTable
CREATE TABLE "PickingLine" (
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
    CONSTRAINT "PickingLine_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingLine_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PickingRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingLine_pickingOrderId_fkey" FOREIGN KEY ("pickingOrderId") REFERENCES "PickingOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PickingTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "roundId" INTEGER NOT NULL,
    "lineId" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "binId" INTEGER,
    "binCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "picked" INTEGER NOT NULL DEFAULT 0,
    "short" INTEGER NOT NULL DEFAULT 0,
    "stockTaken" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PickingTask_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingTask_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PickingRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingTask_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PickingLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingTask_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PickingLine_roundId_idx" ON "PickingLine"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "PickingLine_pickingOrderId_inventoryItemId_key" ON "PickingLine"("pickingOrderId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "PickingTask_roundId_step_idx" ON "PickingTask"("roundId", "step");

