-- Marcas que dividem o mesmo caixa (ex.: A Feijoada e Prato e Folha): faturamento separado por marca
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stores_restaurantId_name_key" ON "stores"("restaurantId", "name");

ALTER TABLE "stores" ADD CONSTRAINT "stores_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_movements" ADD COLUMN "storeId" TEXT;

ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- como todas as outras: sem acesso pela chave pública do Supabase
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
