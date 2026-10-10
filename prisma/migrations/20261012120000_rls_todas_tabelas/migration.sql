-- Proteção de linha (RLS) em todas as tabelas, sem regras: a API automática do Supabase (anon/authenticated)
-- não lê nem grava nada. O sistema acessa como dono das tabelas, que não é afetado.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- funções dos gatilhos de "não apagar" com caminho de busca fixo
ALTER FUNCTION public.forbid_delete() SET search_path = '';
ALTER FUNCTION public.forbid_update_delete() SET search_path = '';
