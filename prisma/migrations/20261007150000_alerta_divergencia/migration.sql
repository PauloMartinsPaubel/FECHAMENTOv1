-- Alerta de divergência por e-mail: quem recebe e a partir de qual valor.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "alertRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "alertThresholdCents" INTEGER;
ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_alert_threshold_check";
ALTER TABLE "settings" ADD CONSTRAINT "settings_alert_threshold_check" CHECK ("alertThresholdCents" IS NULL OR "alertThresholdCents" >= 0);
