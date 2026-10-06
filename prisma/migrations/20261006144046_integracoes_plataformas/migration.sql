-- CreateEnum
CREATE TYPE "PlatformProvider" AS ENUM ('IFOOD');

-- CreateEnum
CREATE TYPE "PlatformOrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'DISPATCHED', 'READY', 'CONCLUDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "platform_integrations" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" "PlatformProvider" NOT NULL,
    "merchantId" TEXT,
    "channelId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncOk" BOOLEAN,
    "lastSyncInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_orders" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" "PlatformProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayId" TEXT,
    "merchantId" TEXT,
    "status" "PlatformOrderStatus" NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "orderType" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL,
    "benefitsCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "onlineCents" INTEGER NOT NULL,
    "offlineCents" INTEGER NOT NULL,
    "payments" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_events" (
    "id" TEXT NOT NULL,
    "provider" "PlatformProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "orderExternalId" TEXT,
    "code" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_integrations_restaurantId_provider_key" ON "platform_integrations"("restaurantId", "provider");

-- CreateIndex
CREATE INDEX "platform_orders_restaurantId_businessDate_idx" ON "platform_orders"("restaurantId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "platform_orders_provider_externalId_key" ON "platform_orders"("provider", "externalId");

-- CreateIndex
CREATE INDEX "platform_events_orderExternalId_idx" ON "platform_events"("orderExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_events_provider_externalId_key" ON "platform_events"("provider", "externalId");

-- Valores de pedido nunca negativos; eventos e pedidos da plataforma nunca apagados
ALTER TABLE "platform_orders"
  ADD CONSTRAINT "platform_orders_amounts_chk" CHECK (
    "subtotalCents" >= 0 AND "deliveryFeeCents" >= 0 AND "benefitsCents" >= 0 AND
    "totalCents" >= 0 AND "onlineCents" >= 0 AND "offlineCents" >= 0
  );
CREATE TRIGGER platform_events_no_delete BEFORE DELETE ON "platform_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER platform_orders_no_delete BEFORE DELETE ON "platform_orders"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
