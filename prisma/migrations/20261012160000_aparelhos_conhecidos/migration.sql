-- Navegadores em que cada pessoa já entrou: um novo gera aviso por e-mail
CREATE TABLE "known_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "known_devices_userId_keyHash_key" ON "known_devices"("userId", "keyHash");

ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- como todas as outras: sem acesso pela chave pública do Supabase
ALTER TABLE "known_devices" ENABLE ROW LEVEL SECURITY;
