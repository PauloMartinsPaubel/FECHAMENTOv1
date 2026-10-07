-- Contagem do dinheiro por cédula e moeda (opcional), guardada na linha "cash" da conferência.
ALTER TABLE "closing_conferences" ADD COLUMN IF NOT EXISTS "breakdown" JSONB;
