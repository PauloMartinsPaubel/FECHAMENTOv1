-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('ADMIN', 'MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('CASH', 'CREDIT', 'DEBIT', 'PIX', 'TICKET', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('VENDA', 'SUPRIMENTO', 'SANGRIA', 'DESPESA', 'ESTORNO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('ACTIVE', 'VOIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'REOPENED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "FloatMode" AS ENUM ('NEW_OPENING', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('CORRETO', 'FALTA', 'SOBRA', 'MISTO');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '00:00',
    "endTime" TEXT NOT NULL DEFAULT '23:59',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_channels" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_brands" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloatCents" INTEGER NOT NULL,
    "floatMode" "FloatMode" NOT NULL DEFAULT 'NEW_OPENING',
    "transferredFromId" TEXT,
    "openingNote" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountCents" INTEGER NOT NULL,
    "revenueEffect" INTEGER NOT NULL,
    "cashEffect" INTEGER NOT NULL,
    "channelId" TEXT,
    "paymentMethodId" TEXT,
    "ticketBrandId" TEXT,
    "orderNumber" TEXT,
    "description" TEXT,
    "employeeName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "movementId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "ticketBrandId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closing_conferences" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "closingId" TEXT,
    "lineKey" TEXT NOT NULL,
    "groupKind" "PaymentKind" NOT NULL,
    "paymentMethodId" TEXT,
    "ticketBrandId" TEXT,
    "channelId" TEXT,
    "label" TEXT NOT NULL,
    "systemCents" INTEGER,
    "expectedCents" INTEGER,
    "checkedCents" INTEGER,
    "differenceCents" INTEGER,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "closing_conferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ClosingStatus" NOT NULL,
    "floatCents" INTEGER NOT NULL,
    "revenueCents" INTEGER NOT NULL,
    "grossSalesCents" INTEGER NOT NULL,
    "refundsCents" INTEGER NOT NULL,
    "controlledCents" INTEGER NOT NULL,
    "cashSalesCents" INTEGER NOT NULL,
    "creditCents" INTEGER NOT NULL,
    "debitCents" INTEGER NOT NULL,
    "cardsCents" INTEGER NOT NULL,
    "pixCents" INTEGER NOT NULL,
    "ticketsCents" INTEGER NOT NULL,
    "onlineCents" INTEGER NOT NULL,
    "otherCents" INTEGER NOT NULL,
    "suppliesCents" INTEGER NOT NULL,
    "withdrawalsCents" INTEGER NOT NULL,
    "expensesCents" INTEGER NOT NULL,
    "cancellationsCents" INTEGER NOT NULL,
    "cashExpectedCents" INTEGER NOT NULL,
    "cashCountedCents" INTEGER NOT NULL,
    "cashDiffCents" INTEGER NOT NULL,
    "cardsDiffCents" INTEGER NOT NULL,
    "pixDiffCents" INTEGER NOT NULL,
    "ticketsDiffCents" INTEGER NOT NULL,
    "onlineDiffCents" INTEGER NOT NULL,
    "otherDiffCents" INTEGER NOT NULL,
    "totalDiffCents" INTEGER NOT NULL,
    "absDiffCents" INTEGER NOT NULL,
    "toleranceCents" INTEGER NOT NULL,
    "justification" TEXT,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closing_details" (
    "id" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "channelId" TEXT,
    "paymentMethodId" TEXT,
    "ticketBrandId" TEXT,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "closing_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustments" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "closingId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "sessionId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "toEmails" TEXT[],
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "defaultOpeningFloatCents" INTEGER NOT NULL DEFAULT 10000,
    "toleranceCents" INTEGER NOT NULL DEFAULT 0,
    "defaultFloatMode" "FloatMode" NOT NULL DEFAULT 'NEW_OPENING',
    "closingRecipients" TEXT[],
    "emailFrom" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_restaurantId_idx" ON "users"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_restaurantId_name_key" ON "cash_registers"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_restaurantId_code_key" ON "shifts"("restaurantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_channels_restaurantId_name_key" ON "sales_channels"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_restaurantId_name_key" ON "payment_methods"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_brands_restaurantId_name_key" ON "ticket_brands"("restaurantId", "name");

-- CreateIndex
CREATE INDEX "cash_sessions_restaurantId_businessDate_idx" ON "cash_sessions"("restaurantId", "businessDate");

-- CreateIndex
CREATE INDEX "cash_sessions_status_idx" ON "cash_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_registerId_shiftId_businessDate_key" ON "cash_sessions"("registerId", "shiftId", "businessDate");

-- CreateIndex
CREATE INDEX "cash_movements_sessionId_status_idx" ON "cash_movements"("sessionId", "status");

-- CreateIndex
CREATE INDEX "cash_movements_restaurantId_occurredAt_idx" ON "cash_movements"("restaurantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_sessionId_idempotencyKey_key" ON "cash_movements"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "cancellations_movementId_key" ON "cancellations"("movementId");

-- CreateIndex
CREATE INDEX "cancellations_sessionId_idx" ON "cancellations"("sessionId");

-- CreateIndex
CREATE INDEX "cancellations_restaurantId_occurredAt_idx" ON "cancellations"("restaurantId", "occurredAt");

-- CreateIndex
CREATE INDEX "closing_conferences_closingId_idx" ON "closing_conferences"("closingId");

-- CreateIndex
CREATE UNIQUE INDEX "closing_conferences_sessionId_lineKey_key" ON "closing_conferences"("sessionId", "lineKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closings_sessionId_key" ON "cash_closings"("sessionId");

-- CreateIndex
CREATE INDEX "cash_closings_restaurantId_closedAt_idx" ON "cash_closings"("restaurantId", "closedAt");

-- CreateIndex
CREATE INDEX "closing_details_closingId_idx" ON "closing_details"("closingId");

-- CreateIndex
CREATE INDEX "adjustments_sessionId_idx" ON "adjustments"("sessionId");

-- CreateIndex
CREATE INDEX "adjustments_entity_entityId_idx" ON "adjustments"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_sessionId_idx" ON "audit_logs"("sessionId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "email_logs_closingId_idx" ON "email_logs"("closingId");

-- CreateIndex
CREATE UNIQUE INDEX "settings_restaurantId_key" ON "settings"("restaurantId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_brands" ADD CONSTRAINT "ticket_brands_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_transferredFromId_fkey" FOREIGN KEY ("transferredFromId") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_ticketBrandId_fkey" FOREIGN KEY ("ticketBrandId") REFERENCES "ticket_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "cash_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "sales_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_ticketBrandId_fkey" FOREIGN KEY ("ticketBrandId") REFERENCES "ticket_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_conferences" ADD CONSTRAINT "closing_conferences_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_conferences" ADD CONSTRAINT "closing_conferences_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cash_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_conferences" ADD CONSTRAINT "closing_conferences_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_conferences" ADD CONSTRAINT "closing_conferences_ticketBrandId_fkey" FOREIGN KEY ("ticketBrandId") REFERENCES "ticket_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_details" ADD CONSTRAINT "closing_details_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cash_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_details" ADD CONSTRAINT "closing_details_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closing_details" ADD CONSTRAINT "closing_details_ticketBrandId_fkey" FOREIGN KEY ("ticketBrandId") REFERENCES "ticket_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cash_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cash_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Garantias que o Prisma não declara: valem para QUALQUER cliente do banco
-- ============================================================================

-- Valores monetários são inteiros positivos em centavos; efeitos só -1, 0 ou 1
ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_amount_chk" CHECK ("amountCents" > 0 AND "amountCents" <= 2000000000),
  ADD CONSTRAINT "cash_movements_revenue_effect_chk" CHECK ("revenueEffect" IN (-1, 0, 1)),
  ADD CONSTRAINT "cash_movements_cash_effect_chk" CHECK ("cashEffect" IN (-1, 0, 1)),
  -- quem afeta faturamento precisa de canal e forma de pagamento (senão a matriz não fecha)
  ADD CONSTRAINT "cash_movements_revenue_shape_chk" CHECK (
    "revenueEffect" = 0 OR ("channelId" IS NOT NULL AND "paymentMethodId" IS NOT NULL)
  );

ALTER TABLE "cash_sessions"
  ADD CONSTRAINT "cash_sessions_float_chk" CHECK ("openingFloatCents" >= 0 AND "openingFloatCents" <= 2000000000);

ALTER TABLE "cancellations"
  ADD CONSTRAINT "cancellations_amount_chk" CHECK ("amountCents" > 0 AND "amountCents" <= 2000000000);

-- Só existe UMA forma de pagamento do tipo dinheiro: o fundo e o dinheiro contado pertencem à mesma gaveta
CREATE UNIQUE INDEX "payment_methods_single_cash_idx" ON "payment_methods" ("restaurantId") WHERE "kind" = 'CASH';

-- Registros financeiros e de auditoria nunca são apagados; auditoria e ajustes nunca são alterados
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % não podem ser apagados. Use o status (anulado/cancelado) com motivo.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é somente inserção: registros não podem ser alterados nem apagados.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER adjustments_immutable BEFORE UPDATE OR DELETE ON "adjustments"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER cancellations_no_delete BEFORE DELETE ON "cancellations"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER cash_closings_no_delete BEFORE DELETE ON "cash_closings"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER cash_sessions_no_delete BEFORE DELETE ON "cash_sessions"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
