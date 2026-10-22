-- CreateTable
CREATE TABLE "PickingOrder" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickingOrder_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickingOrder_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PickingRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PickingOrder_reservationKey_key" ON "PickingOrder"("reservationKey");

-- CreateIndex
CREATE UNIQUE INDEX "PickingOrder_boxKey_key" ON "PickingOrder"("boxKey");

-- CreateIndex
CREATE INDEX "PickingOrder_shop_orderId_idx" ON "PickingOrder"("shop", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PickingOrder_roundId_orderId_key" ON "PickingOrder"("roundId", "orderId");

