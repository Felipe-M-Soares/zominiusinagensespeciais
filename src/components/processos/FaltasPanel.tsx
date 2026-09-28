/**
 * Processos › Faltas — ferramentas perto do limite ou além da vida útil, com
 * atalho para gerar um pedido de compra (rascunho) a partir da falta.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import { Chip, EmptyState, STATUS_LABEL, STATUS_TONE, pctVida, useDropdownOptions, type Ferramenta } from "./shared";

export function FaltasPanel({ ferramentas, onChange, onIrCompras }: {
  ferramentas: Ferramenta[];
  onChange: () => void;
  onIrCompras?: () => void;
}) {
  const { fornecedores } = useDropdownOptions();
  const [gerando, setGerando] = useState<string | null>(null);
  const [gerados, setGerados] = useState<Set<string>>(new Set());
  const fornecedorNome = (id: string | null) => fornecedores.find(f => f.id === id)?.razao_social ?? "A definir";

  const gerarPedido = async (f: Ferramenta) => {
    setGerando(f.id);
    try {
      const nomeFornecedor = fornecedorNome(f.fornecedor_id);
      const { data: pedido, error } = await supabase.from("pedidos_compra").insert({
        fornecedor_id: f.fornecedor_id, fornecedor_nome: nomeFornecedor,
        observacoes: `Gerado automaticamente pelo controle de faltas de ferramentas (${f.codigo} — ${f.descricao}).`,
        valor_total: f.custo_unitario ?? 0, status: "rascunho",
      }).select("id").single();
      if (error || !pedido) { toast.error(friendlyError(error, "Erro ao gerar pedido de compra.")); return; }
      const { error: itemErr } = await supabase.from("pedido_compra_itens").insert({
        pedido_id: pedido.id, descricao: `${f.codigo} — ${f.descricao}`,
        quantidade: 1, unidade: "un", valor_unitario: f.custo_unitario ?? 0,
      });
      if (itemErr) toast.warning("Pedido criado, mas o item não foi adicionado. Confira na aba Compras.");
      setGerados(prev => new Set(prev).add(f.id));
      toast.success("Pedido de compra (rascunho) gerado.", onIrCompras ? { action: { label: "Ver compras", onClick: onIrCompras } } : undefined);
      onChange();
    } finally {
      setGerando(null);
    }
  };

  const ordenadas = [...ferramentas].sort((a, b) => (pctVida(b) ?? 0) - (pctVida(a) ?? 0));

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Aparecem aqui as ferramentas que já usaram <strong className="text-foreground">80% ou mais</strong> da vida útil.
          Gere o pedido de compra e acompanhe na aba <strong className="text-foreground">Compras</strong>.
        </p>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {ordenadas.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nenhuma ferramenta em falta" text="Todas as ferramentas estão dentro da vida útil. Quando alguma chegar a 80%, ela aparece aqui." />
        ) : (
          <ul className="divide-y">
            {ordenadas.map(f => {
              const pct = pctVida(f);
              const feito = gerados.has(f.id);
              return (
                <li key={f.id} className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{f.descricao}</p>
                      <Chip className={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Chip>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{f.codigo}</span> · {f.pecas_produzidas.toLocaleString("pt-BR")}/{f.vida_util_pecas ? f.vida_util_pecas.toLocaleString("pt-BR") : "∞"} peças
                      {pct !== null && <span className={cn("font-semibold", pct >= 100 ? "text-destructive" : "text-warning")}> ({pct}%)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Fornecedor: {fornecedorNome(f.fornecedor_id)}{f.custo_unitario != null && ` · ${formatBRL(f.custo_unitario)}`}
                    </p>
                  </div>
                  {feito ? (
                    <Button variant="outline" className="h-11 rounded-xl gap-2 w-full sm:w-auto" onClick={onIrCompras} disabled={!onIrCompras}>
                      <CheckCircle2 className="h-4 w-4 text-success" /> Pedido gerado <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button className="h-11 rounded-xl gap-2 w-full sm:w-auto" disabled={gerando === f.id} onClick={() => gerarPedido(f)}>
                      {gerando === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                      {gerando === f.id ? "Gerando…" : "Gerar compra"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
