-- Preço combinado por restaurante (mensal e anual); vazio usa o preço padrão
-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN "customPriceCents" INTEGER,
ADD COLUMN "customAnnualPriceCents" INTEGER;
