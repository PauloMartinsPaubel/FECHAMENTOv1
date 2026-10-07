-- Resumo semanal por e-mail: quem recebe.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "weeklyRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
