-- Cobrança (Asaas): estado da assinatura no restaurante e as cobranças.
DO $$ BEGIN
  CREATE TYPE "BillingPlan" AS ENUM ('EXEMPT', 'TRIAL', 'SUBSCRIBED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "billingPlan" "BillingPlan" NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "billingDocument" TEXT;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "asaasSubscriptionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "restaurants_asaasSubscriptionId_key" ON "restaurants"("asaasSubscriptionId");

-- restaurantes que já existiam antes da cobrança são da casa: não pagam
UPDATE "restaurants" SET "billingPlan" = 'EXEMPT' WHERE "createdAt" < '2026-10-08 12:00:00';

CREATE TABLE IF NOT EXISTS "billing_payments" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "asaasPaymentId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "valueCents" INTEGER NOT NULL,
  "dueDate" DATE NOT NULL,
  "paidAt" TIMESTAMP(3),
  "invoiceUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_payments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_payments_value_check" CHECK ("valueCents" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_payments_asaasPaymentId_key" ON "billing_payments"("asaasPaymentId");
CREATE INDEX IF NOT EXISTS "billing_payments_restaurantId_dueDate_idx" ON "billing_payments"("restaurantId", "dueDate");
DROP TRIGGER IF EXISTS billing_payments_no_delete ON "billing_payments";
CREATE TRIGGER billing_payments_no_delete BEFORE DELETE ON "billing_payments" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
