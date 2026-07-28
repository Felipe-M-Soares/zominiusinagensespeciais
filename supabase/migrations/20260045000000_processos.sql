-- =============================================================================
-- PROCESSOS — integra o módulo /processos ao banco (antes só salvava em
-- localStorage do navegador, sem multiusuário, sem backup, sem RLS real).
-- =============================================================================
-- 1) Libera as roles 'processos' e 'producao' para gravar em ferramentas_cnc,
--    fornecedores, pedidos_compra e pedido_compra_itens (essas tabelas já
--    existiam com RLS, mas só permitiam escrita para admin/estoque/financeiro —
--    'producao' precisa gravar para o "Pedido de barras" da aba Matéria-Prima).
-- 2) Cria a tabela programas_cnc (biblioteca de código G-code/CNC), que não
--    existia — a aba "Códigos" salvava só no localStorage do navegador.
-- =============================================================================

-- ── 1. RLS: adiciona 'processos' às policies de escrita já existentes ────────

DROP POLICY IF EXISTS "ferr_write" ON public.ferramentas_cnc;
CREATE POLICY "ferr_write" ON public.ferramentas_cnc
  FOR ALL USING (public.get_my_role() IN ('admin','producao','processos'));

DROP POLICY IF EXISTS "forn_write" ON public.fornecedores;
CREATE POLICY "forn_write" ON public.fornecedores
  FOR ALL USING (public.get_my_role() IN ('admin','estoque','financeiro','processos'));

DROP POLICY IF EXISTS "pc_write" ON public.pedidos_compra;
CREATE POLICY "pc_write" ON public.pedidos_compra
  FOR ALL USING (public.get_my_role() IN ('admin','estoque','financeiro','processos','producao'));

DROP POLICY IF EXISTS "pci_write" ON public.pedido_compra_itens;
CREATE POLICY "pci_write" ON public.pedido_compra_itens
  FOR ALL USING (public.get_my_role() IN ('admin','estoque','financeiro','processos','producao'));

-- ── 2. Biblioteca de programas CNC (aba "Códigos") ───────────────────────────

CREATE TABLE IF NOT EXISTS public.programas_cnc (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  maquina_codigo text REFERENCES public.maquinas_producao(codigo),
  linguagem    text NOT NULL DEFAULT 'G-Code'
    CHECK (linguagem IN ('G-Code','Fanuc','Siemens','Mazak','Haas','Heidenhain','Okuma','Mitsubishi','Fagor','ISO CNC','Macro B','Outro')),
  conteudo     text NOT NULL DEFAULT '',
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.programas_cnc ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_programas_cnc_updated_at ON public.programas_cnc;
CREATE TRIGGER trg_programas_cnc_updated_at BEFORE UPDATE ON public.programas_cnc
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "prog_cnc_select" ON public.programas_cnc;
CREATE POLICY "prog_cnc_select" ON public.programas_cnc
  FOR SELECT USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "prog_cnc_write" ON public.programas_cnc;
CREATE POLICY "prog_cnc_write" ON public.programas_cnc
  FOR ALL USING (public.get_my_role() IN ('admin','producao','processos'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.programas_cnc TO authenticated;
