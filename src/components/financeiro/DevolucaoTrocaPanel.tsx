/**
 * DevolucaoTrocaPanel — NF-e de Devolução de Mercadoria e de Troca
 *
 * Permite registrar e emitir (via SEFAZ, edge function sefaz-emitir-devolucao)
 * notas fiscais de devolução e de troca, vinculadas a um pedido já faturado
 * (puxa automaticamente cliente + NF original + itens) ou avulsas (dados
 * preenchidos manualmente).
 *
 * Segue o mesmo padrão visual/arquitetural do restante do módulo Financeiro
 * (SefazModal, NotaManualModal): passos numerados, modoTeste simulando a
 * autorização sem bater no SEFAZ de verdade.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { friendlyError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { escHtml } from "@/lib/escHtml";
import { formatBRL } from "@/lib/format";
import {
  RefreshCw, PlusCircle, X, Search, Undo2, Repeat2, FileCheck2,
  Loader2, Trash2, Printer, ChevronRight, AlertTriangle, CheckCircle2,
  Ban, User, FileText,
} from "lucide-react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type TipoOperacao = "devolucao" | "troca";
type StatusNota = "rascunho" | "autorizada" | "rejeitada" | "cancelada";

interface ItemDevTroca {
  id: string;
  descricao: string;
  ncm: string;
  cfop: string;
  quantidade: number;
  valorUnitario: string;
  aliqICMS: string;
  cst: string;
}

interface NotaDevTroca {
  id: string;
  tipo: TipoOperacao;
  pedido_id: string | null;
  avulsa: boolean;
  cliente_nome: string;
  cliente_documento: string | null;
  cliente_ie: string | null;
  cliente_endereco: string | null;
  cliente_telefone: string | null;
  cliente_email: string | null;
  nf_original_numero: string | null;
  nf_original_chave: string | null;
  motivo: string;
  itens: ItemDevTroca[];
  valor_frete: number;
  valor_total: number;
  tipo_nota: "nfe" | "nfce";
  tp_nf: "0" | "1";
  numero: string | null;
  serie: string;
  natureza_operacao: string | null;
  chave_acesso: string | null;
  protocolo_sefaz: string | null;
  dh_autorizacao: string | null;
  status: StatusNota;
  status_msg: string | null;
  modo_teste: boolean;
  created_at: string;
}

interface PedidoBusca {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_documento: string | null;
  cliente_ie: string | null;
  cliente_endereco: string | null;
  cliente_telefone: string | null;
  cliente_email: string | null;
  nota_fiscal: string | null;
  chave_acesso_nfe: string | null;
  frete: number;
  itens: {
    stock_item_id: string;
    quantidade: number;
    valor_unitario: number;
    device_model?: string;
    ncm?: string;
    cfop_padrao?: string;
  }[];
}

const BRL = formatBRL;

function novoItem(): ItemDevTroca {
  return {
    id: Math.random().toString(36).slice(2),
    descricao: "", ncm: "90213990", cfop: "1202",
    quantidade: 1, valorUnitario: "0.00", aliqICMS: "12.00", cst: "00",
  };
}

const STATUS_LABEL: Record<StatusNota, string> = {
  rascunho: "Rascunho", autorizada: "Autorizada", rejeitada: "Rejeitada", cancelada: "Cancelada",
};
const STATUS_COLOR: Record<StatusNota, string> = {
  rascunho: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  autorizada: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  rejeitada: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  cancelada: "bg-muted/40 text-muted-foreground border-border/40",
};

function TestBadgeLocal({ modoTeste }: { modoTeste: boolean }) {
  return (
    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
      modoTeste ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30")}>
      {modoTeste ? "HOMOLOGAÇÃO" : "PRODUÇÃO"}
    </span>
  );
}

// ─── Painel principal ────────────────────────────────────────────────────────

export function DevolucaoTrocaPanel({ modoTeste }: { modoTeste: boolean }) {
  const [registros, setRegistros] = useState<NotaDevTroca[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoOperacao>("todos");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [viewRegistro, setViewRegistro] = useState<NotaDevTroca | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notas_devolucao_troca")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) { toast.error(friendlyError(error)); setLoading(false); return; }
    setRegistros((data ?? []) as unknown as NotaDevTroca[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtrados = registros
    .filter(r => filtroTipo === "todos" || r.tipo === filtroTipo)
    .filter(r => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return r.cliente_nome.toLowerCase().includes(q)
        || (r.numero ?? "").toLowerCase().includes(q)
        || (r.nf_original_numero ?? "").toLowerCase().includes(q);
    });

  const counts = {
    todos: registros.length,
    devolucao: registros.filter(r => r.tipo === "devolucao").length,
    troca: registros.filter(r => r.tipo === "troca").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold">Devoluções e Trocas</h2>
          <p className="text-[12px] text-muted-foreground">
            Emissão de NF-e de devolução de mercadoria e de troca, vinculadas a um pedido faturado ou avulsas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/30 text-muted-foreground">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button type="button" onClick={() => setModalOpen(true)}
            className="h-9 px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold flex items-center gap-1.5 transition-colors">
            <PlusCircle size={14} />
            Nova Devolução/Troca
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: "todos", label: "Todos", count: counts.todos },
          { id: "devolucao", label: "Devoluções", count: counts.devolucao },
          { id: "troca", label: "Trocas", count: counts.troca },
        ] as const).map(f => (
          <button key={f.id} type="button" onClick={() => setFiltroTipo(f.id)}
            className={cn("h-8 px-3 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5",
              filtroTipo === f.id ? "bg-violet-600 text-white border-violet-600"
                                   : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50")}>
            {f.label}
            <span className={cn("text-[10px] px-1.5 rounded-full", filtroTipo === f.id ? "bg-white/20" : "bg-muted")}>
              {f.count}
            </span>
          </button>
        ))}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente, NF ou NF original..."
            className="w-full h-8 pl-8 pr-3 rounded-full border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center bg-muted/30">
            <Repeat2 size={28} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm font-semibold">Nenhuma devolução ou troca registrada</p>
          <p className="text-[12px] text-muted-foreground/70">Clique em "Nova Devolução/Troca" para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filtrados.map(r => (
            <button key={r.id} type="button" onClick={() => setViewRegistro(r)}
              className="text-left rounded-2xl border border-border/50 bg-card p-3.5 hover:border-violet-400/50 transition-colors space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("h-6 w-6 rounded-lg flex items-center justify-center shrink-0",
                  r.tipo === "devolucao" ? "bg-orange-500/10 text-orange-600" : "bg-cyan-500/10 text-cyan-600")}>
                  {r.tipo === "devolucao" ? <Undo2 size={13} /> : <Repeat2 size={13} />}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex-1">
                  {r.tipo === "devolucao" ? "Devolução" : "Troca"}
                </span>
                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0", STATUS_COLOR[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <p className="text-[13px] font-semibold truncate">{r.cliente_nome}</p>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{r.numero ? `${r.tipo_nota.toUpperCase()}-${r.numero.padStart(9,"0")}` : "sem número"}</span>
                <span className="font-semibold text-foreground">{BRL(r.valor_total)}</span>
              </div>
              {r.nf_original_numero && (
                <p className="text-[10px] text-muted-foreground/70 truncate">Ref: {r.nf_original_numero}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {modalOpen && (
        <NovaDevolucaoTrocaModal
          onClose={() => setModalOpen(false)}
          onSuccess={() => { setModalOpen(false); load(); }}
          modoTeste={modoTeste}
        />
      )}
      {viewRegistro && (
        <ViewerModal registro={viewRegistro} onClose={() => setViewRegistro(null)} onChanged={load} />
      )}
    </div>
  );
}

// ─── Modal: visualizar / cancelar / imprimir ────────────────────────────────

function ViewerModal({ registro, onClose, onChanged }: { registro: NotaDevTroca; onClose: () => void; onChanged: () => void }) {
  const [canceling, setCanceling] = useState(false);

  async function handleCancelar() {
    if (!confirm("Cancelar este registro? Esta ação apenas marca o registro como cancelado neste sistema — não transmite evento de cancelamento ao SEFAZ.")) return;
    setCanceling(true);
    try {
      const { data, error } = await supabase.rpc("cancelar_devolucao_troca", { p_id: registro.id, p_motivo: "Cancelado manualmente" });
      if (error) throw error;
      const r = data as { ok?: boolean; error?: string } | null;
      if (!r?.ok) { toast.error(r?.error ?? "Erro ao cancelar"); return; }
      toast.success("Registro cancelado");
      onChanged(); onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally { setCanceling(false); }
  }

  function handleImprimir() {
    const now = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const rows = registro.itens.map((it, idx) => `<tr>
      <td class="c-num">${idx+1}</td>
      <td>${escHtml(it.descricao)}<br><span class="meta">NCM ${escHtml(it.ncm)} · CFOP ${escHtml(it.cfop)}</span></td>
      <td class="c-qty">${it.quantidade}</td>
      <td class="c-val">R$ ${(parseFloat(it.valorUnitario)||0).toFixed(2).replace(".",",")}</td>
      <td class="c-val">R$ ${(it.quantidade * (parseFloat(it.valorUnitario)||0)).toFixed(2).replace(".",",")}</td>
    </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>${registro.tipo === "devolucao" ? "Devolução" : "Troca"} — ${escHtml(registro.cliente_nome)}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0} body{font-family:Arial,sans-serif;padding:20px 24px;color:#111;font-size:11px}
        h1{font-size:14px;text-transform:uppercase;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
        .info{border:1px solid #bbb;padding:8px 10px;margin-bottom:8px;line-height:1.8}
        .lbl{font-size:8px;text-transform:uppercase;color:#999;font-weight:700}
        table{width:100%;border-collapse:collapse;margin-bottom:8px}
        th{background:#f0f0f0;border:1px solid #bbb;padding:6px 7px;font-size:9px;text-transform:uppercase;text-align:left}
        td{border:1px solid #ddd;padding:5px 7px;vertical-align:top}
        .c-num{width:24px;text-align:center;color:#999} .c-qty{width:50px;text-align:center;font-weight:700}
        .c-val{width:90px;text-align:right} .meta{font-size:8px;color:#999}
        .totais{border:1px solid #bbb;padding:6px 10px;font-weight:800;font-size:12px;display:flex;justify-content:space-between}
        @media print{@page{margin:15mm}}
      </style></head><body>
      <h1>NF-e de ${registro.tipo === "devolucao" ? "Devolução de Mercadoria" : "Troca de Mercadoria"}</h1>
      <div class="info">
        <span class="lbl">Cliente</span><br><strong>${escHtml(registro.cliente_nome)}</strong>
        ${registro.cliente_documento ? ` — ${escHtml(registro.cliente_documento)}` : ""}<br>
        ${registro.cliente_endereco ? escHtml(registro.cliente_endereco) + "<br>" : ""}
        ${registro.nf_original_numero ? `NF original: <strong>${escHtml(registro.nf_original_numero)}</strong><br>` : ""}
        ${registro.numero ? `Nº desta nota: <strong>${registro.tipo_nota.toUpperCase()}-${registro.numero.padStart(9,"0")}</strong><br>` : ""}
        ${registro.chave_acesso ? `Chave de acesso: <span style="font-family:monospace;font-size:9px">${escHtml(registro.chave_acesso)}</span><br>` : ""}
        Status: <strong>${STATUS_LABEL[registro.status]}</strong> — Emitido em ${now}<br>
        Motivo: ${escHtml(registro.motivo)}
      </div>
      <table><thead><tr><th class="c-num">#</th><th>Item</th><th class="c-qty">Qtd.</th><th class="c-val">R$ Unit.</th><th class="c-val">Total</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="totais"><span>TOTAL</span><span>R$ ${registro.valor_total.toFixed(2).replace(".",",")}</span></div>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("h-7 w-7 rounded-lg flex items-center justify-center",
              registro.tipo === "devolucao" ? "bg-orange-500/15 text-orange-600" : "bg-cyan-500/15 text-cyan-600")}>
              {registro.tipo === "devolucao" ? <Undo2 size={15}/> : <Repeat2 size={15}/>}
            </span>
            <span className="text-sm font-semibold">{registro.tipo === "devolucao" ? "Devolução" : "Troca"}</span>
            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border", STATUS_COLOR[registro.status])}>
              {STATUS_LABEL[registro.status]}
            </span>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
            <X size={15}/>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-[12px]">
          <div><span className="text-muted-foreground">Cliente:</span> <strong>{registro.cliente_nome}</strong></div>
          {registro.cliente_documento && <div><span className="text-muted-foreground">Documento:</span> {registro.cliente_documento}</div>}
          {registro.nf_original_numero && <div><span className="text-muted-foreground">NF original:</span> {registro.nf_original_numero}</div>}
          {registro.numero && <div><span className="text-muted-foreground">Nº desta nota:</span> {registro.tipo_nota.toUpperCase()}-{registro.numero.padStart(9,"0")}</div>}
          {registro.chave_acesso && <div className="break-all"><span className="text-muted-foreground">Chave:</span> <span className="font-mono text-[10px]">{registro.chave_acesso}</span></div>}
          {registro.protocolo_sefaz && <div><span className="text-muted-foreground">Protocolo:</span> {registro.protocolo_sefaz}</div>}
          {registro.status_msg && (
            <div className={cn("rounded-lg p-2 text-[11px]", registro.status === "rejeitada" ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-muted/30")}>
              {registro.status_msg}
            </div>
          )}
          <div><span className="text-muted-foreground">Motivo:</span> {registro.motivo}</div>
          <div className="space-y-1.5 pt-2 border-t border-border/20">
            {registro.itens.map(it => (
              <div key={it.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-2.5 py-1.5">
                <span className="truncate">{it.descricao} <span className="text-muted-foreground">×{it.quantidade}</span></span>
                <span className="font-semibold shrink-0 ml-2">{BRL(it.quantidade * (parseFloat(it.valorUnitario)||0))}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/20 font-bold">
            <span>Total</span><span>{BRL(registro.valor_total)}</span>
          </div>
        </div>
        <div className="p-4 border-t border-border/20 shrink-0 flex items-center gap-2">
          <button type="button" onClick={handleImprimir}
            className="flex-1 h-9 rounded-xl border border-border/50 text-[12px] font-semibold flex items-center justify-center gap-1.5 hover:bg-muted/30">
            <Printer size={13}/> Imprimir
          </button>
          {registro.status !== "cancelada" && (
            <button type="button" onClick={handleCancelar} disabled={canceling}
              className="flex-1 h-9 rounded-xl border border-red-500/30 text-red-600 text-[12px] font-semibold flex items-center justify-center gap-1.5 hover:bg-red-500/10 disabled:opacity-50">
              {canceling ? <Loader2 size={13} className="animate-spin"/> : <Ban size={13}/>} Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: nova devolução/troca ────────────────────────────────────────────

function NovaDevolucaoTrocaModal({
  onClose, onSuccess, modoTeste,
}: { onClose: () => void; onSuccess: () => void; modoTeste: boolean }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const [tipo, setTipo] = useState<TipoOperacao>("devolucao");
  const [vinculo, setVinculo] = useState<"pedido" | "avulsa">("pedido");

  // Busca de pedido faturado
  const [buscaPedido, setBuscaPedido] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<PedidoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [pedidoSel, setPedidoSel] = useState<PedidoBusca | null>(null);
  const [itensSelecionados, setItensSelecionados] = useState<Record<string, number>>({});

  // Dados do cliente / NF original (preenchidos do pedido ou manualmente)
  const [clienteNome, setClienteNome] = useState("");
  const [clienteDocumento, setClienteDocumento] = useState("");
  const [clienteIe, setClienteIe] = useState("");
  const [clienteEndereco, setClienteEndereco] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [nfOriginalNumero, setNfOriginalNumero] = useState("");
  const [nfOriginalChave, setNfOriginalChave] = useState("");

  const [itens, setItens] = useState<ItemDevTroca[]>([novoItem()]);
  const [motivo, setMotivo] = useState("");
  const [frete, setFrete] = useState("0.00");

  const [tipoNota, setTipoNota] = useState<"nfe" | "nfce">("nfe");
  const [tpNF, setTpNF] = useState<"0" | "1">("0");
  const [numero, setNumero] = useState("");
  const [naturezaOperacao, setNaturezaOperacao] = useState("DEVOLUÇÃO DE VENDA DE MERCADORIA");
  const [infoAdicional, setInfoAdicional] = useState("");
  const [loadingNum, setLoadingNum] = useState(false);

  const [lastResult, setLastResult] = useState<{ sucesso: boolean; xMotivo?: string; erro?: string; protocolo?: string; chaveAcesso?: string } | null>(null);

  useEffect(() => {
    setNaturezaOperacao(tipo === "devolucao" ? "DEVOLUÇÃO DE VENDA DE MERCADORIA" : "TROCA DE MERCADORIA");
  }, [tipo]);

  useEffect(() => {
    setLoadingNum(true);
    supabase.rpc("peek_next_nf_number", { p_serie: "2", p_tipo: tipo })
      .then(({ data, error }) => {
        setNumero(error ? "" : String(data ?? "").padStart(9, "0"));
        setLoadingNum(false);
      });
  }, [tipo]);

  // Busca de pedidos faturados (debounce simples)
  useEffect(() => {
    if (vinculo !== "pedido" || buscaPedido.trim().length < 2) { setResultadosBusca([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      const q = buscaPedido.trim();
      const { data, error } = await supabase
        .from("pedidos_comerciais")
        .select(`
          id, cliente_id, frete, nota_fiscal, chave_acesso_nfe,
          clientes(nome, documento, ie, telefone, email, endereco, logradouro, numero, bairro, municipio, uf, cep),
          pedido_itens(stock_item_id, quantidade, valor_unitario,
            stock_items(devices(model, ncm, cfop_padrao)))
        `)
        .in("status", ["faturado", "enviado"])
        .or(`nota_fiscal.ilike.%${q}%,clientes.nome.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) { logger.error("busca pedido devolução:", error); setResultadosBusca([]); setBuscando(false); return; }
      const mapped: PedidoBusca[] = ((data ?? []) as Record<string, unknown>[]).map(p => {
        const cli = (p.clientes as Record<string, unknown> | null) ?? {};
        const end = cli.logradouro
          ? `${cli.logradouro}${cli.numero ? ", "+cli.numero : ""}${cli.bairro ? " — "+cli.bairro : ""}${cli.municipio ? " — "+cli.municipio : ""}${cli.uf ? "/"+cli.uf : ""}`
          : (cli.endereco as string ?? "");
        return {
          id: p.id as string,
          cliente_id: p.cliente_id as string,
          cliente_nome: (cli.nome as string) ?? "(sem nome)",
          cliente_documento: (cli.documento as string) ?? null,
          cliente_ie: (cli.ie as string) ?? null,
          cliente_endereco: end,
          cliente_telefone: (cli.telefone as string) ?? null,
          cliente_email: (cli.email as string) ?? null,
          nota_fiscal: p.nota_fiscal as string | null,
          chave_acesso_nfe: p.chave_acesso_nfe as string | null,
          frete: (p.frete as number) ?? 0,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map(i => ({
            stock_item_id: i.stock_item_id as string,
            quantidade: i.quantidade as number,
            valor_unitario: (i.valor_unitario as number) ?? 0,
            device_model: ((i.stock_items as Record<string, unknown> | null)?.devices as Record<string, unknown> | null)?.model as string | undefined,
            ncm: ((i.stock_items as Record<string, unknown> | null)?.devices as Record<string, unknown> | null)?.ncm as string | undefined,
            cfop_padrao: ((i.stock_items as Record<string, unknown> | null)?.devices as Record<string, unknown> | null)?.cfop_padrao as string | undefined,
          })),
        };
      });
      setResultadosBusca(mapped);
      setBuscando(false);
    }, 350);
    return () => clearTimeout(t);
  }, [buscaPedido, vinculo]);

  function selecionarPedido(p: PedidoBusca) {
    setPedidoSel(p);
    setClienteNome(p.cliente_nome);
    setClienteDocumento(p.cliente_documento ?? "");
    setClienteIe(p.cliente_ie ?? "");
    setClienteEndereco(p.cliente_endereco ?? "");
    setClienteTelefone(p.cliente_telefone ?? "");
    setClienteEmail(p.cliente_email ?? "");
    setNfOriginalNumero(p.nota_fiscal ?? "");
    setNfOriginalChave(p.chave_acesso_nfe ?? "");
    setItensSelecionados({});
    setResultadosBusca([]);
    setBuscaPedido(p.nota_fiscal ?? p.cliente_nome);
  }

  function confirmarItensPedido() {
    if (!pedidoSel) return;
    const cfopPadrao = tpNF === "0" ? "1202" : "5102";
    const selecionados: ItemDevTroca[] = pedidoSel.itens
      .filter(i => (itensSelecionados[i.stock_item_id] ?? 0) > 0)
      .map(i => ({
        id: Math.random().toString(36).slice(2),
        descricao: i.device_model ?? "Produto",
        ncm: i.ncm ?? "90213990",
        cfop: cfopPadrao,
        quantidade: itensSelecionados[i.stock_item_id],
        valorUnitario: i.valor_unitario.toFixed(2),
        aliqICMS: "12.00", cst: "00",
      }));
    if (selecionados.length === 0) { toast.error("Selecione ao menos um item para devolver/trocar"); return; }
    setItens(selecionados);
    setStep(2);
  }

  function updItem(idx: number, k: keyof ItemDevTroca, v: string | number) {
    setItens(prev => prev.map((it,i) => i===idx ? {...it, [k]: v} : it));
  }
  function addItem() { setItens(prev => [...prev, novoItem()]); }
  function removeItem(idx: number) { setItens(prev => prev.length > 1 ? prev.filter((_,i)=>i!==idx) : prev); }

  const valorTotal = itens.reduce((s,i) => s + i.quantidade * (parseFloat(i.valorUnitario)||0), 0) + (parseFloat(frete)||0);

  function canAdvanceStep1(): boolean {
    if (vinculo === "pedido") return !!pedidoSel;
    return clienteNome.trim().length > 0;
  }
  function canAdvanceStep2(): boolean {
    return itens.every(it => it.descricao.trim().length>0 && it.ncm.replace(/\D/g,"").length>=8 && it.cfop.replace(/\D/g,"").length>=4 && parseFloat(it.valorUnitario)>0)
      && motivo.trim().length > 0;
  }
  function canAdvanceStep3(): boolean {
    return numero.trim().length > 0 && naturezaOperacao.trim().length > 0;
  }

  async function handleEmitir() {
    if (!user) return;
    if (submitting.current) return;
    submitting.current = true; setSaving(true); setLastResult(null);

    try {
      // 1. Reserva o próximo número da série (série 2, dedicada a devolução/troca)
      const { data: numReservado, error: numErr } = await supabase.rpc("get_next_nf_number", { p_serie: "2", p_tipo: tipo });
      if (numErr) throw numErr;
      const numeroFinal = String(numReservado ?? "").padStart(9, "0");

      const itensPayload = itens.map(i => ({
        id: i.id, descricao: i.descricao, ncm: i.ncm, cfop: i.cfop,
        quantidade: i.quantidade, valorUnitario: i.valorUnitario, aliqICMS: i.aliqICMS, cst: i.cst,
      }));

      // 2. Insere o rascunho
      const { data: inserted, error: insErr } = await supabase.from("notas_devolucao_troca").insert({
        tipo, pedido_id: pedidoSel?.id ?? null, avulsa: vinculo === "avulsa",
        cliente_nome: clienteNome, cliente_documento: clienteDocumento || null,
        cliente_ie: clienteIe || null, cliente_endereco: clienteEndereco || null,
        cliente_telefone: clienteTelefone || null, cliente_email: clienteEmail || null,
        nf_original_numero: nfOriginalNumero || null,
        nf_original_chave: nfOriginalChave.replace(/\D/g,"") || null,
        motivo, itens: itensPayload, valor_frete: parseFloat(frete)||0, valor_total: valorTotal,
        tipo_nota: tipoNota, tp_nf: tpNF, numero: numeroFinal, serie: "2",
        natureza_operacao: naturezaOperacao, status: "rascunho", modo_teste: modoTeste,
        created_by: user.id,
      }).select("id").single();
      if (insErr) throw insErr;
      const registroId = (inserted as unknown as { id: string }).id;

      // 3. Emite (simulado em modo teste, real via edge function em produção)
      if (modoTeste) {
        await new Promise(r => setTimeout(r, 1500));
        const fake = {
          sucesso: true,
          chaveAcesso: "35" + Date.now() + "00000000000000000000000000000000",
          protocolo: "141" + Date.now(),
          dhAutorizacao: new Date().toISOString(),
          xMotivo: "Autorizado o uso da NF-e",
        };
        setLastResult(fake);
        await supabase.rpc("registrar_devolucao_troca", {
          p_id: registroId, p_status: "autorizada", p_status_msg: fake.xMotivo,
          p_chave_acesso: fake.chaveAcesso, p_protocolo: fake.protocolo, p_dh_autorizacao: fake.dhAutorizacao,
        });
        toast.success(`[TESTE] ${tipo === "devolucao" ? "Devolução" : "Troca"} simulada! Protocolo ${fake.protocolo}`, { duration: 5000 });
        onSuccess(); return;
      }

      const { data: fnData, error: fnErr } = await supabase.functions.invoke("sefaz-emitir-devolucao", {
        body: {
          registroId,
          dadosFiscais: {
            tipoNota, tipoOperacao: tipo, tpNF, numero: numeroFinal, serie: "2",
            naturezaOperacao, refNFe: nfOriginalChave.replace(/\D/g,""),
            destDocumento: clienteDocumento, destNome: clienteNome, destEmail: clienteEmail,
            destEndereco: clienteEndereco, itens: itensPayload.map(i => ({
              itemId: i.id, descricao: i.descricao, ncm: i.ncm, cfop: i.cfop,
              unidade: "UN", quantidade: i.quantidade, valorUnitario: i.valorUnitario,
              aliqICMS: i.aliqICMS, cst: i.cst,
            })),
            valorFrete: frete, modFrete: "9", informacoesAdicionais: infoAdicional,
          },
        },
      });
      if (fnErr) throw new Error(fnErr.message);
      const result = fnData as { sucesso: boolean; xMotivo?: string; erro?: string; cStat?: string; protocolo?: string; chaveAcesso?: string; dhAutorizacao?: string; xmlAssinado?: string };
      setLastResult(result);

      if (!result.sucesso) {
        await supabase.rpc("registrar_devolucao_troca", {
          p_id: registroId, p_status: "rejeitada",
          p_status_msg: result.xMotivo ? `SEFAZ cStat ${result.cStat}: ${result.xMotivo}` : (result.erro ?? "Nota rejeitada"),
          p_chave_acesso: null, p_protocolo: null, p_dh_autorizacao: null,
        });
        toast.error(result.xMotivo ? `SEFAZ cStat ${result.cStat}: ${result.xMotivo}` : (result.erro ?? "Nota rejeitada pelo SEFAZ"), { duration: 8000 });
        return;
      }

      await supabase.rpc("registrar_devolucao_troca", {
        p_id: registroId, p_status: "autorizada", p_status_msg: result.xMotivo ?? "Autorizado",
        p_chave_acesso: result.chaveAcesso ?? null, p_protocolo: result.protocolo ?? null,
        p_dh_autorizacao: result.dhAutorizacao ?? new Date().toISOString(),
        p_xml_nfe: result.xmlAssinado ?? null,
      } as Record<string, unknown>);

      toast.success(`✅ ${tipo === "devolucao" ? "Devolução" : "Troca"} autorizada! Protocolo ${result.protocolo}`, { duration: 6000 });
      onSuccess();
    } catch (err) {
      toast.error(`Erro ao emitir: ${friendlyError(err)}`);
      logger.error("NovaDevolucaoTrocaModal:", err);
    } finally { submitting.current = false; setSaving(false); }
  }

  const totalSteps = 4;
  const stepLabels = ["Origem", "Itens", "Nota fiscal", "Revisão"];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
                <FileCheck2 className="h-4 w-4 text-violet-500" />
              </div>
              <span className="text-sm font-semibold">Nova Devolução / Troca — SEFAZ</span>
              <TestBadgeLocal modoTeste={modoTeste} />
            </div>
            <button type="button" onClick={onClose} disabled={saving}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground disabled:opacity-40">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-0.5 w-full">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0",
                  i+1 < step ? "bg-violet-600 border-violet-600 text-white" :
                  i+1 === step ? "bg-violet-500/15 border-violet-500 text-violet-600" :
                  "bg-muted/30 border-border/40 text-muted-foreground")}>
                  {i+1}
                </div>
                {i < totalSteps-1 && <div className={cn("h-0.5 flex-1", i+1<step ? "bg-violet-600" : "bg-border/40")} />}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground font-medium">{stepLabels[step-1]}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {step === 1 && (
            <>
              <div className="flex gap-2">
                {(["devolucao","troca"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setTipo(t)}
                    className={cn("flex-1 rounded-xl border-2 p-3 text-left transition-all",
                      tipo === t ? "border-violet-500 bg-violet-500/5" : "border-border/40 hover:border-border")}>
                    <div className="flex items-center gap-2 mb-1">
                      {t === "devolucao" ? <Undo2 size={15} className="text-orange-600"/> : <Repeat2 size={15} className="text-cyan-600"/>}
                      <p className="text-[13px] font-bold">{t === "devolucao" ? "Devolução" : "Troca"}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t === "devolucao" ? "Cliente devolve mercadoria, sem substituição" : "Cliente troca o item por outro"}
                    </p>
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => { setVinculo("pedido"); setPedidoSel(null); }}
                  className={cn("flex-1 h-9 rounded-xl text-[12px] font-semibold border",
                    vinculo === "pedido" ? "bg-violet-600 text-white border-violet-600" : "border-border/50 hover:bg-muted/30")}>
                  Vincular a pedido faturado
                </button>
                <button type="button" onClick={() => { setVinculo("avulsa"); setPedidoSel(null); }}
                  className={cn("flex-1 h-9 rounded-xl text-[12px] font-semibold border",
                    vinculo === "avulsa" ? "bg-violet-600 text-white border-violet-600" : "border-border/50 hover:bg-muted/30")}>
                  Nota avulsa (manual)
                </button>
              </div>

              {vinculo === "pedido" ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                    <input value={buscaPedido} onChange={e => { setBuscaPedido(e.target.value); setPedidoSel(null); }}
                      placeholder="Buscar por número da NF ou nome do cliente..."
                      className="w-full h-9 pl-8 pr-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                  </div>
                  {buscando && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin"/> Buscando...</p>}
                  {resultadosBusca.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto rounded-xl border border-border/30 p-1.5">
                      {resultadosBusca.map(p => (
                        <button key={p.id} type="button" onClick={() => selecionarPedido(p)}
                          className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted/30 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold truncate">{p.cliente_nome}</p>
                            <p className="text-[10px] text-muted-foreground">{p.nota_fiscal ?? "sem NF"}</p>
                          </div>
                          <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {pedidoSel && (
                    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <User size={13} className="text-violet-600"/>
                        <p className="text-[12px] font-semibold">{pedidoSel.cliente_nome}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-violet-600"/>
                        <p className="text-[11px] text-muted-foreground">NF original: {pedidoSel.nota_fiscal ?? "—"}</p>
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground pt-1">Selecione os itens e quantidades</p>
                      <div className="space-y-1.5">
                        {pedidoSel.itens.map(i => (
                          <div key={i.stock_item_id} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5 border border-border/30">
                            <span className="text-[11px] truncate flex-1">{i.device_model ?? "Produto"} <span className="text-muted-foreground">(máx. {i.quantidade})</span></span>
                            <input type="number" min={0} max={i.quantidade}
                              value={itensSelecionados[i.stock_item_id] ?? 0}
                              onChange={e => setItensSelecionados(prev => ({ ...prev, [i.stock_item_id]: Math.max(0, Math.min(i.quantidade, parseInt(e.target.value)||0)) }))}
                              className="w-16 h-7 rounded-lg border border-border/50 text-center text-[11px] outline-none focus:border-violet-400" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 flex gap-2">
                    <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5"/>
                    <p className="text-[10.5px] text-amber-800 dark:text-amber-300">
                      Nota avulsa: preencha os dados do cliente e, se possível, a chave de acesso da NF-e original (44 dígitos) — o SEFAZ usa esse dado para vincular a devolução/troca à venda anterior.
                    </p>
                  </div>
                  <input value={clienteNome} onChange={e=>setClienteNome(e.target.value)} placeholder="Nome do cliente *"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={clienteDocumento} onChange={e=>setClienteDocumento(e.target.value)} placeholder="CPF/CNPJ"
                      className="h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                    <input value={clienteIe} onChange={e=>setClienteIe(e.target.value)} placeholder="IE (opcional)"
                      className="h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                  </div>
                  <input value={clienteEndereco} onChange={e=>setClienteEndereco(e.target.value)} placeholder="Endereço"
                    className="w-full h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={clienteTelefone} onChange={e=>setClienteTelefone(e.target.value)} placeholder="Telefone"
                      className="h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                    <input value={clienteEmail} onChange={e=>setClienteEmail(e.target.value)} placeholder="E-mail"
                      className="h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={nfOriginalNumero} onChange={e=>setNfOriginalNumero(e.target.value)} placeholder="Nº da NF original"
                      className="h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
                    <input value={nfOriginalChave} onChange={e=>setNfOriginalChave(e.target.value.replace(/\D/g,"").slice(0,44))} placeholder="Chave de acesso (44 dígitos)"
                      className="h-9 px-3 rounded-xl border border-border bg-muted/20 text-[12px] font-mono outline-none focus:border-violet-400" />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <textarea value={motivo} onChange={e=>setMotivo(e.target.value)} rows={2} placeholder="Motivo da devolução/troca *"
                className="w-full px-3 py-2 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400 resize-none" />
              <div className="space-y-2">
                {itens.map((it, idx) => (
                  <div key={it.id} className="rounded-xl border border-border/40 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={it.descricao} onChange={e=>updItem(idx,"descricao",e.target.value)} placeholder="Descrição do item"
                        className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-muted/20 text-[11px] outline-none focus:border-violet-400" />
                      {itens.length > 1 && (
                        <button type="button" onClick={()=>removeItem(idx)} className="h-8 w-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 shrink-0">
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <input value={it.ncm} onChange={e=>updItem(idx,"ncm",e.target.value.replace(/\D/g,"").slice(0,8))} placeholder="NCM"
                        className="h-8 px-2 rounded-lg border border-border bg-muted/20 text-[11px] outline-none focus:border-violet-400" />
                      <input value={it.cfop} onChange={e=>updItem(idx,"cfop",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="CFOP"
                        className="h-8 px-2 rounded-lg border border-border bg-muted/20 text-[11px] outline-none focus:border-violet-400" />
                      <input type="number" min={1} value={it.quantidade} onChange={e=>updItem(idx,"quantidade",Math.max(1,parseInt(e.target.value)||1))} placeholder="Qtd"
                        className="h-8 px-2 rounded-lg border border-border bg-muted/20 text-[11px] outline-none focus:border-violet-400" />
                      <input value={it.valorUnitario} onChange={e=>updItem(idx,"valorUnitario",e.target.value)} placeholder="Vlr. unit."
                        className="h-8 px-2 rounded-lg border border-border bg-muted/20 text-[11px] outline-none focus:border-violet-400" />
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addItem}
                className="w-full h-8 rounded-xl border border-dashed border-border/60 text-[11px] font-semibold text-muted-foreground hover:bg-muted/20 flex items-center justify-center gap-1.5">
                <PlusCircle size={13}/> Adicionar item
              </button>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-muted-foreground shrink-0">Frete</label>
                <input value={frete} onChange={e=>setFrete(e.target.value)}
                  className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-muted/20 text-[11px] outline-none focus:border-violet-400" />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Modelo</label>
                  <div className="flex gap-1.5 mt-1">
                    {(["nfe","nfce"] as const).map(t => (
                      <button key={t} type="button" onClick={()=>setTipoNota(t)}
                        className={cn("flex-1 h-8 rounded-lg text-[11px] font-semibold border",
                          tipoNota===t ? "bg-violet-600 text-white border-violet-600" : "border-border/50")}>
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Direção</label>
                  <div className="flex gap-1.5 mt-1">
                    <button type="button" onClick={()=>setTpNF("0")}
                      className={cn("flex-1 h-8 rounded-lg text-[10.5px] font-semibold border",
                        tpNF==="0" ? "bg-violet-600 text-white border-violet-600" : "border-border/50")}>
                      Entrada
                    </button>
                    <button type="button" onClick={()=>setTpNF("1")}
                      className={cn("flex-1 h-8 rounded-lg text-[10.5px] font-semibold border",
                        tpNF==="1" ? "bg-violet-600 text-white border-violet-600" : "border-border/50")}>
                      Saída
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground -mt-1">
                {tpNF === "0"
                  ? "Entrada: mercadoria voltando ao estoque (devolução recebida do cliente)."
                  : "Saída: mercadoria de reposição sendo enviada ao cliente (leg de troca)."}
                {" "}Se a troca envolver os dois sentidos, registre duas notas (uma de entrada e outra de saída).
              </p>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Número (série 2)</label>
                <input value={numero} disabled={loadingNum} onChange={e=>setNumero(e.target.value.replace(/\D/g,""))}
                  className="w-full h-9 mt-1 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Natureza da operação</label>
                <input value={naturezaOperacao} onChange={e=>setNaturezaOperacao(e.target.value)}
                  className="w-full h-9 mt-1 px-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Informações adicionais</label>
                <textarea value={infoAdicional} onChange={e=>setInfoAdicional(e.target.value.slice(0,500))} rows={2}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-violet-400 resize-none" />
              </div>
            </>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border/40 p-3 space-y-1.5 text-[12px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><strong>{tipo === "devolucao" ? "Devolução" : "Troca"}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><strong>{clienteNome}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Nº da nota</span><strong>{tipoNota.toUpperCase()}-{numero.padStart(9,"0")}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Direção</span><strong>{tpNF==="0"?"Entrada":"Saída"}</strong></div>
                {nfOriginalChave && <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">NF original</span><strong className="font-mono text-[10px] truncate">{nfOriginalChave}</strong></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Itens</span><strong>{itens.reduce((s,i)=>s+i.quantidade,0)} peça(s)</strong></div>
                <div className="flex justify-between font-bold pt-1.5 border-t border-border/20"><span>Total</span><span>{BRL(valorTotal)}</span></div>
              </div>
              {!nfOriginalChave && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 flex gap-2">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5"/>
                  <p className="text-[10.5px] text-amber-800 dark:text-amber-300">
                    Sem a chave de acesso da NF original, a nota será emitida sem o vínculo formal (NFref) à venda anterior.
                  </p>
                </div>
              )}
              {lastResult && (
                <div className={cn("rounded-lg p-2.5 text-[11px] flex gap-2",
                  lastResult.sucesso ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400")}>
                  {lastResult.sucesso ? <CheckCircle2 size={14} className="shrink-0"/> : <AlertTriangle size={14} className="shrink-0"/>}
                  <span>{lastResult.sucesso ? `Autorizada — protocolo ${lastResult.protocolo}` : (lastResult.xMotivo ?? lastResult.erro)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border/20 shrink-0 flex items-center gap-2">
          {step > 1 && (
            <button type="button" onClick={()=>setStep(s=>s-1)} disabled={saving}
              className="h-10 px-4 rounded-xl border border-border/50 text-[12px] font-semibold hover:bg-muted/30 disabled:opacity-40">
              Voltar
            </button>
          )}
          {step === 1 && vinculo === "pedido" && pedidoSel ? (
            <button type="button" onClick={confirmarItensPedido}
              className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold">
              Continuar
            </button>
          ) : step < 4 ? (
            <button type="button"
              onClick={()=>setStep(s=>s+1)}
              disabled={(step===1 && !canAdvanceStep1()) || (step===2 && !canAdvanceStep2()) || (step===3 && !canAdvanceStep3())}
              className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              Continuar
            </button>
          ) : (
            <button type="button" onClick={handleEmitir} disabled={saving}
              className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 size={14} className="animate-spin"/> Emitindo...</> : <><FileCheck2 size={14}/> Emitir NF-e</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default DevolucaoTrocaPanel;
