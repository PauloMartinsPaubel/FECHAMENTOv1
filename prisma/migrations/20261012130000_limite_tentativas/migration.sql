-- Limite de tentativas por endereço de internet (guardado só como hash).
CREATE TABLE IF NOT EXISTS "rate_limit_hits" (
  "id" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "rate_limit_hits_bucket_keyHash_createdAt_idx" ON "rate_limit_hits"("bucket", "keyHash", "createdAt");
CREATE INDEX IF NOT EXISTS "rate_limit_hits_createdAt_idx" ON "rate_limit_hits"("createdAt");
ALTER TABLE "rate_limit_hits" ENABLE ROW LEVEL SECURITY;
