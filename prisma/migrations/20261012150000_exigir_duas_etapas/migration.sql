-- O restaurante pode exigir a verificação em duas etapas de administradores e gerentes
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false;
