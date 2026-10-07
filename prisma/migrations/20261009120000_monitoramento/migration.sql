-- Erros do servidor agrupados, para aviso ao suporte.
CREATE TABLE IF NOT EXISTS "error_events" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "path" TEXT,
  "kind" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notifiedAt" TIMESTAMP(3),
  CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "error_events_fingerprint_key" ON "error_events"("fingerprint");
CREATE INDEX IF NOT EXISTS "error_events_lastSeenAt_idx" ON "error_events"("lastSeenAt");
