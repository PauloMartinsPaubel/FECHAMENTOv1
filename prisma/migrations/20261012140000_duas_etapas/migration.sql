-- Verificação em duas etapas (aplicativo autenticador) e segundo passo do login.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpSecretEnc" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpPendingEnc" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totpLastStep" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "pendingTwoFactor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "twoFactorAttempts" INTEGER NOT NULL DEFAULT 0;
