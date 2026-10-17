-- Plano anual: ciclo da assinatura no restaurante e em cada cobrança (as que já existem são mensais)
-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "billing_payments" ADD COLUMN "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY';
