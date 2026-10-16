-- Integração com a Eclética: turnos, vendas e sangrias recebidos do Eclética B.I, códigos e chave do programa
-- AlterEnum
ALTER TYPE "PlatformProvider" ADD VALUE 'ECLETICA';

-- AlterTable
ALTER TABLE "platform_integrations" ADD COLUMN     "agentTokenHash" TEXT,
ADD COLUMN     "agentVersion" TEXT;

-- CreateTable
CREATE TABLE "ecletica_turnos" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "open" BOOLEAN NOT NULL DEFAULT false,
    "floatCents" INTEGER NOT NULL DEFAULT 0,
    "closingCents" INTEGER,
    "machine" TEXT,
    "operatorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecletica_turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecletica_vendas" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "establishment" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "saleType" TEXT,
    "origin" TEXT,
    "status" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "serviceCents" INTEGER NOT NULL DEFAULT 0,
    "byColumn" JSONB NOT NULL,
    "changeCents" INTEGER NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL,
    "externalOrderId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "ecletica_vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecletica_sangrias" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "operator" TEXT,
    "dCents" INTEGER NOT NULL DEFAULT 0,
    "tCents" INTEGER NOT NULL DEFAULT 0,
    "cCents" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT,
    "reason" TEXT,

    CONSTRAINT "ecletica_sangrias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecletica_codigos" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "label" TEXT,
    "storeId" TEXT,
    "channelId" TEXT,
    "paymentMethodId" TEXT,
    "ticketBrandId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecletica_codigos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ecletica_turnos_restaurantId_openedAt_idx" ON "ecletica_turnos"("restaurantId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ecletica_turnos_restaurantId_externalId_key" ON "ecletica_turnos"("restaurantId", "externalId");

-- CreateIndex
CREATE INDEX "ecletica_vendas_restaurantId_closedAt_idx" ON "ecletica_vendas"("restaurantId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ecletica_vendas_shiftId_externalKey_key" ON "ecletica_vendas"("shiftId", "externalKey");

-- CreateIndex
CREATE INDEX "ecletica_sangrias_shiftId_idx" ON "ecletica_sangrias"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ecletica_codigos_restaurantId_kind_externalKey_key" ON "ecletica_codigos"("restaurantId", "kind", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "platform_integrations_agentTokenHash_key" ON "platform_integrations"("agentTokenHash");

-- AddForeignKey
ALTER TABLE "ecletica_turnos" ADD CONSTRAINT "ecletica_turnos_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecletica_vendas" ADD CONSTRAINT "ecletica_vendas_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecletica_vendas" ADD CONSTRAINT "ecletica_vendas_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ecletica_turnos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecletica_sangrias" ADD CONSTRAINT "ecletica_sangrias_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ecletica_turnos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecletica_codigos" ADD CONSTRAINT "ecletica_codigos_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- como todas as outras: sem acesso pela chave pública do Supabase
ALTER TABLE "ecletica_turnos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ecletica_vendas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ecletica_sangrias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ecletica_codigos" ENABLE ROW LEVEL SECURITY;
