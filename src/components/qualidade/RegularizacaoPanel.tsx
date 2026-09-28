/**
 * Regularização ANVISA — pipeline de 4 fases por peça:
 *  Fase 1 — Pré-requisitos da empresa (LF · AFE · BPF)
 *  Fase 2 — Classificação de risco (RDC 751/2022)
 *  Fase 3 — Regularização ANVISA (Notificação ou Registro no Solicita)
 *  Fase 4 — Rastreabilidade UDI + GTIN + SIUD
 *
 * Lista todas as peças (antes só as que faltavam regularizar — agora também
 * as concluídas, para acompanhar vencimento do registro). Clique abre o
 * detalhe; quem tem perfil Qualidade/Gerente/Admin pode editar.
 *
 * Gravação: admin grava direto em `devices` (a policy de UPDATE só libera
 * admin/financeiro). Qualidade e gerente gravam pela RPC
 * `qualidade_atualizar_regularizacao`; se ela
 * ainda não existir no banco, avisa com uma mensagem clara em vez de falhar
 * em silêncio.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, ExternalLink,
  Hash, Loader2, Lock, RefreshCw, Save, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { temPapel } from "@/types/roles";
import { untypedRpc } from "@/lib/untypedRpc";
import { friendlyError } from "@/lib/errorMessages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CampoBusca, Campo, Chip, Etapas, KpiCard, ListaSkeleton, SELECT_CLS, Vazio, fmtDia, type Tom } from "./shared";

// ─── Tipos e constantes ──────────────────────────────────────────────────────

type FaseNum = 1 | 2 | 3 | 4 | 5;
type StatusReg = "pendente" | "em_processo" | "notificado" | "registrado" | "cancelado";

export interface DeviceReg {
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

const STATUS_REG: Record<StatusReg, { label: string; tom: Tom }> = {
  pendente:    { label: "Pendente",    tom: "neutro" },
  em_processo: { label: "Em processo", tom: "atencao" },
  notificado:  { label: "Notificado",  tom: "ok" },
  registrado:  { label: "Registrado",  tom: "info" },
  cancelado:   { label: "Cancelado",   tom: "perigo" },
};

const ETAPAS_REG = ["Empresa", "Classe", "ANVISA", "UDI/GTIN", "Concluído"];

const LINK_AFE = "https://www.gov.br/pt-br/servicos/solicitar-autorizacao-de-funcionamento-afe-dispositivos-medicos";
const LINK_SOLICITA = "https://solicita.anvisa.gov.br";
const LINK_GS1 = "https://gs1br.org";

const PROXIMO_PASSO: Record<1 | 2 | 3 | 4, { texto: string; link?: { href: string; label: string } }> = {
  1: { texto: "Falta licença da empresa (LF/AFE)", link: { href: LINK_AFE, label: "Obter AFE no portal ANVISA" } },
  2: { texto: "Definir classe de risco (RDC 751/2022) e o código de classificação" },
  3: { texto: "Protocolar a notificação/registro", link: { href: LINK_SOLICITA, label: "Abrir o Solicita" } },
  4: { texto: "Cadastrar GTIN e UDI-DI", link: { href: LINK_GS1, label: "Obter GTIN na GS1 Brasil" } },
};

type Filtro = "abertas" | "1" | "2" | "3" | "4" | "5" | "em_processo" | "vencendo" | "todas";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcGTIN13Check(digits12: string): string {
  const d = digits12.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * Valida o dígito verificador de um GTIN (padrão GS1, módulo 10) — aceita
 * GTIN-8, GTIN-12, GTIN-13 ou GTIN-14. Retorna null se a string não tem um
 * tamanho válido de GTIN (pode ser um código interno usado como UDI-DI).
 */
function validarGtinCheckDigit(raw: string): boolean | null {
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const n = digits.length;
  const expected = Number(digits[n - 1]);
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const digit = Number(digits[i - 1]);
    const weight = (n - i) % 2 === 1 ? 3 : 1;
    sum += digit * weight;
  }
  return (10 - (sum % 10)) % 10 === expected;
}

function venceInfo(dias: number | null): { texto: string; tom: Tom } | null {
  if (dias === null || dias >= 365) return null;
  if (dias < 0) return { texto: `Registro vencido há ${-dias}d`, tom: "perigo" };
  return { texto: `Vence em ${dias}d`, tom: dias < 90 ? "perigo" : "atencao" };
}

function rpcAusente(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("could not find the function") || (m.includes("function") && m.includes("does not exist")) || m.includes("pgrst202");
}

// ─── Painel ──────────────────────────────────────────────────────────────────

export const RegularizacaoPanel = memo(function RegularizacaoPanel({ filtroInicial, onMudou }: { filtroInicial?: string | null; onMudou?: () => void }) {
  const { isAdmin, role } = useAuth();
  const podeEditar = temPapel(role, "qualidade");
  const [devices, setDevices] = useState<DeviceReg[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>(() => {
    const f = filtroInicial as Filtro | null | undefined;
    return f && ["abertas", "1", "2", "3", "4", "5", "em_processo", "vencendo", "todas"].includes(f) ? f : "abertas";
  });
  const [aberto, setAberto] = useState<DeviceReg | null>(null);
  const [visiveis, setVisiveis] = useState(40);

  const load = useCallback(async () => {
    setLoading(true); setErro(false);
    try {
      const all: DeviceReg[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase
          .from("devices_regularizacao")
          .select("*")
          .order("fase_atual", { ascending: true })
          .order("model", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) { setErro(true); break; }
        if (!page) break;
        all.push(...(page as unknown as DeviceReg[]));
        if (page.length < PAGE) break;
      }
      setDevices(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setVisiveis(40); }, [filtro, busca]);

  const kpis = useMemo(() => ({
    abertas: devices.filter(d => d.fase_atual < 5).length,
    emProcesso: devices.filter(d => d.status_regularizacao === "em_processo").length,
    vencendo: devices.filter(d => d.dias_ate_vencer !== null && d.dias_ate_vencer < 365).length,
    concluidas: devices.filter(d => d.fase_atual === 5).length,
  }), [devices]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return devices.filter(d => {
      if (filtro === "abertas" && d.fase_atual >= 5) return false;
      if (["1", "2", "3", "4", "5"].includes(filtro) && String(d.fase_atual) !== filtro) return false;
      if (filtro === "em_processo" && d.status_regularizacao !== "em_processo") return false;
      if (filtro === "vencendo" && !(d.dias_ate_vencer !== null && d.dias_ate_vencer < 365)) return false;
      if (!q) return true;
      return `${d.model} ${d.reference ?? ""} ${d.anvisa_registration ?? ""} ${d.udi_di ?? ""} ${d.gtin ?? ""} ${d.numero_processo_anvisa ?? ""}`.toLowerCase().includes(q);
    }).sort((a, b) => filtro === "vencendo" ? (a.dias_ate_vencer ?? 0) - (b.dias_ate_vencer ?? 0) : 0);
  }, [devices, filtro, busca]);

  const alternar = (f: Filtro) => setFiltro(atual => atual === f ? "todas" : f);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="A regularizar" value={kpis.abertas} Icon={AlertCircle} tom={kpis.abertas > 0 ? "atencao" : "ok"}
          sub="peças que ainda não passaram pelas 4 fases" ativo={filtro === "abertas"} onClick={() => alternar("abertas")} />
        <KpiCard label="Em processo" value={kpis.emProcesso} Icon={ClipboardCheck} tom="info"
          sub="petição protocolada na ANVISA" ativo={filtro === "em_processo"} onClick={() => alternar("em_processo")} />
        <KpiCard label="Vence em 1 ano" value={kpis.vencendo} Icon={CalendarClock} tom={kpis.vencendo > 0 ? "perigo" : "neutro"}
          sub="registro/notificação a renovar" ativo={filtro === "vencendo"} onClick={() => alternar("vencendo")} />
        <KpiCard label="Concluídas" value={kpis.concluidas} Icon={CheckCircle2} tom="ok"
          sub="regularizadas e com UDI/GTIN" ativo={filtro === "5"} onClick={() => alternar("5")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CampoBusca value={busca} onChange={setBusca} placeholder="Peça, referência, ANVISA ou GTIN..." />
        <select value={filtro} onChange={e => setFiltro(e.target.value as Filtro)} aria-label="Fase" className={cn(SELECT_CLS, "w-auto flex-1 sm:flex-none")}>
          <option value="abertas">A regularizar (fases 1–4)</option>
          <option value="1">Fase 1 — Empresa</option>
          <option value="2">Fase 2 — Classificação</option>
          <option value="3">Fase 3 — ANVISA</option>
          <option value="4">Fase 4 — UDI/GTIN</option>
          <option value="5">Concluídas</option>
          <option value="em_processo">Em processo na ANVISA</option>
          <option value="vencendo">Vencendo em 1 ano</option>
          <option value="todas">Todas as peças</option>
        </select>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && devices.length === 0 ? <ListaSkeleton /> : erro && devices.length === 0 ? (
          <Vazio Icon={AlertTriangle} titulo="Não foi possível carregar as peças" dica="Verifique a conexão e tente de novo."
            acao={<Button variant="outline" onClick={load}>Tentar de novo</Button>} />
        ) : filtrados.length === 0 ? (
          <Vazio Icon={ShieldCheck} titulo={busca ? "Nenhuma peça encontrada" : filtro === "abertas" ? "Todas as peças estão regularizadas" : "Nada neste filtro"}
            dica={busca ? "Confira a grafia ou busque pela referência." : "Troque o filtro para ver as outras peças."}
            acao={filtro !== "todas" ? <Button variant="outline" onClick={() => setFiltro("todas")}>Ver todas as peças</Button> : undefined} />
        ) : (
          <>
            <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30">
              {filtrados.length} peça{filtrados.length !== 1 ? "s" : ""}{!podeEditar && " · somente leitura para o seu perfil"}
            </div>
            <ul className="divide-y">
              {filtrados.slice(0, visiveis).map(d => <LinhaPeca key={d.id} d={d} onAbrir={() => setAberto(d)} />)}
            </ul>
            {visiveis < filtrados.length && (
              <div className="p-3 border-t">
                <Button variant="outline" className="w-full h-11" onClick={() => setVisiveis(v => v + 40)}>
                  Mostrar mais ({filtrados.length - visiveis} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {aberto && (
        <RegularizacaoDialog device={aberto} podeEditar={podeEditar} isAdmin={isAdmin}
          onClose={() => setAberto(null)} onSaved={() => { setAberto(null); load(); onMudou?.(); }} />
      )}
    </div>
  );
});

function LinhaPeca({ d, onAbrir }: { d: DeviceReg; onAbrir: () => void }) {
  const st = STATUS_REG[d.status_regularizacao] ?? STATUS_REG.pendente;
  const venc = venceInfo(d.dias_ate_vencer);
  const passo = d.fase_atual < 5 ? PROXIMO_PASSO[d.fase_atual as 1 | 2 | 3 | 4] : null;
  return (
    <li className="hover:bg-muted/30 transition-colors">
      <button type="button" onClick={onAbrir}
        className="w-full text-left px-4 pt-3.5 pb-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem_8.5rem] lg:items-center focus-visible:outline-none focus-visible:bg-muted/40">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold truncate">{d.model}</p>
              <p className="text-xs text-muted-foreground font-mono truncate">{d.reference}</p>
            </div>
            <Chip tom={st.tom} className="lg:hidden shrink-0">{st.label}</Chip>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.risk_class && <Chip>Classe {d.risk_class} · {d.regime === "notificacao" ? "Notificação" : "Registro"}</Chip>}
            {d.anvisa_registration && <Chip tom="info"><ShieldCheck className="h-3 w-3" />{d.anvisa_registration}</Chip>}
            {d.udi_di && <Chip tom="roxo" className="font-mono"><Hash className="h-3 w-3" />{d.udi_di}</Chip>}
            {venc && <Chip tom={venc.tom}><CalendarClock className="h-3 w-3" />{venc.texto}</Chip>}
            {(!d.empresa_lf || !d.empresa_afe) && <Chip tom="atencao"><AlertTriangle className="h-3 w-3" />{!d.empresa_lf ? "Sem LF" : "Sem AFE"}</Chip>}
          </div>
        </div>
        <Etapas etapas={ETAPAS_REG} atual={d.fase_atual - 1} tom={d.fase_atual === 5 ? "ok" : "primary"} concluido={d.fase_atual === 5} />
        <div className="hidden lg:flex items-center gap-2 justify-end">
          <Chip tom={st.tom}>{st.label}</Chip>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>
      {passo ? (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">Próximo passo: {passo.texto}</span>
          {passo.link && (
            <a href={passo.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline py-1">
              {passo.link.label}<ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ) : <div className="pb-1.5" />}
    </li>
  );
}

// ─── Diálogo de detalhe/edição ───────────────────────────────────────────────

function Secao({ n, faseAtual, titulo, link, children }: { n: FaseNum; faseAtual: FaseNum; titulo: string; link?: { href: string; label: string }; children: React.ReactNode }) {
  const feito = faseAtual > n;
  return (
    <section className="rounded-2xl border p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          feito ? "bg-emerald-500 text-white" : faseAtual === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {feito ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
        </span>
        <p className="text-sm font-semibold flex-1 min-w-0">{titulo}</p>
        {link && (
          <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 py-1">
            {link.label}<ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function Alternar({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={() => onChange(!value)} disabled={disabled} aria-pressed={value}
      className={cn("flex items-center gap-2 h-11 px-3 rounded-xl border text-sm font-medium transition-colors w-full text-left disabled:cursor-not-allowed",
        value ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" : "bg-muted/30 border-border text-muted-foreground",
        disabled && "opacity-80")}>
      {value ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function RegularizacaoDialog({ device, podeEditar, isAdmin, onClose, onSaved }: {
  device: DeviceReg; podeEditar: boolean; isAdmin: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    empresa_lf:             !!device.empresa_lf,
    empresa_afe:            !!device.empresa_afe,
    empresa_bpf:            !!device.empresa_bpf,
    risk_class:             device.risk_class ?? "",
    classification_code:    device.classification_code ?? "",
    status_regularizacao:   device.status_regularizacao ?? "pendente",
    anvisa_registration:    device.anvisa_registration ?? "",
    numero_processo_anvisa: device.numero_processo_anvisa ?? "",
    data_registro_anvisa:   device.data_registro_anvisa ?? "",
    data_vencimento_anvisa: device.data_vencimento_anvisa ?? "",
    udi_di:                 device.udi_di ?? "",
    gtin:                   device.gtin ?? "",
    rotulo_udi_ok:          !!device.rotulo_udi_ok,
    siud_transmitido_em:    device.siud_transmitido_em ? device.siud_transmitido_em.slice(0, 10) : "",
  });
  const [saving, setSaving] = useState(false);
  const [gtinPrefix, setGtinPrefix] = useState("789");
  const [gtinCompany, setGtinCompany] = useState("");
  const [gtinProduct, setGtinProduct] = useState("");
  const ro = !podeEditar;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  function gerarGTIN() {
    const base = `${gtinPrefix}${gtinCompany.padEnd(4, "0").slice(0, 4)}${gtinProduct.padEnd(5, "0").slice(0, 5)}`;
    if (base.length !== 12) { toast.error("Preencha os 3 campos para gerar o GTIN"); return; }
    const gtin = `${base}${calcGTIN13Check(base)}`;
    setForm(f => ({ ...f, gtin, udi_di: f.udi_di || gtin }));
    toast.success(`GTIN-13 gerado: ${gtin}`);
  }

  const faseAtual: FaseNum = (() => {
    if (!form.empresa_lf || !form.empresa_afe) return 1;
    if (!form.risk_class || !form.classification_code) return 2;
    if (form.status_regularizacao === "pendente" || form.status_regularizacao === "em_processo") return 3;
    if (!form.udi_di || !form.gtin) return 4;
    return 5;
  })();

  async function handleSave() {
    setSaving(true);
    const payload = {
      empresa_lf:             form.empresa_lf,
      empresa_afe:            form.empresa_afe,
      empresa_bpf:            form.empresa_bpf,
      risk_class:             form.risk_class || "",
      classification_code:    form.classification_code || "",
      status_regularizacao:   form.status_regularizacao,
      anvisa_registration:    form.anvisa_registration.trim() || null,
      numero_processo_anvisa: form.numero_processo_anvisa.trim() || null,
      data_registro_anvisa:   form.data_registro_anvisa || null,
      data_vencimento_anvisa: form.data_vencimento_anvisa || null,
      udi_di:                 form.udi_di.trim() || null,
      gtin:                   form.gtin || null,
      rotulo_udi_ok:          form.rotulo_udi_ok,
      siud_transmitido_em:    form.siud_transmitido_em ? new Date(`${form.siud_transmitido_em}T12:00:00`).toISOString() : null,
    };
    try {
      if (isAdmin) {
        const { error } = await supabase.from("devices").update(payload).eq("id", device.id);
        if (error) throw error;
      } else {
        const { data, error } = await untypedRpc("qualidade_atualizar_regularizacao", { p_device_id: device.id, p_dados: payload });
        if (error) {
          if (rpcAusente(error.message)) {
            toast.error("Seu perfil ainda não pode salvar a regularização — peça ao administrador para liberar (atualização do banco pendente).", { duration: 7000 });
            return;
          }
          throw error;
        }
        const r = data as { ok?: boolean; error?: string } | null;
        if (r && r.ok === false) { toast.error(r.error ?? "Não foi possível salvar."); return; }
      }
      toast.success("Dados de regularização atualizados!");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  const st = STATUS_REG[form.status_regularizacao] ?? STATUS_REG.pendente;
  const classeAlta = form.risk_class === "III" || form.risk_class === "IV";

  return (
    <Dialog open onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="text-left pr-6">
          <DialogTitle className="leading-snug">{device.model}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{device.reference}</span>
            <Chip tom={st.tom}>{st.label}</Chip>
            {ro && <Chip><Lock className="h-3 w-3" />Somente leitura</Chip>}
          </DialogDescription>
        </DialogHeader>

        <Etapas etapas={ETAPAS_REG} atual={faseAtual - 1} tom={faseAtual === 5 ? "ok" : "primary"} concluido={faseAtual === 5} />

        <div className="space-y-3">
          <Secao n={1} faseAtual={faseAtual} titulo="Pré-requisitos da empresa" link={{ href: LINK_AFE, label: "Portal ANVISA" }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Alternar value={form.empresa_lf}  onChange={v => set("empresa_lf", v)}  label="LF — Licença local" disabled={ro} />
              <Alternar value={form.empresa_afe} onChange={v => set("empresa_afe", v)} label="AFE — ANVISA" disabled={ro} />
              <Alternar value={form.empresa_bpf} onChange={v => set("empresa_bpf", v)} label="BPF — Fabricação" disabled={ro} />
            </div>
          </Secao>

          <Secao n={2} faseAtual={faseAtual} titulo="Classificação de risco (RDC 751/2022)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Classe de risco">
                <select value={form.risk_class} onChange={e => set("risk_class", e.target.value)} disabled={ro} className={SELECT_CLS}>
                  <option value="">Selecionar...</option>
                  <option value="I">Classe I — Risco mínimo (Notificação)</option>
                  <option value="II">Classe II — Risco médio (Notificação)</option>
                  <option value="III">Classe III — Risco elevado (Registro)</option>
                  <option value="IV">Classe IV — Risco máximo (Registro)</option>
                </select>
              </Campo>
              <Campo label="Código de classificação">
                <Input value={form.classification_code} onChange={e => set("classification_code", e.target.value)} placeholder="Ex: 10-03" disabled={ro} className="h-11" />
              </Campo>
            </div>
            {form.risk_class && (
              <p className={cn("text-xs px-3 py-2 rounded-xl border",
                ["I", "II"].includes(form.risk_class) ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20")}>
                {["I", "II"].includes(form.risk_class)
                  ? "Notificação — formulário eletrônico no Solicita · prazo: semanas"
                  : "Registro — dossiê técnico IMDRF + possível certificação Inmetro · prazo: meses a anos"}
              </p>
            )}
          </Secao>

          <Secao n={3} faseAtual={faseAtual} titulo="Regularização ANVISA" link={{ href: LINK_SOLICITA, label: "Solicita" }}>
            <Campo label="Situação no Solicita"
              dica={(form.status_regularizacao === "registrado" || form.status_regularizacao === "notificado") && !form.anvisa_registration.trim() ? (
                <span className="block text-xs text-red-600 dark:text-red-400">A situação diz "{STATUS_REG[form.status_regularizacao].label.toLowerCase()}", mas falta o número de registro/notificação — sem ele não há como comprovar perante a ANVISA.</span>
              ) : undefined}>
              <select value={form.status_regularizacao} onChange={e => set("status_regularizacao", e.target.value as StatusReg)} disabled={ro} className={SELECT_CLS}>
                <option value="pendente">Pendente — ainda não peticionado</option>
                <option value="em_processo">Em processo — petição protocolada</option>
                <option value="notificado">Notificado — notificação concedida</option>
                <option value="registrado">Registrado — registro concedido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Nº do processo (Solicita)">
                <Input value={form.numero_processo_anvisa} onChange={e => set("numero_processo_anvisa", e.target.value)} placeholder="Ex: 25351.000001/2024-01" disabled={ro} className="h-11" />
              </Campo>
              <Campo label="Nº de registro / notificação">
                <Input value={form.anvisa_registration} onChange={e => set("anvisa_registration", e.target.value)} placeholder="Ex: 10302340001" disabled={ro} className="h-11" />
              </Campo>
              <Campo label="Data de concessão">
                <Input type="date" value={form.data_registro_anvisa} onChange={e => set("data_registro_anvisa", e.target.value)} disabled={ro} className="h-11" />
              </Campo>
              <Campo label="Validade (10 anos)">
                <Input type="date" value={form.data_vencimento_anvisa} onChange={e => set("data_vencimento_anvisa", e.target.value)} disabled={ro} className="h-11" />
              </Campo>
            </div>
            {form.anvisa_registration && (
              <a href={`https://consultas.anvisa.gov.br/#/produtos/${encodeURIComponent(form.anvisa_registration)}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline py-1">
                <ExternalLink className="h-3 w-3" />Consultar no portal ANVISA
              </a>
            )}
          </Secao>

          <Secao n={4} faseAtual={faseAtual} titulo="Rastreabilidade UDI + GTIN" link={{ href: LINK_GS1, label: "GS1 Brasil" }}>
            {!ro && (
              <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Gerar GTIN-13 (prefixo + empresa + produto)</p>
                <div className="flex flex-wrap gap-2">
                  <Input value={gtinPrefix} onChange={e => setGtinPrefix(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="789" maxLength={3} inputMode="numeric" aria-label="Prefixo do país" className="w-16 h-11 font-mono text-center px-1" />
                  <Input value={gtinCompany} onChange={e => setGtinCompany(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0001" maxLength={4} inputMode="numeric" aria-label="Código da empresa" className="w-20 h-11 font-mono text-center px-1" />
                  <Input value={gtinProduct} onChange={e => setGtinProduct(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="00001" maxLength={5} inputMode="numeric" aria-label="Código do produto" className="w-24 h-11 font-mono text-center px-1" />
                  <Button type="button" variant="secondary" onClick={gerarGTIN} className="h-11 flex-1 min-w-[6rem]">Gerar</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Brasil: 789 ou 790 · Empresa: 4 dígitos · Produto: 5 dígitos</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="GTIN-13 / GTIN-14"
                dica={form.gtin && validarGtinCheckDigit(form.gtin) === false ? <span className="block text-xs text-red-600 dark:text-red-400">Dígito verificador inválido — confira o GTIN (padrão GS1, módulo 10).</span> : undefined}>
                <Input value={form.gtin} onChange={e => set("gtin", e.target.value.replace(/\D/g, "").slice(0, 14))} placeholder="7890001000012" inputMode="numeric" disabled={ro} className="h-11 font-mono" />
              </Campo>
              <Campo label="UDI-DI"
                dica={form.udi_di && validarGtinCheckDigit(form.udi_di) === false ? <span className="block text-xs text-red-600 dark:text-red-400">Dígito verificador inválido — confira o UDI-DI.</span> : undefined}>
                <Input value={form.udi_di} onChange={e => set("udi_di", e.target.value)} placeholder="Igual ao GTIN (padrão GS1)" disabled={ro} className="h-11 font-mono" />
              </Campo>
            </div>
            {classeAlta && !form.rotulo_udi_ok && (
              <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 rounded-xl px-3 py-2">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Classe {form.risk_class}: rótulo com UDI já é <strong>obrigatório desde {form.risk_class === "IV" ? "10/07/2025" : "10/01/2026"}</strong> (RDC 591/2021 + RDC 884/2024) — diferente do envio ao SIUD, que ainda tem prazo até 2029/2030.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <Alternar value={form.rotulo_udi_ok} onChange={v => set("rotulo_udi_ok", v)} label="Rótulo com código de barras UDI" disabled={ro} />
              <Campo label="Transmitido ao SIUD em">
                <Input type="date" value={form.siud_transmitido_em} onChange={e => set("siud_transmitido_em", e.target.value)} disabled={ro} className="h-11" />
              </Campo>
            </div>
          </Secao>

          {device.updated_at && <p className="text-[11px] text-muted-foreground">Última alteração: {fmtDia(device.updated_at)}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-11">{ro ? "Fechar" : "Cancelar"}</Button>
          {!ro && (
            <Button onClick={handleSave} disabled={saving} className="h-11 gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
