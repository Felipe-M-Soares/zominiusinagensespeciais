/**
 * Pós-venda — rastreabilidade lote → cliente e recall (antes eram duas abas:
 * "Rastreab. Pós-venda" e "Recall"; tudo continua aqui).
 *
 *  • Lista os envios (registro criado sozinho quando o pedido é marcado como
 *    "Enviado"), com busca por lote, referência, modelo, UDI-DI ou cliente.
 *  • KPIs clicáveis: recall ativo, em alerta, devolvidos, envios em 30 dias.
 *  • Seleção múltipla para mudar o status de recall em lote + exportar CSV.
 *  • Detalhe: contato do cliente para recall, destino clínico (clínica,
 *    cirurgião, código do paciente) e observações — editáveis enquanto o
 *    produto não voltou ("devolvido" fica só leitura, exceto o status).
 *
 * Escrita: a policy `rastr_write` libera admin/qualidade/comercial. Toda
 * gravação confere se alguma linha foi de fato alterada — se o perfil não
 * tem permissão no banco, avisa em vez de "salvar" em silêncio.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, Download, Loader2, Lock, MapPin, Package, RefreshCw, Save, Truck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { temPapel } from "@/types/roles";
import { sanitizeQuery } from "@/lib/sanitize";
import { friendlyError } from "@/lib/errorMessages";
import { logger } from "@/lib/logger";
import { baixarCsv, hojeISO, somarDias } from "@/lib/financeiro";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CampoBusca, Campo, Chip, KpiCard, ListaSkeleton, SELECT_CLS, STATUS_RECALL, Vazio, fmtDia, recallInfo, RECALL_INFO, type StatusRecall,
} from "./shared";

interface RastrItem {
  id: string; lote: string; device_ref: string; device_model: string; udi_di: string | null;
  quantidade: number; cliente_nome: string; clinica: string | null; cirurgiao: string | null;
  paciente_codigo: string | null;
  data_envio: string; status_recall: string; observacoes: string | null;
  pedido_id: string | null; cliente_id: string | null;
}

interface ClienteInfo { telefone: string | null; email: string | null; documento: string | null; endereco: string | null }

type Filtro = "todos" | "atencao" | StatusRecall;

interface Contagem { recall: number; alerta: number; devolvido: number; envios30: number }

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todos", label: "Todos os envios" },
  { id: "atencao", label: "Recall + alerta" },
  { id: "recall_ativo", label: "Recall ativo" },
  { id: "alerta", label: "Em alerta" },
  { id: "normal", label: "Normal" },
  { id: "devolvido", label: "Devolvidos" },
];

export function RastreabilidadePanel({ filtroInicial, onMudou }: { filtroInicial?: string | null; onMudou?: () => void }) {
  const { isAdmin, role } = useAuth();
  const podeEscrever = temPapel(role, "qualidade", "comercial");
  const [filtro, setFiltro] = useState<Filtro>(() => FILTROS.some(f => f.id === filtroInicial) ? filtroInicial as Filtro : "todos");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [items, setItems] = useState<RastrItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [contagem, setContagem] = useState<Contagem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusLote, setStatusLote] = useState<StatusRecall>("normal");
  const [updating, setUpdating] = useState(false);
  const [aberto, setAberto] = useState<RastrItem | null>(null);

  // Busca aplicada com pequeno atraso (evita uma consulta por tecla)
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const carregarContagem = useCallback(async () => {
    const base = () => supabase.from("rastreabilidade_pos_venda").select("id", { count: "exact", head: true });
    const [r, a, d, e] = await Promise.all([
      base().eq("status_recall", "recall_ativo"),
      base().eq("status_recall", "alerta"),
      base().eq("status_recall", "devolvido"),
      base().gte("data_envio", somarDias(hojeISO(), -30)),
    ]);
    setContagem({ recall: r.count ?? 0, alerta: a.count ?? 0, devolvido: d.count ?? 0, envios30: e.count ?? 0 });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from("rastreabilidade_pos_venda").select("*");
      if (filtro === "atencao") q = q.in("status_recall", ["alerta", "recall_ativo"]);
      else if (filtro !== "todos") q = q.eq("status_recall", filtro);
      const s = sanitizeQuery(buscaAplicada);
      if (s) q = q.or(`lote.ilike.%${s}%,device_ref.ilike.%${s}%,device_model.ilike.%${s}%,cliente_nome.ilike.%${s}%,udi_di.ilike.%${s}%,clinica.ilike.%${s}%`);
      const { data, error } = await q.order("data_envio", { ascending: false }).limit(300);
      if (error) throw error;
      setItems((data ?? []) as unknown as RastrItem[]);
      setSelected(new Set());
    } catch (err) {
      logger.error("Pós-venda: erro ao carregar", err);
      toast.error("Não foi possível carregar a rastreabilidade.");
    } finally {
      setLoading(false);
    }
  }, [filtro, buscaAplicada]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { carregarContagem(); }, [carregarContagem]);

  const recarregar = useCallback(() => { load(); carregarContagem(); onMudou?.(); }, [load, carregarContagem, onMudou]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const todosMarcados = items.length > 0 && selected.size === items.length;

  async function aplicarEmLote() {
    if (selected.size === 0) { toast.error("Selecione ao menos um envio"); return; }
    setUpdating(true);
    const ids = [...selected];
    const { data, error } = await supabase.from("rastreabilidade_pos_venda").update({ status_recall: statusLote }).in("id", ids).select("id");
    setUpdating(false);
    if (error) { toast.error(friendlyError(error)); return; }
    if (!data?.length) { toast.error("Seu perfil não tem permissão para alterar o status de recall."); return; }
    toast.success(`${data.length} envio(s) marcados como "${RECALL_INFO[statusLote].label}"`);
    recarregar();
  }

  function exportCSV() {
    baixarCsv(`rastreabilidade-${hojeISO()}.csv`,
      ["Lote", "Referência", "Modelo", "UDI-DI", "Quantidade", "Cliente", "Clínica", "Cirurgião", "Data de envio", "Status"],
      items.map(i => [i.lote, i.device_ref, i.device_model, i.udi_di, i.quantidade, i.cliente_nome, i.clinica, i.cirurgiao, fmtDia(i.data_envio), recallInfo(i.status_recall).label]));
  }

  const alternar = (f: Filtro) => setFiltro(atual => atual === f ? "todos" : f);
  const kpiValor = (n: number | undefined) => n === undefined ? "—" : n;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Recall ativo" value={kpiValor(contagem?.recall)} Icon={AlertTriangle} tom={contagem?.recall ? "perigo" : "neutro"}
          sub="envios a recolher" ativo={filtro === "recall_ativo"} onClick={() => alternar("recall_ativo")} />
        <KpiCard label="Em alerta" value={kpiValor(contagem?.alerta)} Icon={Bell} tom={contagem?.alerta ? "atencao" : "neutro"}
          sub="lotes sob observação" ativo={filtro === "alerta"} onClick={() => alternar("alerta")} />
        <KpiCard label="Devolvidos" value={kpiValor(contagem?.devolvido)} Icon={Undo2}
          sub="produto já voltou" ativo={filtro === "devolvido"} onClick={() => alternar("devolvido")} />
        <KpiCard label="Envios em 30 dias" value={kpiValor(contagem?.envios30)} Icon={Truck} tom="info"
          sub="lotes que saíram para clientes" onClick={() => setFiltro("todos")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CampoBusca value={busca} onChange={setBusca} onEnter={() => setBuscaAplicada(busca.trim())} placeholder="Lote, peça, cliente ou clínica..." />
        <select value={filtro} onChange={e => setFiltro(e.target.value as Filtro)} aria-label="Situação" className={cn(SELECT_CLS, "w-auto flex-1 sm:flex-none")}>
          {FILTROS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={recarregar} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <Button variant="outline" className="h-11 gap-1.5" onClick={exportCSV} disabled={!items.length}>
          <Download className="h-4 w-4" />Excel
        </Button>
        {isAdmin && (
          <ClearHistoryButton rpc="admin_clear_rastreabilidade"
            confirmTitle="Apagar rastreabilidade pós-venda?"
            confirmDescription="Apaga todos os registros de lote → cliente/recall. Pedidos, estoque e cadastro de peças são mantidos."
            onCleared={recarregar} />
        )}
      </div>

      {selected.size > 0 && podeEscrever && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-primary flex-1 min-w-[8rem]">{selected.size} selecionado(s)</p>
          <select value={statusLote} onChange={e => setStatusLote(e.target.value as StatusRecall)} aria-label="Novo status" className={cn(SELECT_CLS, "w-auto flex-1 sm:flex-none")}>
            {STATUS_RECALL.map(s => <option key={s} value={s}>Marcar como: {RECALL_INFO[s].label}</option>)}
          </select>
          <Button className="h-11" onClick={aplicarEmLote} disabled={updating}>
            {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setSelected(new Set())}>Limpar</Button>
        </div>
      )}

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && items.length === 0 ? <ListaSkeleton /> : items.length === 0 ? (
          buscaAplicada ? (
            <Vazio Icon={Package} titulo={`Nada encontrado para "${buscaAplicada}"`} dica="Os registros são criados automaticamente quando um pedido é marcado como “Enviado”." />
          ) : filtro === "recall_ativo" || filtro === "alerta" || filtro === "atencao" ? (
            <Vazio Icon={CheckCircle2} titulo="Nenhum recall ou alerta ativo" dica="Todos os lotes enviados estão com status normal."
              acao={<Button variant="outline" onClick={() => setFiltro("todos")}>Ver todos os envios</Button>} />
          ) : (
            <Vazio Icon={Truck} titulo="Nenhum envio registrado" dica="Os registros são criados automaticamente quando um pedido é marcado como “Enviado”." />
          )
        ) : (
          <>
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-3 text-xs text-muted-foreground">
              {podeEscrever && (
                <label className="h-8 w-8 -ml-1.5 flex items-center justify-center cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={todosMarcados} aria-label="Selecionar todos"
                    onChange={() => setSelected(todosMarcados ? new Set() : new Set(items.map(i => i.id)))} />
                </label>
              )}
              <span>{items.length} envio{items.length !== 1 ? "s" : ""}{items.length === 300 ? " (mostrando os 300 mais recentes — refine a busca)" : ""}</span>
            </div>
            <ul className="divide-y">
              {items.map(r => {
                const info = recallInfo(r.status_recall);
                return (
                  <li key={r.id} className={cn("flex items-stretch hover:bg-muted/30 transition-colors",
                    r.status_recall === "recall_ativo" && "bg-red-500/5", r.status_recall === "alerta" && "bg-amber-500/5")}>
                    {podeEscrever && (
                      <label className="pl-2.5 pr-0.5 flex items-center justify-center cursor-pointer shrink-0">
                        <span className="h-10 w-10 flex items-center justify-center">
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} aria-label={`Selecionar lote ${r.lote}`} />
                        </span>
                      </label>
                    )}
                    <button type="button" onClick={() => setAberto(r)} className={cn("flex-1 min-w-0 text-left py-3 pr-4 flex items-center gap-3", !podeEscrever && "pl-4")}>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={cn("h-2 w-2 rounded-full shrink-0", info.dot)} />
                          <span className="font-mono font-semibold text-sm">{r.lote}</span>
                          <Chip tom={info.tom}>{info.label}</Chip>
                        </div>
                        <p className="text-sm truncate"><span className="font-mono text-muted-foreground">{r.device_ref}</span> · {r.device_model}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          <MapPin className="inline h-3 w-3 -mt-0.5 mr-0.5" />{r.cliente_nome}{r.clinica ? ` · ${r.clinica}` : ""}{r.cirurgiao ? ` · Dr(a). ${r.cirurgiao}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold tabular-nums">{r.quantidade}<span className="text-xs font-normal text-muted-foreground ml-0.5">un.</span></p>
                        <p className="text-[11px] text-muted-foreground">{fmtDia(r.data_envio)}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {aberto && (
        <DetalheEnvioDialog item={aberto} podeEscrever={podeEscrever} onClose={() => setAberto(null)}
          onSaved={() => { setAberto(null); recarregar(); }} />
      )}
    </div>
  );
}

// ─── Detalhe de um envio ─────────────────────────────────────────────────────

function DetalheEnvioDialog({ item, podeEscrever, onClose, onSaved }: { item: RastrItem; podeEscrever: boolean; onClose: () => void; onSaved: () => void }) {
  const [cliente, setCliente] = useState<ClienteInfo | null>(null);
  const [status, setStatus] = useState<StatusRecall>((STATUS_RECALL as string[]).includes(item.status_recall) ? item.status_recall as StatusRecall : "normal");
  const [form, setForm] = useState({
    clinica: item.clinica ?? "", cirurgiao: item.cirurgiao ?? "", paciente_codigo: item.paciente_codigo ?? "", observacoes: item.observacoes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const encerrado = item.status_recall === "devolvido";
  const podeEditarDestino = podeEscrever && !encerrado;

  useEffect(() => {
    if (!item.cliente_id) return;
    supabase.from("clientes").select("telefone,email,documento,endereco").eq("id", item.cliente_id).maybeSingle()
      .then(({ data }) => setCliente((data as ClienteInfo | null) ?? null));
  }, [item.cliente_id]);

  const mudou = useMemo(() => status !== item.status_recall
    || form.clinica !== (item.clinica ?? "") || form.cirurgiao !== (item.cirurgiao ?? "")
    || form.paciente_codigo !== (item.paciente_codigo ?? "") || form.observacoes !== (item.observacoes ?? ""), [status, form, item]);

  async function salvar() {
    setSaving(true);
    const patch: { status_recall: string; clinica?: string | null; cirurgiao?: string | null; paciente_codigo?: string | null; observacoes?: string | null } = { status_recall: status };
    if (podeEditarDestino) {
      patch.clinica = form.clinica.trim() || null;
      patch.cirurgiao = form.cirurgiao.trim() || null;
      patch.paciente_codigo = form.paciente_codigo.trim() || null;
      patch.observacoes = form.observacoes.trim() || null;
    }
    const { data, error } = await supabase.from("rastreabilidade_pos_venda").update(patch).eq("id", item.id).select("id");
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    if (!data?.length) { toast.error("Seu perfil não tem permissão para alterar este registro."); return; }
    toast.success("Registro atualizado.");
    onSaved();
  }

  const info = recallInfo(item.status_recall);

  return (
    <Dialog open onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="text-left pr-6">
          <DialogTitle className="font-mono">Lote {item.lote}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span>{item.device_ref} · {item.device_model}</span>
            <Chip tom={info.tom}>{info.label}</Chip>
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Quantidade</dt><dd className="font-semibold">{item.quantidade} un.</dd></div>
          <div><dt className="text-xs text-muted-foreground">Envio</dt><dd className="font-semibold">{fmtDia(item.data_envio)}</dd></div>
          <div className="col-span-2 min-w-0"><dt className="text-xs text-muted-foreground">UDI-DI</dt><dd className="font-mono truncate">{item.udi_di || "—"}</dd></div>
        </dl>

        <section className="rounded-2xl border bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contato para recall</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Cliente</dt><dd className="font-medium">{item.cliente_nome}</dd></div>
            {cliente?.telefone && <div><dt className="text-xs text-muted-foreground">Telefone</dt><dd><a className="text-primary hover:underline" href={`tel:${cliente.telefone}`}>{cliente.telefone}</a></dd></div>}
            {cliente?.email && <div className="min-w-0"><dt className="text-xs text-muted-foreground">E-mail</dt><dd className="truncate"><a className="text-primary hover:underline" href={`mailto:${cliente.email}`}>{cliente.email}</a></dd></div>}
            {cliente?.documento && <div><dt className="text-xs text-muted-foreground">CNPJ/CPF</dt><dd className="font-mono">{cliente.documento}</dd></div>}
            {cliente?.endereco && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Endereço</dt><dd>{cliente.endereco}</dd></div>}
          </dl>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">Destino clínico</p>
            {!podeEditarDestino && <Chip><Lock className="h-3 w-3" />{encerrado ? "Produto devolvido — só leitura" : "Somente leitura"}</Chip>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Clínica / hospital"><Input value={form.clinica} onChange={e => setForm(f => ({ ...f, clinica: e.target.value }))} disabled={!podeEditarDestino} className="h-11" /></Campo>
            <Campo label="Cirurgião"><Input value={form.cirurgiao} onChange={e => setForm(f => ({ ...f, cirurgiao: e.target.value }))} disabled={!podeEditarDestino} className="h-11" /></Campo>
            <Campo label="Código do paciente" className="sm:col-span-2"
              dica={<span className="block text-[11px] text-muted-foreground">Use só o código interno — nunca o nome (LGPD).</span>}>
              <Input value={form.paciente_codigo} onChange={e => setForm(f => ({ ...f, paciente_codigo: e.target.value }))} disabled={!podeEditarDestino} className="h-11" />
            </Campo>
            <Campo label="Observações / ações tomadas" className="sm:col-span-2">
              <Textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} disabled={!podeEditarDestino} rows={3}
                placeholder="Ex: cliente contatado em 12/09, 3 unidades recolhidas" />
            </Campo>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status de recall</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Status de recall">
            {STATUS_RECALL.map(s => {
              const i = RECALL_INFO[s];
              return (
                <button key={s} type="button" role="radio" aria-checked={status === s} disabled={!podeEscrever} onClick={() => setStatus(s)}
                  className={cn("h-11 rounded-xl border text-sm font-medium flex items-center justify-center gap-1.5 transition-colors disabled:cursor-not-allowed",
                    status === s ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40" : "hover:bg-muted text-muted-foreground")}>
                  <span className={cn("h-2 w-2 rounded-full", i.dot)} />{i.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{RECALL_INFO[status].dica}</p>
        </section>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-11">{podeEscrever ? "Cancelar" : "Fechar"}</Button>
          {podeEscrever && (
            <Button onClick={salvar} disabled={saving || !mudou} className="h-11 gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
