/**
 * Qualidade — Pipeline de Regularização Sanitária
 *
 * Segue o plano de 4 fases:
 *  Fase 1 — Pré-requisitos da empresa (LF · AFE · BPF)
 *  Fase 2 — Classificação de risco (RDC 751/2022)
 *  Fase 3 — Regularização ANVISA (Notificação ou Registro no Solicita)
 *  Fase 4 — Rastreabilidade UDI + GTIN + SIUD
 *
 * Abas:
 *  • Pipeline    — visão geral de todas as peças por fase + ações
 *  • Rastreamento — busca de peças com lotes/fases/dados regulatórios
 *  • Histórico   — movimentações de estoque
 */

import {
  useState, useEffect, useCallback, useRef, memo, useMemo,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  ShieldCheck, Search, History, Building2, Tag, Package,
  Truck, Wrench, MapPin, Clock,
  ShieldAlert, AlertCircle, CheckCircle2, Copy, RefreshCw,
  ArrowDownCircle, ArrowUpCircle, ExternalLink, Hash, Barcode,
  FileText, AlertTriangle, ChevronRight, X, Save, Loader2,
  CalendarClock, ClipboardCheck, BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages, sumColumnPaginated } from "@/lib/supabaseUtils";
import { sanitizeQuery } from "@/lib/sanitize";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { lazy, Suspense } from "react";
const DashboardGeral   = lazy(() => import("@/components/qualidade/DashboardGeral").then(m => ({ default: m.DashboardGeral })));
const CertificadosPanel   = lazy(() => import("@/components/qualidade/CertificadosPanel").then(m => ({ default: m.CertificadosPanel })));
const RastreabilidadePanel = lazy(() => import("@/components/qualidade/RastreabilidadePanel").then(m => ({ default: m.RastreabilidadePanel })));
import { PageNav } from "@/components/PageNav";
import type { PageNavTab } from "@/components/PageNav";
import type { StockFase, AllMovement } from "@/hooks/useStock";
import { fetchAllMovements } from "@/hooks/useStock";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type QualidadeView = "dashboard" | "pipeline" | "rastreamento" | "rastreabilidade_pos" | "historico" | "gs1" | "certificados";

type FaseNum = 1 | 2 | 3 | 4 | 5;
type StatusReg =
  | "pendente"
  | "em_processo"
  | "notificado"
  | "registrado"
  | "cancelado";

interface DeviceReg {
  id: string;
  model: string;
  reference: string;
  risk_class: string | null;
  regime: string | null;
  status_regularizacao: StatusReg;
  empresa_lf: boolean;
  empresa_afe: boolean;
  empresa_bpf: boolean;
  anvisa_registration: string | null;
  numero_processo_anvisa: string | null;
  data_registro_anvisa: string | null;
  data_vencimento_anvisa: string | null;
  udi_di: string | null;
  gtin: string | null;
  siud_transmitido_em: string | null;
  rotulo_udi_ok: boolean;
  classification_code: string | null;
  brand_name: string | null;
  updated_at: string;
  fase_atual: FaseNum;
  dias_ate_vencer: number | null;
}

interface LoteInfo { lote: string; saldo: number; last_movement: string }
interface FaseInfo {
  fase: StockFase; stock_item_id: string;
  quantity: number; quantity_reserved: number; quantity_available: number;
  location: string | null; lotes: LoteInfo[];
}
interface PecaResult {
  device_id: string; model: string; reference: string;
  internal_code: string | null; udi_di: string | null;
  anvisa_registration: string | null; classification_code: string | null;
  fases: FaseInfo[]; em_retrabalho: boolean; tem_reservas: boolean;
}
interface Suggestion { device_id: string; model: string; reference: string }

// ─── Constantes ───────────────────────────────────────────────────────────────

const TABS: PageNavTab<QualidadeView>[] = [
  { id: "dashboard",    label: "Dashboard",    Icon: LayoutDashboard,activeColor: "text-emerald-500", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40"},
  { id: "pipeline",     label: "Pipeline",     Icon: ClipboardCheck, activeColor: "text-violet-500",  activeBg: "bg-violet-500/10",  activeBorder: "border-violet-500/40" },
  { id: "rastreamento", label: "Rastreamento", Icon: Search,         activeColor: "text-blue-500",    activeBg: "bg-blue-500/10",    activeBorder: "border-blue-500/40"   },
  { id: "historico",    label: "Histórico",    Icon: History,        activeColor: "text-amber-500",   activeBg: "bg-amber-500/10",   activeBorder: "border-amber-500/40"  },
  { id: "rastreabilidade_pos", label: "Rastreab. Pós-venda", Icon: MapPin, activeColor: "text-rose-500", activeBg: "bg-rose-500/10", activeBorder: "border-rose-500/40" },
  { id: "certificados", label: "Certificados", Icon: Shield,         activeColor: "text-teal-500",    activeBg: "bg-teal-500/10",    activeBorder: "border-teal-500/40"   },
  { id: "gs1",          label: "GS1",          Icon: Barcode,        activeColor: "text-cyan-500",    activeBg: "bg-cyan-500/10",    activeBorder: "border-cyan-500/40"   },
];

const FASE_CONFIG: Record<StockFase, { label: string; Icon: React.ElementType; color: string; bg: string; border: string }> = {
  intermediaria: { label: "Intermediário", Icon: Package, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  expedicao:     { label: "Expedição",     Icon: Truck,   color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  retrabalho:    { label: "Retrabalho",    Icon: Wrench,  color: "text-amber-500",   bg: "bg-amber-500/10",   border: "border-amber-500/30" },
};

const STATUS_CONFIG: Record<StatusReg, { label: string; color: string; bg: string; border: string }> = {
  pendente:    { label: "Pendente",      color: "text-muted-foreground", bg: "bg-muted/30",           border: "border-border/40"           },
  em_processo: { label: "Em processo",  color: "text-amber-600",        bg: "bg-amber-500/10",        border: "border-amber-500/30"        },
  notificado:  { label: "Notificado",   color: "text-emerald-600",      bg: "bg-emerald-500/10",      border: "border-emerald-500/30"      },
  registrado:  { label: "Registrado",   color: "text-blue-600",         bg: "bg-blue-500/10",         border: "border-blue-500/30"         },
  cancelado:   { label: "Cancelado",    color: "text-destructive",      bg: "bg-destructive/10",      border: "border-destructive/30"      },
};

const FASE_LABELS: Record<FaseNum, string> = {
  1: "Empresa",
  2: "Classificação",
  3: "ANVISA",
  4: "UDI / GTIN",
  5: "Concluído",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function calcGTIN13Check(digits12: string): string {
  const d = digits12.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

// ─── Barra de Progresso de Fase ───────────────────────────────────────────────

function FaseProgress({ fase }: { fase: FaseNum }) {
  return (
    <div className="flex items-center gap-1">
      {([1, 2, 3, 4, 5] as FaseNum[]).map((f) => (
        <div key={f} className="flex items-center gap-1">
          <div className={cn(
            "h-5 rounded-full flex items-center justify-center transition-all",
            f < fase  ? "w-5 bg-emerald-500 text-white" :
            f === fase ? "w-5 bg-violet-500 text-white ring-2 ring-violet-500/30" :
            "w-5 bg-muted/40 text-muted-foreground/40",
          )}>
            {f < fase
              ? <CheckCircle2 className="h-3 w-3" />
              : <span className="text-[9px] font-bold">{f}</span>
            }
          </div>
          {f < 5 && (
            <div className={cn("h-0.5 w-3 rounded-full transition-colors",
              f < fase ? "bg-emerald-500" : "bg-muted/30"
            )} />
          )}
        </div>
      ))}
      <span className={cn(
        "ml-1 text-[10px] font-medium",
        fase === 5 ? "text-emerald-600" : "text-violet-600"
      )}>
        {FASE_LABELS[fase]}
      </span>
    </div>
  );
}

// ─── Modal de edição de uma peça no pipeline ──────────────────────────────────

interface EditModalProps {
  device: DeviceReg;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ device, onClose, onSaved }: EditModalProps) {
  const [form, setForm] = useState({
    empresa_lf:             device.empresa_lf,
    empresa_afe:            device.empresa_afe,
    empresa_bpf:            device.empresa_bpf,
    risk_class:             device.risk_class ?? "",
    classification_code:    device.classification_code ?? "",
    status_regularizacao:   device.status_regularizacao,
    anvisa_registration:    device.anvisa_registration ?? "",
    numero_processo_anvisa: device.numero_processo_anvisa ?? "",
    data_registro_anvisa:   device.data_registro_anvisa ?? "",
    data_vencimento_anvisa: device.data_vencimento_anvisa ?? "",
    udi_di:                 device.udi_di ?? "",
    gtin:                   device.gtin ?? "",
    rotulo_udi_ok:          device.rotulo_udi_ok,
    siud_transmitido_em:    device.siud_transmitido_em
                              ? device.siud_transmitido_em.slice(0, 10)
                              : "",
  });
  const [saving, setSaving] = useState(false);

  // Gerador GTIN inline
  const [gtinPrefix, setGtinPrefix] = useState("789");
  const [gtinCompany, setGtinCompany] = useState("");
  const [gtinProduct, setGtinProduct] = useState("");

  function gerarGTIN() {
    const base = `${gtinPrefix}${gtinCompany.padEnd(4, "0").slice(0, 4)}${gtinProduct.padEnd(5, "0").slice(0, 5)}`;
    if (base.length !== 12) { toast.error("Preencha os 3 campos para gerar o GTIN"); return; }
    const check = calcGTIN13Check(base);
    const gtin = `${base}${check}`;
    setForm(f => ({ ...f, gtin, udi_di: f.udi_di || gtin }));
    toast.success(`GTIN-13 gerado: ${gtin}`);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase.from("devices").update({
      empresa_lf:             form.empresa_lf,
      empresa_afe:            form.empresa_afe,
      empresa_bpf:            form.empresa_bpf,
      risk_class:             form.risk_class || null,
      classification_code:    form.classification_code || null,
      status_regularizacao:   form.status_regularizacao,
      anvisa_registration:    form.anvisa_registration || null,
      numero_processo_anvisa: form.numero_processo_anvisa || null,
      data_registro_anvisa:   form.data_registro_anvisa || null,
      data_vencimento_anvisa: form.data_vencimento_anvisa || null,
      udi_di:                 form.udi_di || null,
      gtin:                   form.gtin || null,
      rotulo_udi_ok:          form.rotulo_udi_ok,
      siud_transmitido_em:    form.siud_transmitido_em ? new Date(form.siud_transmitido_em).toISOString() : null,
    }).eq("id", device.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Dados de regularização atualizados!");
    onSaved();
    onClose();
  }

  const faseAtual: FaseNum = (() => {
    if (!form.empresa_lf || !form.empresa_afe) return 1;
    if (!form.risk_class || !form.classification_code) return 2;
    if (form.status_regularizacao === "pendente" || form.status_regularizacao === "em_processo") return 3;
    if (!form.udi_di || !form.gtin) return 4;
    return 5;
  })();

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
        {children}
      </div>
    );
  }

  function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          "flex items-center gap-2 h-9 px-3 rounded-xl border text-[12px] font-medium transition-all w-full",
          value
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
            : "bg-muted/20 border-border/30 text-muted-foreground"
        )}
      >
        {value ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
        {label}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold truncate">{device.model}</p>
              <p className="text-[11px] text-muted-foreground/60 font-mono mt-0.5">{device.reference}</p>
            </div>
            <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3">
            <FaseProgress fase={faseAtual} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* FASE 1 — Empresa */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                faseAtual > 1 ? "bg-emerald-500 text-white" : "bg-violet-500 text-white")}>
                {faseAtual > 1 ? <CheckCircle2 className="h-3 w-3" /> : "1"}
              </div>
              <p className="text-[12px] font-semibold">Fase 1 — Pré-requisitos da empresa</p>
              <a href="https://www.gov.br/pt-br/servicos/solicitar-autorizacao-de-funcionamento-afe-dispositivos-medicos"
                target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[10px] text-blue-500 hover:underline flex items-center gap-0.5">
                Portal ANVISA <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Toggle value={form.empresa_lf}  onChange={v => setForm(f => ({ ...f, empresa_lf: v }))}  label="LF — Licença local" />
              <Toggle value={form.empresa_afe} onChange={v => setForm(f => ({ ...f, empresa_afe: v }))} label="AFE — ANVISA" />
              <Toggle value={form.empresa_bpf} onChange={v => setForm(f => ({ ...f, empresa_bpf: v }))} label="BPF — Fab." />
            </div>
          </section>

          {/* FASE 2 — Classificação */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                faseAtual > 2 ? "bg-emerald-500 text-white" : faseAtual === 2 ? "bg-violet-500 text-white" : "bg-muted/40 text-muted-foreground/40")}>
                {faseAtual > 2 ? <CheckCircle2 className="h-3 w-3" /> : "2"}
              </div>
              <p className="text-[12px] font-semibold">Fase 2 — Classificação de risco (RDC 751/2022)</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Classe de risco">
                <select
                  value={form.risk_class}
                  onChange={e => setForm(f => ({ ...f, risk_class: e.target.value }))}
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                >
                  <option value="">Selecionar...</option>
                  <option value="I">Classe I — Risco mínimo (Notificação)</option>
                  <option value="II">Classe II — Risco médio (Notificação)</option>
                  <option value="III">Classe III — Risco elevado (Registro)</option>
                  <option value="IV">Classe IV — Risco máximo (Registro)</option>
                </select>
              </Field>
              <Field label="Código de classificação">
                <input
                  value={form.classification_code}
                  onChange={e => setForm(f => ({ ...f, classification_code: e.target.value }))}
                  placeholder="Ex: 10-03"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
            </div>
            {form.risk_class && (
              <p className={cn("text-[11px] px-2 py-1.5 rounded-lg border",
                ["I","II"].includes(form.risk_class)
                  ? "bg-emerald-500/8 text-emerald-600 border-emerald-500/20"
                  : "bg-violet-500/8 text-violet-600 border-violet-500/20"
              )}>
                {["I","II"].includes(form.risk_class)
                  ? "✓ Notificação — formulário eletrônico no Solicita · Prazo: semanas"
                  : "⚠ Registro — dossiê técnico IMDRF + possível certificação Inmetro · Prazo: meses a anos"
                }
              </p>
            )}
          </section>

          {/* FASE 3 — ANVISA Solicita */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                faseAtual > 3 ? "bg-emerald-500 text-white" : faseAtual === 3 ? "bg-violet-500 text-white" : "bg-muted/40 text-muted-foreground/40")}>
                {faseAtual > 3 ? <CheckCircle2 className="h-3 w-3" /> : "3"}
              </div>
              <p className="text-[12px] font-semibold">Fase 3 — Regularização ANVISA</p>
              <a href="https://solicita.anvisa.gov.br" target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[10px] text-blue-500 hover:underline flex items-center gap-0.5">
                Solicita <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <Field label="Status no Solicita">
              <select
                value={form.status_regularizacao}
                onChange={e => setForm(f => ({ ...f, status_regularizacao: e.target.value as StatusReg }))}
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              >
                <option value="pendente">Pendente — ainda não peticionado</option>
                <option value="em_processo">Em processo — petição protocolada</option>
                <option value="notificado">Notificado — notificação concedida</option>
                <option value="registrado">Registrado — registro concedido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Número do processo (Solicita)">
                <input
                  value={form.numero_processo_anvisa}
                  onChange={e => setForm(f => ({ ...f, numero_processo_anvisa: e.target.value }))}
                  placeholder="Ex: 25351.000001/2024-01"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
              <Field label="Número de registro / notificação">
                <input
                  value={form.anvisa_registration}
                  onChange={e => setForm(f => ({ ...f, anvisa_registration: e.target.value }))}
                  placeholder="Ex: 10302340001"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
              <Field label="Data de concessão">
                <input type="date" value={form.data_registro_anvisa}
                  onChange={e => setForm(f => ({ ...f, data_registro_anvisa: e.target.value }))}
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
              <Field label="Validade (10 anos)">
                <input type="date" value={form.data_vencimento_anvisa}
                  onChange={e => setForm(f => ({ ...f, data_vencimento_anvisa: e.target.value }))}
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
            </div>
            {form.anvisa_registration && (
              <a
                href={`https://consultas.anvisa.gov.br/#/produtos/${form.anvisa_registration}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] text-blue-500 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Consultar no portal ANVISA
              </a>
            )}
          </section>

          {/* FASE 4 — UDI / GTIN */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                faseAtual > 4 ? "bg-emerald-500 text-white" : faseAtual === 4 ? "bg-violet-500 text-white" : "bg-muted/40 text-muted-foreground/40")}>
                {faseAtual > 4 ? <CheckCircle2 className="h-3 w-3" /> : "4"}
              </div>
              <p className="text-[12px] font-semibold">Fase 4 — Rastreabilidade UDI + GTIN</p>
              <a href="https://gs1br.org" target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[10px] text-blue-500 hover:underline flex items-center gap-0.5">
                GS1 Brasil <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>

            {/* Gerador GTIN inline */}
            <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Gerar GTIN-13 (prefixo + empresa + produto)</p>
              <div className="flex gap-2">
                <input value={gtinPrefix} onChange={e => setGtinPrefix(e.target.value.replace(/\D/g,"").slice(0,3))}
                  placeholder="789" maxLength={3}
                  className="w-16 h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] font-mono text-center focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                />
                <input value={gtinCompany} onChange={e => setGtinCompany(e.target.value.replace(/\D/g,"").slice(0,4))}
                  placeholder="0001" maxLength={4}
                  className="w-16 h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] font-mono text-center focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                />
                <input value={gtinProduct} onChange={e => setGtinProduct(e.target.value.replace(/\D/g,"").slice(0,5))}
                  placeholder="00001" maxLength={5}
                  className="w-20 h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] font-mono text-center focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                />
                <button type="button" onClick={gerarGTIN}
                  className="flex-1 h-8 rounded-lg bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-500 transition-colors">
                  Gerar
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/50">Brasil: 789 ou 790 · Empresa: 4 dígitos · Produto: 5 dígitos</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="GTIN-13 / GTIN-14">
                <input value={form.gtin}
                  onChange={e => setForm(f => ({ ...f, gtin: e.target.value.replace(/\D/g,"").slice(0,14) }))}
                  placeholder="7890001000012"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
              <Field label="UDI-DI">
                <input value={form.udi_di}
                  onChange={e => setForm(f => ({ ...f, udi_di: e.target.value }))}
                  placeholder="Igual ao GTIN (padrão GS1)"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Toggle value={form.rotulo_udi_ok}
                onChange={v => setForm(f => ({ ...f, rotulo_udi_ok: v }))}
                label="Rótulo com código de barras UDI" />
              <Field label="Transmitido ao SIUD em">
                <input type="date" value={form.siud_transmitido_em}
                  onChange={e => setForm(f => ({ ...f, siud_transmitido_em: e.target.value }))}
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </Field>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border/20 shrink-0">
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-border/30 text-[12px] font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card de peça no Pipeline ─────────────────────────────────────────────────

function PipelineCard({
  device, isAdmin, onEdit,
}: { device: DeviceReg; isAdmin: boolean; onEdit: (d: DeviceReg) => void }) {
  const st = STATUS_CONFIG[device.status_regularizacao];
  const diasVencer = device.dias_ate_vencer;
  const venceBreve = diasVencer !== null && diasVencer < 365;

  return (
    <div className={cn(
      "rounded-2xl border bg-card overflow-hidden transition-all hover:shadow-sm",
      device.fase_atual === 5 ? "border-emerald-500/20" : "border-border/40"
    )}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/20">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate">{device.model}</p>
            <p className="text-[10px] text-muted-foreground/60 font-mono">{device.reference}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", st.color, st.bg, st.border)}>
              {st.label}
            </span>
            {isAdmin && (
              <button type="button" onClick={() => onEdit(device)}
                className="h-7 px-2.5 rounded-lg border border-border/40 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                Editar
              </button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <FaseProgress fase={device.fase_atual} />
        </div>
      </div>

      {/* Detalhes */}
      <div className="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {device.risk_class && (
          <span className="text-[11px] text-muted-foreground/70">
            Classe <span className="font-semibold text-foreground">{device.risk_class}</span>
            {" · "}{device.regime === "notificacao" ? "Notificação" : "Registro"}
          </span>
        )}
        {device.anvisa_registration && (
          <span className="flex items-center gap-1 text-[11px] text-blue-600">
            <ShieldCheck className="h-3 w-3" />
            {device.anvisa_registration}
            <a href={`https://consultas.anvisa.gov.br/#/produtos/${device.anvisa_registration}`}
              target="_blank" rel="noopener noreferrer" title="Consultar ANVISA">
              <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
            </a>
          </span>
        )}
        {device.udi_di && (
          <span className="flex items-center gap-1 text-[11px] text-violet-600 font-mono">
            <Hash className="h-3 w-3" />
            {device.udi_di}
          </span>
        )}
        {venceBreve && diasVencer !== null && (
          <span className={cn("flex items-center gap-1 text-[11px]",
            diasVencer < 90 ? "text-destructive" : "text-amber-600")}>
            <CalendarClock className="h-3 w-3" />
            Vence em {diasVencer}d
          </span>
        )}
        {/* Fase 1 checks */}
        {(!device.empresa_lf || !device.empresa_afe) && (
          <span className="flex items-center gap-1 text-[11px] text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {!device.empresa_lf ? "Sem LF" : "Sem AFE"}
          </span>
        )}
      </div>

      {/* Links rápidos por fase */}
      {device.fase_atual < 5 && (
        <div className="px-4 py-2 border-t border-border/10 bg-muted/10 flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/50">Próximo passo:</span>
          {device.fase_atual === 1 && (
            <a href="https://www.gov.br/pt-br/servicos/solicitar-autorizacao-de-funcionamento-afe-dispositivos-medicos"
              target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-blue-500 hover:underline flex items-center gap-1">
              Obter AFE no portal ANVISA <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {device.fase_atual === 2 && (
            <span className="text-[11px] text-muted-foreground/60">Definir classe de risco (RDC 751/2022) e preencher no app</span>
          )}
          {device.fase_atual === 3 && (
            <a href="https://solicita.anvisa.gov.br" target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-blue-500 hover:underline flex items-center gap-1">
              Protocolar no Solicita <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {device.fase_atual === 4 && (
            <a href="https://gs1br.org" target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-blue-500 hover:underline flex items-center gap-1">
              Obter GTIN na GS1 Brasil <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Aba: Pipeline ────────────────────────────────────────────────────────────

const PipelinePanel = memo(function PipelinePanel() {
  const { isAdmin } = useAuth();
  const [devices, setDevices] = useState<DeviceReg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [faseFilter, setFaseFilter] = useState<"all" | "1" | "2" | "3" | "4" | "5">("all");
  const [editDevice, setEditDevice] = useState<DeviceReg | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Usa fetchAllPages (paginação segura) filtrando só fase < 5 via query manual
      const all: DeviceReg[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data: page, error } = await supabase
          .from("devices_regularizacao")
          .select("*")
          .lt("fase_atual", 5)
          .order("fase_atual", { ascending: true })
          .order("model", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error || !page) break;
        all.push(...(page as DeviceReg[]));
        if (page.length < PAGE) break;
        from += PAGE;
      }
      setDevices(all);
      setVisibleCount(30);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return devices.filter(d => {
      if (faseFilter !== "all" && String(d.fase_atual) !== faseFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        d.model.toLowerCase().includes(q) ||
        (d.reference ?? "").toLowerCase().includes(q) ||
        (d.anvisa_registration ?? "").toLowerCase().includes(q) ||
        (d.udi_di ?? "").toLowerCase().includes(q)
      );
    });
  }, [devices, faseFilter, search]);

  // Reset paginação ao mudar filtros
  useEffect(() => { setVisibleCount(30); }, [faseFilter, search]);

  const visibleDevices = filtered.slice(0, visibleCount);

  // KPIs — só peças que precisam de ação (fase < 5 já filtrado na query)
  const kpis = useMemo(() => ({
    emProcesso: devices.filter(d => d.fase_atual === 3 && d.status_regularizacao === "em_processo").length,
    pendentes:  devices.length,
    vencendo:   devices.filter(d => d.dias_ate_vencer !== null && d.dias_ate_vencer < 365).length,
  }), [devices]);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "A regularizar", value: kpis.pendentes,  Icon: AlertCircle,   color: "text-amber-500", bg: "bg-amber-500/8", border: "border-amber-500/20" },
          { label: "Em processo",   value: kpis.emProcesso, Icon: ClipboardCheck,color: "text-blue-500",  bg: "bg-blue-500/8", border: "border-blue-500/20"  },
          { label: "Vence em 1a",   value: kpis.vencendo,   Icon: CalendarClock, color: "text-red-500",   bg: "bg-red-500/8",  border: "border-red-500/20"   },
        ].map(k => (
          <div key={k.label} className={cn("rounded-2xl border p-3 flex items-center gap-3", k.bg, k.border)}>
            <k.Icon className={cn("h-5 w-5 shrink-0", k.color)} />
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{k.label}</p>
              <p className={cn("text-2xl font-bold tabular-nums", k.color)}>{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar peça..."
          className="h-9 flex-1 min-w-36 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
        <select value={faseFilter} onChange={e => setFaseFilter(e.target.value as typeof faseFilter)}
          className="h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none">
          <option value="all">Todas as fases</option>
          <option value="1">Fase 1 — Empresa</option>
          <option value="2">Fase 2 — Classificação</option>
          <option value="3">Fase 3 — ANVISA</option>
          <option value="4">Fase 4 — UDI/GTIN</option>
        </select>
        <button onClick={load} className="h-9 w-9 rounded-xl border border-border/40 flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl bg-muted/30 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/30 bg-muted/10 py-12 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground/60">Nenhuma peça encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleDevices.map(d => (
            <PipelineCard key={d.id} device={d} isAdmin={isAdmin} onEdit={setEditDevice} />
          ))}
          {visibleCount < filtered.length && (
            <button
              type="button"
              onClick={() => setVisibleCount(v => v + 30)}
              className="w-full h-9 rounded-xl border border-border/40 text-[12px] text-muted-foreground hover:bg-muted/30 transition-colors"
            >
              Carregar mais ({filtered.length - visibleCount} restantes)
            </button>
          )}
        </div>
      )}

      {editDevice && (
        <EditModal device={editDevice} onClose={() => setEditDevice(null)} onSaved={load} />
      )}
    </div>
  );
});

// ─── Aba: Rastreamento ────────────────────────────────────────────────────────

// ─── Helpers de busca compartilhados ─────────────────────────────────────────

function buildLotesByItem(movData: unknown[]): Map<string, Map<string, { saldo: number; last_movement: string }>> {
  const map = new Map<string, Map<string, { saldo: number; last_movement: string }>>();
  for (const m of movData as { stock_item_id: string; lote: string; type: string; quantity: number; created_at: string }[]) {
    if (!m.lote) continue;
    if (!map.has(m.stock_item_id)) map.set(m.stock_item_id, new Map());
    const lm = map.get(m.stock_item_id)!;
    const key = m.lote.toUpperCase();
    const ex = lm.get(key);
    lm.set(key, { saldo: (ex?.saldo ?? 0) + (m.type === "entrada" ? m.quantity : -m.quantity), last_movement: ex?.last_movement ?? m.created_at });
  }
  return map;
}

function buildPecaResult(
  dev: { id: string; model: string; reference: string; internal_code: string | null; udi_di: string | null; anvisa_registration: string | null; classification_code: string | null },
  devItems: { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase }[],
  lotesByItem: Map<string, Map<string, { saldo: number; last_movement: string }>>
): PecaResult {
  // Agrupar por fase: unifica múltiplos stock_items da mesma fase em uma única linha
  const faseMap = new Map<StockFase, FaseInfo>();
  for (const item of devItems) {
    const lm = lotesByItem.get(item.id);
    const itemLotes: LoteInfo[] = lm
      ? Array.from(lm.entries()).filter(([, v]) => v.saldo > 0)
        .map(([lote, v]) => ({ lote, saldo: v.saldo, last_movement: v.last_movement }))
      : [];
    if (faseMap.has(item.fase)) {
      const ex = faseMap.get(item.fase)!;
      const merged = new Map(ex.lotes.map(l => [l.lote, l]));
      for (const l of itemLotes) {
        const e = merged.get(l.lote);
        merged.set(l.lote, e ? { ...e, saldo: e.saldo + l.saldo } : l);
      }
      faseMap.set(item.fase, {
        ...ex,
        quantity: ex.quantity + item.quantity,
        quantity_reserved: ex.quantity_reserved + item.quantity_reserved,
        quantity_available: ex.quantity_available + (item.quantity - item.quantity_reserved),
        lotes: Array.from(merged.values()).sort((a, b) => b.saldo - a.saldo),
      });
    } else {
      faseMap.set(item.fase, {
        fase: item.fase,
        stock_item_id: item.id,
        quantity: item.quantity,
        quantity_reserved: item.quantity_reserved,
        quantity_available: item.quantity - item.quantity_reserved,
        location: item.location,
        lotes: itemLotes.sort((a, b) => b.saldo - a.saldo),
      });
    }
  }
  const FASE_ORDER: StockFase[] = ["retrabalho", "intermediaria", "expedicao"];
  const fases: FaseInfo[] = FASE_ORDER.filter(f => faseMap.has(f)).map(f => faseMap.get(f)!);
  return {
    device_id: dev.id, model: dev.model, reference: dev.reference, internal_code: dev.internal_code,
    udi_di: dev.udi_di, anvisa_registration: dev.anvisa_registration, classification_code: dev.classification_code,
    fases, // todas as fases, mesmo zeradas
    em_retrabalho: fases.some(f => f.fase === "retrabalho" && f.quantity > 0),
    tem_reservas: fases.some(f => f.quantity_reserved > 0),
  };
}

function totalQty(p: PecaResult): number { return p.fases.reduce((s, f) => s + f.quantity, 0); }

async function searchPecas(query: string): Promise<{ suggestions: Suggestion[]; results: PecaResult[] }> {
  const q = sanitizeQuery(query);
  if (!q || q.length < 2) return { suggestions: [], results: [] };

  // Detecta busca por lote: padrão DDMMYY-NN ou parcial com traço
  const isLoteSearch = /\d{2,6}-\d{0,2}/.test(q);

  if (isLoteSearch) {
    // Busca nos movimentos por lote (ilike para permitir parcial)
    const { data: loteMov } = await supabase.from("stock_movements")
      .select("stock_item_id, lote")
      .ilike("lote", `%${q}%`)
      .limit(200);
    if (!loteMov || loteMov.length === 0) return { suggestions: [], results: [] };
    const itemIds = [...new Set((loteMov as { stock_item_id: string }[]).map(m => m.stock_item_id))];
    const { data: stockFromLote } = await supabase.from("stock_items")
      .select("id, device_id, quantity, quantity_reserved, location, fase")
      .in("id", itemIds);
    if (!stockFromLote || stockFromLote.length === 0) return { suggestions: [], results: [] };
    const devIds = [...new Set((stockFromLote as { device_id: string }[]).map(s => s.device_id))];
    const { data: devFromLote } = await supabase.from("devices")
      .select("id, model, reference, internal_code, udi_di, anvisa_registration, classification_code")
      .in("id", devIds);
    if (!devFromLote) return { suggestions: [], results: [] };
    type DevRow = { id: string; model: string; reference: string; internal_code: string | null; udi_di: string | null; anvisa_registration: string | null; classification_code: string | null };
    const devRows = devFromLote as DevRow[];
    const stockItems = stockFromLote as { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase }[];
    const { data: movData } = await supabase.from("stock_movements")
      .select("stock_item_id, lote, type, quantity, created_at")
      .in("stock_item_id", itemIds).not("lote", "is", null).order("created_at", { ascending: false }).limit(2000);
    const lotesByItem = buildLotesByItem(movData ?? []);
    const results: PecaResult[] = devRows
      .map(dev => buildPecaResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
      .filter(p => totalQty(p) > 0)
      .sort((a, b) => totalQty(b) - totalQty(a));
    return { suggestions: devRows.map(d => ({ device_id: d.id, model: d.model, reference: d.reference })), results };
  }

  type DevRow = { id: string; model: string; reference: string; internal_code: string | null; udi_di: string | null; anvisa_registration: string | null; classification_code: string | null };
  const { data: devData } = await supabase.from("devices")
    .select("id, model, reference, internal_code, udi_di, anvisa_registration, classification_code")
    .or(`model.ilike.%${q}%,reference.ilike.%${q}%,internal_code.ilike.%${q}%,udi_di.ilike.%${q}%,anvisa_registration.ilike.%${q}%`)
    .limit(200);
  if (!devData || devData.length === 0) return { suggestions: [], results: [] };

  const allDevs = devData as DevRow[];

  // Etapa: ordenar devices — primeiro os que têm stock_items com qty > 0
  const { data: stockComQty } = await supabase.from("stock_items")
    .select("device_id").gt("quantity", 0);
  const devIdsComQty = new Set((stockComQty ?? []).map((s: { device_id: string }) => s.device_id));
  const devsOrdenados = [
    ...allDevs.filter(d => devIdsComQty.has(d.id)),
    ...allDevs.filter(d => !devIdsComQty.has(d.id)),
  ];

  const suggestions: Suggestion[] = allDevs.map(d => ({ device_id: d.id, model: d.model, reference: d.reference }));

  const { data: stockData } = await supabase.from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .in("device_id", devsOrdenados.map(d => d.id))
    .limit(2000);
  if (!stockData || stockData.length === 0) return { suggestions, results: [] };

  type StockRow = { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase };
  const stockItems = stockData as StockRow[];
  const { data: movData } = await supabase.from("stock_movements")
    .select("stock_item_id, lote, type, quantity, created_at")
    .in("stock_item_id", stockItems.map(s => s.id))
    .not("lote", "is", null).order("created_at", { ascending: false }).limit(2000);

  const lotesByItem = buildLotesByItem(movData ?? []);
  const results: PecaResult[] = devsOrdenados
    .map(dev => buildPecaResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
    .filter(p => totalQty(p) > 0)
    .sort((a, b) => totalQty(b) - totalQty(a));
  return { suggestions, results };
}

function LoteRow({ lote }: { lote: LoteInfo }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2">
        <Tag className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <span className="text-[12px] font-mono font-medium">{lote.lote}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60"><Clock className="h-2.5 w-2.5" />{fmtDate(lote.last_movement)}</span>
        <span className="text-[12px] font-bold tabular-nums">{lote.saldo} un.</span>
      </div>
    </div>
  );
}

function FaseCard({ fase }: { fase: FaseInfo }) {
  const cfg = FASE_CONFIG[fase.fase];
  return (
    <div className={cn("rounded-lg border overflow-hidden", cfg.border)}>
      <div className={cn("flex items-center gap-1.5 px-2 py-1.5", cfg.bg)}>
        <cfg.Icon className={cn("h-3 w-3 shrink-0", cfg.color)} />
        <span className={cn("text-[11px] font-semibold shrink-0", cfg.color)}>{cfg.label}</span>
        {fase.location && (
          <span className="text-[10px] text-muted-foreground/50 shrink-0 truncate">· {fase.location}</span>
        )}
        {fase.lotes.length > 0 && (
          <div className="flex-1 flex flex-wrap gap-1 min-w-0 overflow-hidden">
            {fase.lotes.map(l => (
              <span key={l.lote} className="flex items-center gap-0.5 text-[9px] font-mono bg-background/60 border border-border/30 px-1 py-0.5 rounded">
                {l.lote}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {fase.quantity_reserved > 0 && (
            <span className="text-[10px] font-semibold tabular-nums text-blue-500">{fase.quantity_reserved}r</span>
          )}
          <span className={cn("text-[12px] font-bold tabular-nums", cfg.color)}>{fase.quantity.toLocaleString("pt-BR")}</span>
          <span className="text-[9px] text-muted-foreground/50">un.</span>
        </div>
      </div>
    </div>
  );
}

function PecaCard({ peca }: { peca: PecaResult }) {
  const totalQty = peca.fases.reduce((s, f) => s + f.quantity, 0);
  return (
    <div className="rounded-xl border border-border/40 bg-card overflow-hidden hover:border-border/70 transition-colors">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-border/20 bg-muted/10">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold truncate leading-tight">{peca.model}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground/60 font-mono">{peca.reference}</span>
            {peca.udi_di && <span className="flex items-center gap-0.5 text-[9px] text-violet-600 font-mono"><Hash className="h-2.5 w-2.5" />{peca.udi_di}</span>}
            {peca.anvisa_registration && <span className="flex items-center gap-0.5 text-[9px] text-blue-600"><ShieldCheck className="h-2.5 w-2.5" />{peca.anvisa_registration}</span>}
            {peca.em_retrabalho && <span className="text-[9px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">Retrab.</span>}
            {peca.tem_reservas && <span className="text-[9px] font-medium text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full">Reserv.</span>}
          </div>
        </div>
        <span className="text-[13px] font-bold tabular-nums text-foreground shrink-0">{totalQty.toLocaleString("pt-BR")}<span className="text-[9px] font-normal text-muted-foreground/60 ml-0.5">un.</span></span>
      </div>
      <div className="px-2 py-1.5 space-y-1">
        {peca.fases.map(fase => <FaseCard key={`${fase.fase}-${fase.stock_item_id}`} fase={fase} />)}
      </div>
    </div>
  );
}

const RastreamentoPanel = memo(function RastreamentoPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PecaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca automática com debounce — sem botão, sem dropdown de sugestões
  const debouncedSearch = useDebounce(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setResults([]); setSearched(false); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { results: res } = await searchPecas(trimmed);
      setResults(res); setSearched(true);
    } catch { setError("Erro ao pesquisar."); }
    finally { setLoading(false); }
  }, 400);

  function handleChange(v: string) {
    setQuery(v);
    if (!v.trim()) { setResults([]); setSearched(false); setError(null); return; }
    setLoading(true); // feedback imediato
    debouncedSearch(v);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchInputWithBarcode
          value={query}
          onChange={v => handleChange(v)}
          onSearch={v => { setQuery(v); debouncedSearch(v); }}
          placeholder="Modelo, referência, lote (ex: 010125-01), UDI-DI ou ANVISA..."
          height="h-10"
        />
        {loading && (
          <div className="absolute right-10 top-1/2 -translate-y-1/2">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin block" />
          </div>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-[13px] text-destructive">{error}</p>
        </div>
      )}
      {searched && !loading && !error && (
        results.length === 0
          ? <div className="rounded-xl border border-border/30 bg-muted/10 py-8 text-center">
              <Package className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[13px] text-muted-foreground/60">Nenhuma peça encontrada</p>
            </div>
          : <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground/50 px-0.5">{results.length} resultado{results.length !== 1 ? "s" : ""}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {results.map(p => <PecaCard key={p.device_id} peca={p} />)}
              </div>
            </div>
      )}
      {!searched && !loading && !query && (
        <p className="text-[11px] text-muted-foreground/40 text-center py-3">
          Digite o nome, referência, lote ou código
        </p>
      )}
    </div>
  );
});

// ─── Aba: Histórico ───────────────────────────────────────────────────────────

const HistoricoPanel = memo(function HistoricoPanel() {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [faseFilter, setFaseFilter] = useState<"all" | StockFase>("all");
  const [tipoFilter, setTipoFilter] = useState<"all" | "entrada" | "saida">("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllMovements(limit, faseFilter === "all" ? undefined : faseFilter);
      setMovements(data);
    } catch { setMovements([]); }
    finally { setLoading(false); }
  }, [limit, faseFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => movements.filter(m => {
    if (tipoFilter !== "all" && m.type !== tipoFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.device_model.toLowerCase().includes(q) ||
      m.device_reference.toLowerCase().includes(q) ||
      (m.lote ?? "").toLowerCase().includes(q) ||
      (m.reason ?? "").toLowerCase().includes(q) ||
      (m.user_display_name ?? "").toLowerCase().includes(q)
    );
  }), [movements, tipoFilter, search]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-3 flex-wrap">
          <History className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold">Histórico de Movimentações</p>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar..."
              className="h-8 w-36 rounded-lg border border-border/50 bg-background px-3 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
            <select value={faseFilter} onChange={e => setFaseFilter(e.target.value as typeof faseFilter)}
              className="h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] focus:outline-none">
              <option value="all">Todas as fases</option>
              <option value="intermediaria">Intermediário</option>
              <option value="expedicao">Expedição</option>
              <option value="retrabalho">Retrabalho</option>
            </select>
            <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value as typeof tipoFilter)}
              className="h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] focus:outline-none">
              <option value="all">Entrada e Saída</option>
              <option value="entrada">Entradas</option>
              <option value="saida">Saídas</option>
            </select>
            <button onClick={load} className="h-8 w-8 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-muted/30 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground/60">Nenhuma movimentação encontrada</div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map(m => {
              const isEntrada = m.type === "entrada";
              const cfg = FASE_CONFIG[m.fase] ?? FASE_CONFIG.intermediaria;
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", isEntrada ? "bg-violet-500/10" : "bg-amber-500/10")}>
                    {isEntrada ? <ArrowDownCircle className="h-3.5 w-3.5 text-violet-500" /> : <ArrowUpCircle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{m.device_model}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground/60">{m.user_display_name ?? "—"}</span>
                      {m.lote && <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded"><Tag className="h-2.5 w-2.5" />{m.lote}</span>}
                      {m.reason && <span className="text-[10px] text-muted-foreground/50 truncate max-w-[160px]">{m.reason}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border", cfg.color, cfg.bg, cfg.border)}>
                      <cfg.Icon className="h-2.5 w-2.5" />{cfg.label}
                    </span>
                    <div className="text-right">
                      <p className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-violet-500" : "text-amber-500")}>{isEntrada ? "+" : "−"}{m.quantity}</p>
                      <p className="text-[9px] text-muted-foreground/50">{fmtDateTime(m.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && movements.length === limit && (
          <div className="px-4 py-3 border-t border-border/20">
            <button onClick={() => setLimit(l => l + 50)} className="w-full h-9 rounded-xl border border-border/40 text-[12px] text-muted-foreground hover:bg-muted/30 transition-colors">
              Carregar mais
            </button>
          </div>
        )}
        {!loading && <div className="px-4 py-2 border-t border-border/20 bg-muted/10"><p className="text-[10px] text-muted-foreground/50">{filtered.length} movimentações exibidas</p></div>}
      </div>
    </div>
  );
});

// ─── GS1 Panel ───────────────────────────────────────────────────────────────

const GS1Panel = memo(function GS1Panel() {
  const [devices, setDevices] = useState<{ id: string; model: string; reference: string; gtin: string | null; udi_di: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchAllPages<typeof devices[0]>("devices_regularizacao", "model")
      .then(all => setDevices(all.map(d => ({
        id: d.id, model: d.model, reference: d.reference,
        gtin: d.gtin ?? null, udi_di: d.udi_di ?? null,
      }))))
      .catch(() => {/* silently handled — setLoading false in finally */})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return devices;
    return devices.filter(d =>
      d.model.toLowerCase().includes(q) ||
      (d.reference ?? "").toLowerCase().includes(q) ||
      (d.gtin ?? "").includes(q)
    );
  }, [devices, search]);

  const semGtin   = devices.filter(d => !d.gtin).length;
  const comGtin   = devices.filter(d => !!d.gtin).length;

  return (
    <div className="space-y-4">
      {/* Header informativo */}
      <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
            <Barcode className="h-5 w-5 text-teal-500" />
          </div>
          <div>
            <p className="text-sm font-bold">Cadastro GS1 Brasil</p>
            <p className="text-[11px] text-muted-foreground/70">Gerencie GTINs e acesse o portal GS1 para registro de produtos médicos</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <a
            href="https://cnp.gs1br.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 h-9 rounded-xl bg-teal-500 hover:bg-teal-400 text-white text-[12px] font-semibold transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            CNP — Cadastro Nacional de Produtos
          </a>
          <a
            href="https://www.gs1br.org/consulta-gtin"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 h-9 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 text-[12px] font-semibold border border-teal-500/30 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Verificar / Consultar GTIN
          </a>
          <a
            href="https://www.gs1br.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 h-9 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 text-[12px] font-semibold border border-teal-500/30 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Portal GS1 Brasil
          </a>
        </div>
      </div>

      {/* KPIs GTIN */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3 flex items-center gap-3">
          <Hash className="h-5 w-5 text-violet-500 shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Total Peças</p>
            <p className="text-2xl font-bold tabular-nums text-violet-500">{devices.length}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-center gap-3">
          <BadgeCheck className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Com GTIN</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-500">{comGtin}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Sem GTIN</p>
            <p className="text-2xl font-bold tabular-nums text-amber-500">{semGtin}</p>
          </div>
        </div>
      </div>

      {/* Busca */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar peça por modelo, referência ou GTIN..."
        className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal-500/30"
      />

      {/* Lista */}
      <div className="rounded-2xl border border-border/30 overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/20 border-b border-border/20 grid grid-cols-12 gap-2">
          <p className="col-span-5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Modelo</p>
          <p className="col-span-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Referência</p>
          <p className="col-span-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">GTIN-13</p>
          <p className="col-span-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide text-center">GS1</p>
        </div>
        {loading && (
          <div className="flex items-center justify-center py-10">
            <div className="h-5 w-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">Nenhuma peça encontrada</div>
        )}
        {!loading && filtered.map((d, idx) => (
          <div
            key={d.id}
            className={cn("grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-border/10 last:border-0 hover:bg-muted/20 transition-colors", idx % 2 === 0 ? "" : "bg-muted/5")}
          >
            <p className="col-span-5 text-[12px] font-medium truncate">{d.model}</p>
            <p className="col-span-3 text-[11px] text-muted-foreground font-mono truncate">{d.reference}</p>
            <div className="col-span-3 flex items-center gap-1">
              {d.gtin ? (
                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{d.gtin}</span>
              ) : (
                <span className="text-[10px] text-amber-500 font-medium italic">Não cadastrado</span>
              )}
            </div>
            <div className="col-span-1 flex justify-center">
              {d.gtin ? (
                <a
                  href={`https://www.gs1br.org/consulta-gtin?gtin=${d.gtin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-6 w-6 flex items-center justify-center rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 transition-colors"
                  title="Verificar no GS1"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <a
                  href="https://cnp.gs1br.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-6 w-6 flex items-center justify-center rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 transition-colors"
                  title="Cadastrar no CNP"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      {!loading && filtered.length > 0 && (
        <p className="text-[10px] text-muted-foreground/50 text-right">{filtered.length} peça{filtered.length !== 1 ? "s" : ""} exibida{filtered.length !== 1 ? "s" : ""}</p>
      )}
    </div>
  );
});

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function Qualidade() {
  const [activeView, setActiveView] = useState<QualidadeView>("pipeline");

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold leading-tight">Qualidade</h1>
            <p className="text-[11px] text-muted-foreground/60">Pipeline ANVISA · Rastreabilidade · Histórico · GS1</p>
          </div>
        </div>
        <PageNav tabs={TABS} activeTab={activeView} onTabChange={setActiveView} />
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {activeView === "pipeline"     && <PipelinePanel />}
        {activeView === "rastreamento" && <RastreamentoPanel />}
        {activeView === "historico"    && <HistoricoPanel />}
        {activeView === "gs1"          && <GS1Panel />}
      </div>
    </div>
  );
}
