/**
 * MateriaPrimaPanel — Matéria-prima (barras) da produção.
 * ✓ Estoque com mínimo/máximo e alerta de reposição
 * ✓ Movimentos (entrada / saída / ajuste) com fallback offline
 * ✓ Pedido de barras: usa as tabelas pedidos_compra + pedido_compra_itens
 *   (mesmas do módulo Compras — o pedido aparece lá também)
 * ✓ Cadastro de matéria-prima (admin/produção/gerente — RLS mp_insert/mp_update)
 * ✓ Barra: compra por PESO (kg), consumo por METRO. Cada barra tem 3 m; o peso
 *   de cada diâmetro é pesado e cadastrado → o sistema converte kg ↔ m ↔ barras.
 *   O consumo dos lançamentos de produção é baixado automaticamente (trigger no
 *   banco) e a tela estima em quantos dias cada barra acaba.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Boxes, AlertTriangle, ArrowDown, ArrowUp, Trash2, ShoppingCart, Truck, CheckCircle2, Loader2,
  SlidersHorizontal, Pencil, MapPin, PackagePlus, Scale, PackageCheck, CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { temPapel } from "@/types/roles";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard, Carregando, Vazio, BotaoAtualizar, Campo, Segmentado, selCls } from "@/components/producao/ProducaoUI";
import {
  comprimentoBarraM, kgParaMetros, metrosParaBarras, metrosParaKg, pesoBarraKg, pesoTeoricoBarraKg,
  fmtBarras, fmtKg, fmtMetros, type BarraInfo,
} from "@/lib/barra";

type MovimentoTipo = "entrada" | "saida" | "ajuste";

interface MateriaPrima extends BarraInfo {
  id: string; codigo: string; descricao: string; estoque_conferido_em?: string | null;
  unidade: string; estoque_atual: number;
  estoque_minimo: number; estoque_maximo: number;
  lote_atual?: string | null; fornecedor?: string | null;
  ultima_entrada?: string | null; ultima_saida?: string | null;
  localizacao?: string | null; created_at?: string; updated_at?: string;
}

interface Movimento {
  id: string; materia_prima_id: string; materia_prima_desc: string;
  tipo: MovimentoTipo; quantidade: number; lote?: string | null;
  operador: string; ordem_producao?: string | null; observacoes?: string | null;
  user_id?: string; created_at?: string;
}

type UnidadePedido = "kg" | "barra" | "m";
interface PedidoItemForm { materia_prima_id: string; quantidade: string; valor_unitario: string; unidade: UnidadePedido; }
interface PedidoBarras {
  id: string; fornecedor_nome: string; status: string;
  data_pedido: string; data_previsao: string | null; valor_total: number;
  observacoes: string | null; created_at: string;
  itens: { id: string; descricao: string; quantidade: number; unidade: string; quantidade_recebida: number; materia_prima_id: string | null }[];
}

const STATUS_PEDIDO: Record<string, { label: string; cls: string }> = {
  rascunho:  { label: "Rascunho",  cls: "bg-muted text-muted-foreground" },
  enviado:   { label: "Enviado",   cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  parcial:   { label: "Parcial",   cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  recebido:  { label: "Recebido",  cls: "bg-green-500/10 text-green-700 dark:text-green-400" },
  cancelado: { label: "Cancelado", cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
};
const OPERADOR_KEY = "diario_producao_operador";
const lerOperador = () => { try { return localStorage.getItem(OPERADOR_KEY) ?? ""; } catch { return ""; } };
const gravarOperador = (v: string) => { try { localStorage.setItem(OPERADOR_KEY, v); } catch { /* sem armazenamento */ } };
const dec = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".");
const fmtQ = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmtD = (iso?: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR") : "—";
/** numeric do Postgres chega como texto — normaliza para número. */
const normMP = (m: MateriaPrima): MateriaPrima => ({
  ...m, estoque_atual: Number(m.estoque_atual) || 0, estoque_minimo: Number(m.estoque_minimo) || 0, estoque_maximo: Number(m.estoque_maximo) || 0,
  peso_barra_kg: m.peso_barra_kg != null ? Number(m.peso_barra_kg) : null, diametro_mm: m.diametro_mm != null ? Number(m.diametro_mm) : null,
  comprimento_barra_m: Number(m.comprimento_barra_m) || 3, sobra_barra_mm: Number(m.sobra_barra_mm) || 0,
});
/** Quantidade em kg / barras / metros → metros (null = falta o peso da barra). */
function paraMetros(qtd: number, unidade: UnidadePedido, mp: MateriaPrima): number | null {
  if (unidade === "m") return qtd;
  if (unidade === "barra") return qtd * comprimentoBarraM(mp);
  return kgParaMetros(qtd, mp);
}
/** "≈ 10 barras · 30 m · 1,68 kg" — equivalências de um saldo em metros. */
function equivalencias(m: number, mp: MateriaPrima): string {
  const kg = metrosParaKg(m, mp, true);
  return `${fmtBarras(metrosParaBarras(m, mp))}${kg != null ? ` · ${fmtKg(kg)}${pesoBarraKg(mp) ? "" : " (est.)"}` : ""}`;
}
const DIAS_ALERTA = 15;

// ── Pedido de barras ─────────────────────────────────────────────────────────
function PedidoBarrasDialog({ open, materias, sugeridos, onClose, onSaved }: {
  open: boolean; materias: MateriaPrima[]; sugeridos: MateriaPrima[]; onClose: () => void; onSaved: () => void;
}) {
  const [fornecedores, setFornecedores] = useState<{ id: string; razao_social: string }[]>([]);
  const [form, setForm] = useState({ fornecedor: "", data_previsao: "", observacoes: "", enviar: true });
  const [itens, setItens] = useState<PedidoItemForm[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ fornecedor: "", data_previsao: "", observacoes: "", enviar: true });
    // Já sugere as barras abaixo do mínimo, com a quantidade para chegar ao máximo.
    // A barra é comprada por peso: com o peso cadastrado, a sugestão vem em kg.
    setItens(sugeridos.length
      ? sugeridos.map(m => {
          const faltaM = Math.max(0, m.estoque_maximo - m.estoque_atual);
          const kg = metrosParaKg(faltaM, m);
          return kg != null
            ? { materia_prima_id: m.id, quantidade: faltaM > 0 ? String(+kg.toFixed(2)) : "", valor_unitario: "", unidade: "kg" as const }
            : { materia_prima_id: m.id, quantidade: faltaM > 0 ? String(Math.ceil(metrosParaBarras(faltaM, m))) : "", valor_unitario: "", unidade: "barra" as const };
        })
      : [{ materia_prima_id: "", quantidade: "", valor_unitario: "", unidade: "kg" }]);
    supabase.from("fornecedores").select("id,razao_social").order("razao_social")
      .then(({ data }) => setFornecedores(data ?? []));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItem = (i: number, patch: Partial<PedidoItemForm>) => setItens(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const validos = itens.filter(it => it.materia_prima_id && Number(it.quantidade) > 0);
  const valorTotal = validos.reduce((s, it) => s + (Number(it.quantidade) || 0) * (Number(it.valor_unitario) || 0), 0);

  async function save() {
    if (!form.fornecedor.trim()) { toast.error("Informe o fornecedor."); return; }
    if (validos.length === 0) { toast.error("Adicione ao menos uma barra com quantidade."); return; }
    setSaving(true);
    const { data: pedido, error } = await supabase.from("pedidos_compra").insert({
      fornecedor_nome: form.fornecedor.trim(),
      status: form.enviar ? "enviado" : "rascunho",
      data_previsao: form.data_previsao || null,
      valor_total: +valorTotal.toFixed(2),
      observacoes: form.observacoes ? `[Pedido de barras — Produção] ${form.observacoes}` : "[Pedido de barras — Produção]",
    }).select("id").single();
    if (error || !pedido) {
      setSaving(false);
      toast.error(error?.message?.includes("policy") ? "Seu perfil não tem permissão para criar pedidos de compra." : "Não foi possível criar o pedido.");
      return;
    }
    const linhas = validos.map(it => {
      const mp = materias.find(m => m.id === it.materia_prima_id)!;
      return { pedido_id: pedido.id, materia_prima_id: mp.id, descricao: `${mp.codigo} — ${mp.descricao}`, quantidade: Number(it.quantidade), unidade: it.unidade, valor_unitario: Number(it.valor_unitario) || 0 };
    });
    const { error: errItens } = await supabase.from("pedido_compra_itens").insert(linhas);
    setSaving(false);
    if (errItens) { toast.error("Pedido criado, mas houve erro ao salvar os itens."); return; }
    toast.success("Pedido de barras registrado.");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary" />Pedido de barras</DialogTitle>
          <DialogDescription>O pedido também aparece no módulo de Compras.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo label="Fornecedor *">
            <Input list="fornecedores-mp" value={form.fornecedor} onChange={e => setForm(p => ({ ...p, fornecedor: e.target.value }))} placeholder="Digite ou escolha" className="h-11" />
            <datalist id="fornecedores-mp">{fornecedores.map(f => <option key={f.id} value={f.razao_social} />)}</datalist>
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Previsão de entrega"><Input type="date" value={form.data_previsao} onChange={e => setForm(p => ({ ...p, data_previsao: e.target.value }))} className="h-11" /></Campo>
            <label className="flex items-center gap-2 text-sm h-11 sm:mt-6 cursor-pointer select-none rounded-xl border px-3">
              <input type="checkbox" checked={form.enviar} onChange={e => setForm(p => ({ ...p, enviar: e.target.checked }))} className="h-5 w-5 rounded border-input" />
              Já enviado ao fornecedor
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Barras do pedido *</p>
            {itens.map((it, i) => (
              <div key={i} className="rounded-xl border p-2 space-y-2">
                <div className="flex gap-2">
                  <select value={it.materia_prima_id} onChange={e => setItem(i, { materia_prima_id: e.target.value })} className={cn(selCls, "flex-1 min-w-0")} aria-label="Material">
                    <option value="">Material...</option>
                    {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                  </select>
                  {itens.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground hover:text-destructive shrink-0" aria-label="Remover barra"
                      onClick={() => setItens(prev => prev.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)] gap-2">
                  <Input inputMode="decimal" value={it.quantidade} onChange={e => setItem(i, { quantidade: dec(e.target.value) })} placeholder="Quantidade" className="h-11 tabular-nums" aria-label="Quantidade" />
                  <select value={it.unidade} onChange={e => setItem(i, { unidade: e.target.value as UnidadePedido })} className={selCls} aria-label="Unidade">
                    <option value="kg">kg</option><option value="barra">barras</option><option value="m">metros</option>
                  </select>
                  <Input inputMode="decimal" value={it.valor_unitario} onChange={e => setItem(i, { valor_unitario: dec(e.target.value) })} placeholder={`R$ por ${it.unidade}`} className="h-11 tabular-nums" aria-label="Valor unitário" />
                </div>
                {(() => {
                  const mp = materias.find(m => m.id === it.materia_prima_id);
                  const q = Number(it.quantidade) || 0;
                  if (!mp || q <= 0) return null;
                  const m = paraMetros(q, it.unidade, mp);
                  return <p className="text-xs text-muted-foreground tabular-nums px-1">
                    {m != null ? `≈ ${fmtMetros(m)} · ${equivalencias(m, mp)}` : `Peso da barra ${mp.codigo} não cadastrado — não dá para converter kg em metros ainda.`}
                  </p>;
                })()}
              </div>
            ))}
            <Button variant="outline" className="h-11 gap-1.5 w-full" onClick={() => setItens(prev => [...prev, { materia_prima_id: "", quantidade: "", valor_unitario: "", unidade: "kg" }])}>
              <Plus className="h-4 w-4" />Adicionar barra
            </Button>
          </div>
          <Campo label="Observações"><Input value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} placeholder="Ex.: bitola, norma, urgência..." className="h-11" /></Campo>
          {valorTotal > 0 && <p className="text-right text-sm">Total estimado: <strong className="tabular-nums">{formatBRL(valorTotal)}</strong></p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Registrar pedido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Movimentação ─────────────────────────────────────────────────────────────
// Entrada/saída em metros, barras ou kg (convertido para metros pelo peso da
// barra). "Contagem" = inventário: informa o que há na prateleira e o saldo
// passa a ser esse; lançamentos com data anterior não mexem mais no saldo.
function MovimentoDialog({ open, materias, inicial, onClose, onSaved }: {
  open: boolean; materias: MateriaPrima[]; inicial?: { mpId?: string; tipo?: MovimentoTipo }; onClose: () => void; onSaved: (m: Movimento, novo: MateriaPrima) => void;
}) {
  const [form, setForm] = useState({ materia_prima_id: "", tipo: "saida" as MovimentoTipo, quantidade: "", unidade: "barra" as UnidadePedido, lote: "", operador: "", ordem_producao: "", observacoes: "" });
  const [saving, setSaving] = useState(false);
  const { saveWithFallback } = useOfflineSync();
  const { user } = useAuth();
  useEffect(() => {
    if (open) setForm({ materia_prima_id: inicial?.mpId ?? "", tipo: inicial?.tipo ?? "saida", quantidade: "", unidade: "barra", lote: "", operador: lerOperador(), ordem_producao: "", observacoes: "" });
  }, [open, inicial]);

  const mp = materias.find(m => m.id === form.materia_prima_id);
  const qtdDigitada = Number(form.quantidade) || 0;
  const metros = mp ? paraMetros(qtdDigitada, form.unidade, mp) : null;
  const qtd = metros != null ? +metros.toFixed(3) : 0;
  const contagem = form.tipo === "ajuste";
  const saldoNovo = mp ? (contagem ? qtd : mp.estoque_atual + (form.tipo === "saida" ? -qtd : qtd)) : 0;

  async function save() {
    if (!mp || !form.operador.trim()) { toast.error("Escolha o material e informe o operador."); return; }
    if (metros == null) { toast.error(`Peso da barra ${mp.codigo} não cadastrado — informe em barras ou metros, ou cadastre o peso.`); return; }
    if (contagem ? qtd < 0 || form.quantidade === "" : qtd <= 0) { toast.error("Informe a quantidade."); return; }
    if (form.tipo === "saida" && qtd > mp.estoque_atual) { toast.error("Quantidade maior que o estoque."); return; }
    setSaving(true);
    const diferenca = +(saldoNovo - mp.estoque_atual).toFixed(3);
    const descQtd = form.unidade === "m" ? "" : ` (${form.quantidade} ${form.unidade === "kg" ? "kg" : "barras"})`;
    const mov: Movimento = {
      id: crypto.randomUUID(), materia_prima_id: mp.id, materia_prima_desc: mp.descricao,
      tipo: form.tipo, quantidade: contagem ? diferenca : qtd, lote: form.lote || mp.lote_atual || undefined, operador: form.operador.trim(),
      ordem_producao: form.ordem_producao || undefined,
      observacoes: [contagem ? `Contagem: ${fmtMetros(qtd)}${descQtd} (antes ${fmtMetros(mp.estoque_atual)})` : descQtd.trim(), form.observacoes].filter(Boolean).join(" — ") || undefined,
      user_id: user?.id, created_at: new Date().toISOString(),
    };
    const { error, savedOffline } = await saveWithFallback("movimentos_mp_producao", "movimentos_mp", "INSERT", mov);
    if (error) { setSaving(false); toast.error("Não foi possível registrar o movimento."); return; }
    const hoje = new Date().toISOString().split("T")[0];
    const mpUpdated: MateriaPrima = {
      ...mp, estoque_atual: +saldoNovo.toFixed(3),
      ultima_entrada: form.tipo === "entrada" ? hoje : mp.ultima_entrada,
      ultima_saida: form.tipo === "saida" ? hoje : mp.ultima_saida,
      lote_atual: form.lote || mp.lote_atual,
      estoque_conferido_em: contagem ? hoje : mp.estoque_conferido_em,
    };
    await saveWithFallback("materias_primas_producao", "materias_primas", "UPDATE", mpUpdated);
    setSaving(false);
    gravarOperador(form.operador.trim());
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : contagem ? "Saldo conferido." : "Movimento registrado.");
    onSaved(mov, mpUpdated); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Movimentar matéria-prima</DialogTitle>
          <DialogDescription>
            {contagem ? "Conte o que há na prateleira — o saldo passa a ser este valor." : "Entrada soma, saída tira do estoque. O consumo da produção já é baixado sozinho."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Segmentado cheio ariaLabel="Tipo de movimento" valor={form.tipo} onChange={t => setForm(p => ({ ...p, tipo: t }))}
            opcoes={[{ v: "saida", l: "Saída" }, { v: "entrada", l: "Entrada" }, { v: "ajuste", l: "Contagem" }]} />
          <Campo label="Material *">
            <select value={form.materia_prima_id} onChange={e => setForm(p => ({ ...p, materia_prima_id: e.target.value }))} className={selCls}>
              <option value="">Selecione...</option>
              {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
            </select>
            {mp && <p className="text-xs text-muted-foreground mt-1">Em estoque: <strong className="text-foreground">{fmtMetros(mp.estoque_atual)}</strong> ≈ {equivalencias(mp.estoque_atual, mp)}{mp.lote_atual ? ` · lote ${mp.lote_atual}` : ""}</p>}
          </Campo>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <Campo label={contagem ? "Quantidade contada *" : "Quantidade *"}>
              <Input inputMode="decimal" value={form.quantidade} onChange={e => setForm(p => ({ ...p, quantidade: dec(e.target.value) }))} className="h-12 text-lg font-bold tabular-nums" />
            </Campo>
            <Campo label="Em">
              <select value={form.unidade} onChange={e => setForm(p => ({ ...p, unidade: e.target.value as UnidadePedido }))} className={cn(selCls, "h-12")} aria-label="Unidade">
                <option value="barra">barras</option><option value="m">metros</option><option value="kg">kg</option>
              </select>
            </Campo>
          </div>
          {mp && form.quantidade !== "" && (
            <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm space-y-0.5">
              {metros == null
                ? <p className="text-amber-700 dark:text-amber-400">Peso da barra {mp.codigo} não cadastrado — use barras ou metros.</p>
                : <>
                    {form.unidade !== "m" && <p className="text-muted-foreground tabular-nums">= {fmtMetros(qtd)}</p>}
                    <p>Saldo depois: <strong className={cn("tabular-nums", saldoNovo < mp.estoque_minimo && "text-amber-600")}>{fmtMetros(saldoNovo)}</strong>
                      <span className="text-muted-foreground"> ≈ {equivalencias(Math.max(0, saldoNovo), mp)}</span></p>
                  </>}
            </div>
          )}
          <Campo label="Lote"><Input value={form.lote} onChange={e => setForm(p => ({ ...p, lote: e.target.value }))} placeholder={mp?.lote_atual || "opcional"} className="h-11" /></Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Operador *"><Input value={form.operador} onChange={e => setForm(p => ({ ...p, operador: e.target.value }))} placeholder="Seu nome" className="h-11" autoComplete="name" /></Campo>
            <Campo label="Ordem de produção"><Input value={form.ordem_producao} onChange={e => setForm(p => ({ ...p, ordem_producao: e.target.value }))} placeholder="Ex.: OP-2026-0012" className="h-11" /></Campo>
          </div>
          <Campo label="Observação"><Input value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} placeholder="Opcional" className="h-11" /></Campo>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Recebimento de pedido de barras (em kg) ──────────────────────────────────
interface ItemReceber { id: string; descricao: string; quantidade: number; unidade: string; quantidade_recebida: number; materia_prima_id: string | null; }

function ReceberDialog({ item, materias, onClose, onSaved }: {
  item: ItemReceber | null; materias: MateriaPrima[]; onClose: () => void; onSaved: () => void;
}) {
  const [kg, setKg] = useState("");
  const [barras, setBarras] = useState("");
  const [lote, setLote] = useState("");
  const [operador, setOperador] = useState("");
  const [gravarPeso, setGravarPeso] = useState(true);
  const [saving, setSaving] = useState(false);
  const mp = materias.find(m => m.id === item?.materia_prima_id);

  useEffect(() => {
    if (!item) return;
    const falta = Math.max(0, item.quantidade - item.quantidade_recebida);
    setKg(item.unidade === "kg" && falta > 0 ? String(+falta.toFixed(3)) : "");
    setBarras(item.unidade === "barra" && falta > 0 ? String(Math.round(falta)) : "");
    setLote(""); setOperador(lerOperador()); setGravarPeso(true);
  }, [item]);

  const kgN = Number(kg) || 0;
  const barrasN = Number(barras) || 0;
  const metros = !mp ? null : barrasN > 0 ? barrasN * comprimentoBarraM(mp) : kgN > 0 ? kgParaMetros(kgN, mp) : null;
  const pesoMedido = kgN > 0 && barrasN > 0 ? kgN / barrasN : null;
  const teorico = mp ? pesoTeoricoBarraKg(mp) : null;

  async function save() {
    if (!item || !mp) return;
    if (kgN <= 0 && barrasN <= 0) { toast.error("Informe o peso recebido (kg) ou o nº de barras."); return; }
    if (metros == null) { toast.error(`Peso da barra ${mp.codigo} não cadastrado — conte as barras recebidas.`); return; }
    if (!navigator.onLine) { toast.error("Sem internet — o recebimento precisa de conexão."); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("receber_barras_pedido", {
      p_item_id: item.id, p_kg: kgN, p_barras: barrasN > 0 ? barrasN : null,
      p_lote: lote.trim() || null, p_operador: operador.trim() || null, p_atualizar_peso: gravarPeso && !!pesoMedido,
    });
    setSaving(false);
    const res = data as { ok?: boolean; error?: string; metros?: number } | null;
    if (error || !res?.ok) { toast.error(res?.error ?? "Não foi possível registrar o recebimento."); return; }
    if (operador.trim()) gravarOperador(operador.trim());
    toast.success(`Recebido: +${fmtMetros(Number(res.metros) || metros)} de ${mp.codigo}`);
    onSaved(); onClose();
  }

  return (
    <Dialog open={!!item} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-primary" />Receber barras</DialogTitle>
          <DialogDescription>{item?.descricao} — pedido {item ? `${fmtQ(item.quantidade)} ${item.unidade}` : ""}{item && item.quantidade_recebida > 0 ? `, já recebido ${fmtQ(item.quantidade_recebida)}` : ""}</DialogDescription>
        </DialogHeader>
        {mp && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Peso recebido (kg)"><Input inputMode="decimal" value={kg} onChange={e => setKg(dec(e.target.value))} className="h-12 text-lg font-bold tabular-nums" autoFocus /></Campo>
              <Campo label="Nº de barras"><Input inputMode="numeric" value={barras} onChange={e => setBarras(e.target.value.replace(/\D/g, ""))} placeholder="contar (opcional)" className="h-12 text-lg tabular-nums" /></Campo>
            </div>
            <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm space-y-1">
              {metros != null
                ? <p>Entra no estoque: <strong className="tabular-nums">{fmtMetros(metros)}</strong> <span className="text-muted-foreground">≈ {fmtBarras(metrosParaBarras(metros, mp))}</span></p>
                : <p className="text-amber-700 dark:text-amber-400">O peso da barra {mp.codigo} ainda não foi cadastrado — conte as barras para converter.</p>}
              <p className="text-xs text-muted-foreground">
                {barrasN > 0 ? `Calculado pelas barras contadas (× ${comprimentoBarraM(mp).toLocaleString("pt-BR")} m).`
                  : pesoBarraKg(mp) ? `Calculado pelo peso cadastrado: ${fmtKg(pesoBarraKg(mp)!)} por barra.` : ""}
              </p>
            </div>
            {pesoMedido && (
              <label className="flex items-start gap-2 text-sm cursor-pointer select-none rounded-xl border px-3 py-2.5">
                <input type="checkbox" checked={gravarPeso} onChange={e => setGravarPeso(e.target.checked)} className="h-5 w-5 mt-0.5 rounded border-input" />
                <span>Gravar peso medido: <strong className="tabular-nums">{fmtKg(pesoMedido)}</strong> por barra
                  <span className="block text-xs text-muted-foreground">
                    {pesoBarraKg(mp) ? `Cadastrado hoje: ${fmtKg(pesoBarraKg(mp)!)}` : "Ainda não cadastrado"}{teorico ? ` · teórico ≈ ${fmtKg(teorico)}` : ""}
                  </span></span>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Lote / corrida"><Input value={lote} onChange={e => setLote(e.target.value)} placeholder={mp.lote_atual || "opcional"} className="h-11" /></Campo>
              <Campo label="Recebido por"><Input value={operador} onChange={e => setOperador(e.target.value)} placeholder="Seu nome" className="h-11" /></Campo>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving || !mp}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Dar entrada</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cadastro de matéria-prima ────────────────────────────────────────────────
function MateriaDialog({ open, materia, onClose, onSaved }: { open: boolean; materia: MateriaPrima | null; onClose: () => void; onSaved: (m: MateriaPrima) => void }) {
  const vazio = { codigo: "", descricao: "", unidade: "m", estoque_atual: "", estoque_minimo: "", estoque_maximo: "", fornecedor: "", localizacao: "", lote_atual: "",
    diametro_mm: "", comprimento_barra_m: "3", peso_barra_kg: "", sobra_barra_mm: "" };
  const [form, setForm] = useState(vazio);
  const [saving, setSaving] = useState(false);
  const { saveWithFallback } = useOfflineSync();
  useEffect(() => {
    if (!open) return;
    setForm(materia ? {
      codigo: materia.codigo, descricao: materia.descricao, unidade: materia.unidade || "m", estoque_atual: String(materia.estoque_atual),
      estoque_minimo: String(materia.estoque_minimo), estoque_maximo: String(materia.estoque_maximo), fornecedor: materia.fornecedor ?? "",
      localizacao: materia.localizacao ?? "", lote_atual: materia.lote_atual ?? "",
      diametro_mm: materia.diametro_mm ? String(materia.diametro_mm) : "", comprimento_barra_m: String(comprimentoBarraM(materia)),
      peso_barra_kg: materia.peso_barra_kg ? String(materia.peso_barra_kg) : "", sobra_barra_mm: materia.sobra_barra_mm ? String(materia.sobra_barra_mm) : "",
    } : vazio);
  }, [open, materia]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  const previa: BarraInfo = { descricao: form.descricao, diametro_mm: Number(form.diametro_mm) || null, comprimento_barra_m: Number(form.comprimento_barra_m) || 3 };
  const teorico = pesoTeoricoBarraKg(previa);

  async function save() {
    if (!form.codigo.trim() || !form.descricao.trim()) { toast.error("Código e descrição são obrigatórios."); return; }
    setSaving(true);
    const data: MateriaPrima = {
      ...(materia ?? {}), id: materia?.id ?? crypto.randomUUID(), codigo: form.codigo.trim().toUpperCase(), descricao: form.descricao.trim(), unidade: form.unidade.trim() || "m",
      estoque_atual: materia ? materia.estoque_atual : Number(form.estoque_atual) || 0,
      estoque_minimo: Number(form.estoque_minimo) || 0, estoque_maximo: Number(form.estoque_maximo) || 999,
      fornecedor: form.fornecedor.trim() || null, localizacao: form.localizacao.trim() || null, lote_atual: form.lote_atual.trim() || null,
      diametro_mm: Number(form.diametro_mm) > 0 ? Number(form.diametro_mm) : null,
      comprimento_barra_m: Number(form.comprimento_barra_m) > 0 ? Number(form.comprimento_barra_m) : 3,
      peso_barra_kg: Number(form.peso_barra_kg) > 0 ? Number(form.peso_barra_kg) : null,
      sobra_barra_mm: Math.max(0, Number(form.sobra_barra_mm) || 0),
    };
    if (data.sobra_barra_mm! >= data.comprimento_barra_m! * 1000) { setSaving(false); toast.error("A sobra por barra precisa ser menor que o comprimento da barra."); return; }
    const { data: saved, error, savedOffline } = await saveWithFallback("materias_primas_producao", "materias_primas", materia ? "UPDATE" : "INSERT", data);
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar."); return; }
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : materia ? "Material atualizado." : "Material cadastrado.");
    onSaved(normMP((saved as MateriaPrima) || data)); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{materia ? `Editar ${materia.codigo}` : "Nova matéria-prima"}</DialogTitle>
          <DialogDescription>{materia ? "O saldo muda só por movimentos (entrada/saída)." : "Informe o saldo inicial, se já houver material."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Campo label="Código *"><Input value={form.codigo} onChange={e => set("codigo", e.target.value)} className="h-11 uppercase" placeholder="TI-GR4-6" /></Campo>
            <Campo label="Unidade"><Input value={form.unidade} onChange={e => set("unidade", e.target.value)} className="h-11" /></Campo>
          </div>
          <Campo label="Descrição *"><Input value={form.descricao} onChange={e => set("descricao", e.target.value)} className="h-11" placeholder="Barra titânio Gr.4 Ø6" /></Campo>
          <div className="grid grid-cols-3 gap-3">
            <Campo label="Saldo inicial"><Input inputMode="decimal" value={form.estoque_atual} onChange={e => set("estoque_atual", dec(e.target.value))} disabled={!!materia} className="h-11 tabular-nums" /></Campo>
            <Campo label="Mínimo"><Input inputMode="decimal" value={form.estoque_minimo} onChange={e => set("estoque_minimo", dec(e.target.value))} className="h-11 tabular-nums" /></Campo>
            <Campo label="Máximo"><Input inputMode="decimal" value={form.estoque_maximo} onChange={e => set("estoque_maximo", dec(e.target.value))} className="h-11 tabular-nums" /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Fornecedor"><Input value={form.fornecedor} onChange={e => set("fornecedor", e.target.value)} className="h-11" /></Campo>
            <Campo label="Localização"><Input value={form.localizacao} onChange={e => set("localizacao", e.target.value)} className="h-11" placeholder="Ex.: Rack A2" /></Campo>
          </div>
          <Campo label="Lote atual"><Input value={form.lote_atual} onChange={e => set("lote_atual", e.target.value)} className="h-11" /></Campo>

          <div className="rounded-xl border p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" />Barra — compra por kg, consumo por metro</p>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Diâmetro (mm)"><Input inputMode="decimal" value={form.diametro_mm} onChange={e => set("diametro_mm", dec(e.target.value))} placeholder="Ex.: 4" className="h-11 tabular-nums" /></Campo>
              <Campo label="Comprimento da barra (m)"><Input inputMode="decimal" value={form.comprimento_barra_m} onChange={e => set("comprimento_barra_m", dec(e.target.value))} className="h-11 tabular-nums" /></Campo>
              <Campo label="Peso de 1 barra (kg) — pesado">
                <Input inputMode="decimal" value={form.peso_barra_kg} onChange={e => set("peso_barra_kg", dec(e.target.value))}
                  placeholder={teorico ? `teórico ≈ ${teorico.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}` : "pese uma barra"} className="h-11 tabular-nums" />
              </Campo>
              <Campo label="Ponta que sobra (mm/barra)"><Input inputMode="decimal" value={form.sobra_barra_mm} onChange={e => set("sobra_barra_mm", dec(e.target.value))} placeholder="0" className="h-11 tabular-nums" /></Campo>
            </div>
            <p className="text-xs text-muted-foreground">
              {Number(form.peso_barra_kg) > 0
                ? `1 kg ≈ ${(Number(form.comprimento_barra_m || 3) / Number(form.peso_barra_kg)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m de barra.`
                : teorico ? `Sem o peso medido, o pedido em kg não é convertido. Estimativa pela densidade: ${fmtKg(teorico)} por barra — confira na balança.`
                : "Pese uma barra inteira deste diâmetro e informe aqui."}
              {" "}Saldo, mínimo e máximo são em metros ({comprimentoBarraM(previa).toLocaleString("pt-BR")} m = 1 barra).
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Painel ───────────────────────────────────────────────────────────────────
export function MateriaPrimaPanel() {
  const { role } = useAuth();
  const gestor = temPapel(role, "producao");
  const [materias, setMaterias] = useState<MateriaPrima[]>([]);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [pedidos, setPedidos] = useState<PedidoBarras[]>([]);
  const [loading, setLoading] = useState(true);
  const [mov, setMov] = useState<{ open: boolean; mpId?: string; tipo?: MovimentoTipo }>({ open: false });
  const [pedidoOpen, setPedidoOpen] = useState(false);
  const [receber, setReceber] = useState<ItemReceber | null>(null);
  const [cadastro, setCadastro] = useState<{ open: boolean; materia: MateriaPrima | null }>({ open: false, materia: null });
  const [search, setSearch] = useState("");
  const [aba, setAba] = useState<"estoque" | "movimentos" | "pedidos">("estoque");
  const [soAlerta, setSoAlerta] = useState(false);
  const { loadWithFallback } = useOfflineSync();

  const loadPedidos = useCallback(async () => {
    // Pedidos de barras = pedidos_compra cujos itens apontam para materias_primas_producao.
    const { data } = await supabase.from("pedidos_compra")
      .select("id,fornecedor_nome,status,data_pedido,data_previsao,valor_total,observacoes,created_at,pedido_compra_itens(id,descricao,quantidade,unidade,quantidade_recebida,materia_prima_id)")
      .order("created_at", { ascending: false }).limit(50);
    if (!data) { setPedidos([]); return; }
    setPedidos(data
      .filter(p => (p.pedido_compra_itens ?? []).some((it: { materia_prima_id: string | null }) => it.materia_prima_id))
      .map(p => ({
        id: p.id, fornecedor_nome: p.fornecedor_nome, status: p.status,
        data_pedido: p.data_pedido, data_previsao: p.data_previsao,
        valor_total: Number(p.valor_total) || 0, observacoes: p.observacoes, created_at: p.created_at,
        itens: (p.pedido_compra_itens ?? []).map((it: { id: string; descricao: string; quantidade: number; unidade: string; quantidade_recebida: number; materia_prima_id: string | null }) => ({
          id: it.id, descricao: it.descricao, quantidade: Number(it.quantidade) || 0, unidade: it.unidade, quantidade_recebida: Number(it.quantidade_recebida) || 0,
          materia_prima_id: it.materia_prima_id,
        })),
      })));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [mats, movs] = await Promise.all([
      loadWithFallback<MateriaPrima>("materias_primas_producao", "materias_primas"),
      loadWithFallback<Movimento>("movimentos_mp_producao", "movimentos_mp"),
      loadPedidos(),
    ]);
    setMaterias(mats.map(normMP).sort((a, b) => a.codigo.localeCompare(b.codigo)));
    setMovimentos([...movs].map(m => ({ ...m, quantidade: Number(m.quantidade) || 0 })).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")));
    setLoading(false);
  }, [loadWithFallback, loadPedidos]);

  useEffect(() => { load(); }, [load]);

  const alerta = materias.filter(m => m.estoque_atual <= m.estoque_minimo);
  const q = search.trim().toLowerCase();
  const filtered = materias.filter(m => (!soAlerta || m.estoque_atual <= m.estoque_minimo) && (!q || [m.codigo, m.descricao, m.fornecedor || "", m.lote_atual || ""].some(v => v.toLowerCase().includes(q))));
  const movsFiltrados = movimentos.filter(m => !q || [m.materia_prima_desc, m.operador, m.lote || "", m.ordem_producao || ""].some(v => v.toLowerCase().includes(q)));
  const pedidosFiltrados = pedidos.filter(p => !q || [p.fornecedor_nome, ...p.itens.map(i => i.descricao)].some(v => v.toLowerCase().includes(q)));
  const pedidosAbertos = pedidos.filter(p => p.status === "enviado" || p.status === "parcial" || p.status === "rascunho").length;
  // Consumo médio (saídas dos últimos 30 dias, inclui a baixa automática da
  // produção) → em quantos dias cada barra acaba no ritmo atual.
  const previsao = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); const iso = d.toISOString();
    const saidas = new Map<string, number>();
    for (const m of movimentos) {
      if (m.tipo !== "saida" || (m.created_at ?? "") < iso) continue;
      saidas.set(m.materia_prima_id, (saidas.get(m.materia_prima_id) ?? 0) + (Number(m.quantidade) || 0));
    }
    const out = new Map<string, { porDia: number; dias: number | null }>();
    for (const mp of materias) {
      const porDia = (saidas.get(mp.id) ?? 0) / 30;
      out.set(mp.id, { porDia, dias: porDia > 0 ? Math.max(0, mp.estoque_atual) / porDia : null });
    }
    return out;
  }, [movimentos, materias]);
  const acabando = materias.filter(m => { const d = previsao.get(m.id)?.dias; return d != null && d <= DIAS_ALERTA; });

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Materiais" Icon={Boxes} value={materias.length} sub="cadastrados" onClick={() => { setAba("estoque"); setSoAlerta(false); }} />
        <KpiCard label="Abaixo do mínimo" Icon={AlertTriangle} value={alerta.length} tom={alerta.length ? "ruim" : "ok"}
          sub={alerta.length ? "toque para ver" : "tudo ok"} ativo={soAlerta && aba === "estoque"} onClick={() => { setAba("estoque"); setSoAlerta(s => !s); }} />
        <KpiCard label={`Acaba em ${DIAS_ALERTA} dias`} Icon={CalendarClock} value={acabando.length} tom={acabando.length ? "atencao" : "ok"}
          sub="no consumo atual" onClick={() => setAba("estoque")} />
        <KpiCard label="Pedidos em aberto" Icon={Truck} value={pedidosAbertos} tom={pedidosAbertos ? "atencao" : "neutro"} sub="barras a receber" onClick={() => setAba("pedidos")} />
      </div>

      {alerta.length > 0 && aba === "estoque" && !soAlerta && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[12rem]"><b>{alerta.length}</b> material{alerta.length > 1 ? "is" : ""} abaixo do estoque mínimo.</span>
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setPedidoOpen(true)}><ShoppingCart className="h-4 w-4" />Pedir barras</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmentado className="w-full sm:w-auto" cheio ariaLabel="Seção" valor={aba} onChange={setAba}
          opcoes={[{ v: "estoque", l: "Estoque" }, { v: "movimentos", l: "Movimentos" }, { v: "pedidos", l: "Pedidos", n: pedidosAbertos }]} />
        <SearchInputWithBarcode className="flex-1 min-w-[12rem]" value={search} onChange={setSearch} onSearch={setSearch} placeholder="Bipe ou busque material, lote, fornecedor..." height="h-11" />
        <BotaoAtualizar onClick={load} loading={loading} />
        <div className="flex gap-2 w-full sm:w-auto">
          {aba === "pedidos"
            ? <Button className="h-11 gap-1.5 flex-1 sm:flex-none" onClick={() => setPedidoOpen(true)}><ShoppingCart className="h-4 w-4" />Pedir barras</Button>
            : <Button className="h-11 gap-1.5 flex-1 sm:flex-none" onClick={() => setMov({ open: true })}><SlidersHorizontal className="h-4 w-4" />Movimentar</Button>}
          {gestor && aba === "estoque" && <Button variant="outline" className="h-11 gap-1.5 flex-1 sm:flex-none" onClick={() => setCadastro({ open: true, materia: null })}><PackagePlus className="h-4 w-4" />Novo material</Button>}
        </div>
      </div>

      <section className="rounded-2xl border bg-card overflow-hidden">
        {loading ? <Carregando /> : aba === "estoque" ? (
          filtered.length === 0 ? (
            <Vazio Icon={Boxes} titulo={materias.length === 0 ? "Nenhuma matéria-prima cadastrada" : "Nenhum material encontrado"}
              dica={materias.length === 0 ? "Cadastre as barras usadas na produção para controlar o saldo." : "Limpe a busca ou o filtro."}
              acao={gestor && materias.length === 0 ? <Button className="h-11 gap-1.5" onClick={() => setCadastro({ open: true, materia: null })}><PackagePlus className="h-4 w-4" />Cadastrar material</Button> : undefined} />
          ) : (
            <ul className="divide-y">
              {filtered.map(m => {
                const pct = Math.min(100, (m.estoque_atual / Math.max(m.estoque_maximo, 1)) * 100);
                const minPct = Math.min(100, (m.estoque_minimo / Math.max(m.estoque_maximo, 1)) * 100);
                const abaixo = m.estoque_atual <= m.estoque_minimo;
                const prev = previsao.get(m.id);
                const semPeso = !pesoBarraKg(m);
                return (
                  <li key={m.id} className={cn("px-4 py-3 grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center", abaixo && "bg-amber-500/[0.05]")}>
                    <div className="min-w-0">
                      <p className="font-semibold flex items-center gap-1.5">{m.codigo}{abaixo && <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Abaixo do mínimo" />}</p>
                      <p className="text-sm text-muted-foreground truncate">{m.descricao}</p>
                      <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                        {m.fornecedor && <span>{m.fornecedor}</span>}
                        {m.lote_atual && <span>Lote {m.lote_atual}</span>}
                        {m.localizacao && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{m.localizacao}</span>}
                        {pesoBarraKg(m) ? <span className="inline-flex items-center gap-0.5"><Scale className="h-3 w-3" />{fmtKg(pesoBarraKg(m)!)}/barra</span> : null}
                      </p>
                      {semPeso && gestor && (
                        <button type="button" onClick={() => setCadastro({ open: true, materia: m })}
                          className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/20">
                          <Scale className="h-3 w-3" />Pesar barra e cadastrar o peso
                        </button>
                      )}
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <strong className={cn("tabular-nums", abaixo && "text-amber-600")}>{fmtQ(m.estoque_atual)} {m.unidade}</strong>
                        <span className="text-xs text-muted-foreground tabular-nums">mín {fmtQ(m.estoque_minimo)} · máx {fmtQ(m.estoque_maximo)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">≈ {equivalencias(Math.max(0, m.estoque_atual), m)}</p>
                      <div className="relative mt-1 h-2 rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", abaixo ? "bg-amber-500" : "bg-green-500")} style={{ width: `${pct}%` }} />
                        <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground/50" style={{ left: `${minPct}%` }} aria-hidden />
                      </div>
                      {prev && prev.porDia > 0 && (
                        <p className={cn("mt-1 text-xs tabular-nums", prev.dias != null && prev.dias <= DIAS_ALERTA ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                          Gasta ~{fmtMetros(prev.porDia)}/dia · {prev.dias != null && prev.dias < 1 ? "acaba hoje" : `acaba em ~${Math.floor(prev.dias ?? 0)} dias`}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" className="h-10 gap-1" onClick={() => setMov({ open: true, mpId: m.id, tipo: "saida" })} aria-label={`Saída de ${m.codigo}`}><ArrowUp className="h-4 w-4 text-red-600" />Saída</Button>
                      <Button size="sm" variant="outline" className="h-10 gap-1" onClick={() => setMov({ open: true, mpId: m.id, tipo: "entrada" })} aria-label={`Entrada de ${m.codigo}`}><ArrowDown className="h-4 w-4 text-green-600" />Entrada</Button>
                      {gestor && <Button size="icon" variant="ghost" className="h-10 w-10" aria-label={`Editar ${m.codigo}`} onClick={() => setCadastro({ open: true, materia: m })}><Pencil className="h-4 w-4" /></Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : aba === "pedidos" ? (
          pedidosFiltrados.length === 0 ? (
            <Vazio Icon={ShoppingCart} titulo="Nenhum pedido de barras" dica="Os pedidos feitos aqui também aparecem em Compras."
              acao={<Button className="h-11 gap-1.5" onClick={() => setPedidoOpen(true)}><Plus className="h-4 w-4" />Fazer pedido</Button>} />
          ) : (
            <ul className="divide-y">
              {pedidosFiltrados.map(p => {
                const st = STATUS_PEDIDO[p.status] ?? STATUS_PEDIDO.rascunho;
                const recebidoTotal = p.itens.every(i => i.quantidade_recebida >= i.quantidade);
                return (
                  <li key={p.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{p.fornecedor_nome}</p>
                        <p className="text-xs text-muted-foreground">
                          Pedido em {fmtD(p.data_pedido)}
                          {p.data_previsao && <> · <Truck className="inline h-3 w-3 -mt-0.5" /> previsão {fmtD(p.data_previsao)}</>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                        {p.valor_total > 0 && <p className="text-sm font-semibold tabular-nums mt-1">{formatBRL(p.valor_total)}</p>}
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {p.itens.map(it => (
                        <li key={it.id} className="flex items-center gap-2 text-sm">
                          {it.quantidade_recebida >= it.quantidade ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" /> : <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />}
                          <span className="truncate flex-1">{it.descricao}</span>
                          <span className="text-muted-foreground shrink-0 tabular-nums text-xs">{it.quantidade_recebida > 0 ? `${fmtQ(it.quantidade_recebida)}/` : ""}{fmtQ(it.quantidade)} {it.unidade === "barra" ? "barras" : it.unidade}</span>
                          {it.materia_prima_id && it.quantidade_recebida < it.quantidade && p.status !== "cancelado" && p.status !== "rascunho" && (
                            <Button size="sm" variant="outline" className="h-9 gap-1 shrink-0" onClick={() => setReceber(it)}>
                              <PackageCheck className="h-4 w-4" />Receber
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {recebidoTotal && p.status !== "recebido" && <p className="text-xs text-green-600">Tudo recebido.</p>}
                  </li>
                );
              })}
            </ul>
          )
        ) : movsFiltrados.length === 0 ? (
          <Vazio Icon={ArrowDown} titulo="Nenhum movimento registrado" dica="Registre as saídas para a produção e as entradas de barras." />
        ) : (
          <ul className="divide-y">
            {movsFiltrados.slice(0, 60).map(m => (
              <li key={m.id} className="px-4 py-3 flex items-center gap-3">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
                  m.tipo === "entrada" ? "bg-green-500/10" : m.tipo === "saida" ? "bg-red-500/10" : "bg-blue-500/10")}>
                  {m.tipo === "entrada" ? <ArrowDown className="h-4 w-4 text-green-600" /> : m.tipo === "saida" ? <ArrowUp className="h-4 w-4 text-red-600" /> : <SlidersHorizontal className="h-4 w-4 text-blue-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.materia_prima_desc}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.operador}{m.ordem_producao ? ` · ${m.ordem_producao}` : ""}{m.lote ? ` · lote ${m.lote}` : ""}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("font-semibold tabular-nums", m.tipo === "entrada" ? "text-green-600" : m.tipo === "saida" ? "text-red-600" : "text-blue-600")}>
                    {m.tipo === "entrada" ? "+" : m.tipo === "saida" ? "−" : "±"}{fmtQ(m.quantidade)}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtD(m.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MovimentoDialog open={mov.open} materias={materias} inicial={mov} onClose={() => setMov({ open: false })}
        onSaved={(novo, mp) => { setMovimentos(prev => [novo, ...prev]); setMaterias(prev => prev.map(m => m.id === mp.id ? mp : m)); }} />
      <ReceberDialog item={receber} materias={materias} onClose={() => setReceber(null)} onSaved={load} />
      <PedidoBarrasDialog open={pedidoOpen} materias={materias} sugeridos={alerta} onClose={() => setPedidoOpen(false)} onSaved={loadPedidos} />
      <MateriaDialog open={cadastro.open} materia={cadastro.materia} onClose={() => setCadastro({ open: false, materia: null })}
        onSaved={m => setMaterias(prev => (prev.some(x => x.id === m.id) ? prev.map(x => x.id === m.id ? m : x) : [...prev, m]).sort((a, b) => a.codigo.localeCompare(b.codigo)))} />
    </div>
  );
}
