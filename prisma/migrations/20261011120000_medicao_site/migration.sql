-- Visitas e cliques da página de apresentação (sem dado pessoal).
CREATE TABLE IF NOT EXISTS "site_events" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "site_events_createdAt_idx" ON "site_events"("createdAt");
