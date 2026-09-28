/**
 * GS1Panel — Integração completa com APIs GS1 Brasil
 *
 * Substitui o GS1Panel estático (apenas links externos) por um painel
 * funcional com:
 *  • Consulta de GTIN via API Provider (Verified by GS1)
 *  • Consulta por NCM / GPC via API Provider Other Keys
 *  • Consulta / cadastro / atualização via API CNP
 *  • Sincronização automática do GTIN dos devices com o CNP
 *
 * Requer a Edge Function `gs1-api` deployada no Supabase.
 *
 * ─── Como usar ────────────────────────────────────────────────────────────────
 * 1. Deploy da Edge Function:
 *      supabase functions deploy gs1-api
 * 2. Configure os secrets (veja README abaixo ou .env.example):
 *      supabase secrets set GS1_CLIENT_ID=xxx GS1_CLIENT_SECRET=yyy \
 *        GS1_USERNAME=email@empresa.com GS1_PASSWORD=senha GS1_ENV=producao
 * 3. Aparece na aba "GS1" de src/pages/Qualidade.tsx
 */

import { useState, useEffect, useMemo, memo } from "react";
import {
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  BadgeCheck,
  Hash,
  ExternalLink,
  ChevronRight,
  X,
  Package,
  Globe,
  FileSearch,
  ClipboardList,
  Loader2,
  AlertTriangle,
  Info,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/supabaseUtils";
import { toast } from "sonner";
import { KpiCard, Segmentado } from "./shared";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface DeviceGTIN {
  id: string;
  model: string;
  reference: string;
  gtin: string | null;
  udi_di: string | null;
  brand_name: string | null;
  classification_code: string | null;
}

interface GS1ProductData {
  gtin: string;
  descricao?: string;
  marca?: string;
  ncm?: string;
  gpc?: string;
  status?: string;
  empresa?: string;
  paisOrigem?: string;
  unidadeMedida?: string;
  pesoLiquido?: string;
  raw?: Record<string, unknown>;
}

interface ConsultaResult {
  ok: boolean;
  status: number;
  data?: Record<string, unknown>;
  env?: string;
  error?: string;
}

type TabGS1 = "visao_geral" | "consultar_gtin" | "consultar_ncm" | "cnp_sync";

// ─── Helper: chama a Edge Function gs1-api ────────────────────────────────────

async function callGS1(body: Record<string, unknown>): Promise<ConsultaResult> {
  const { data, error } = await supabase.functions.invoke("gs1-api", {
    body,
  });

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  return data as ConsultaResult;
}

// ─── Helper: normaliza resposta do Provider ───────────────────────────────────

function parseProviderResponse(raw: Record<string, unknown>): GS1ProductData | null {
  // A resposta pode vir em vários formatos dependendo da versão da API
  const item =
    (raw?.products as Record<string, unknown>[])?.[0] ??
    (raw?.items as Record<string, unknown>[])?.[0] ??
    raw;

  if (!item) return null;

  return {
    gtin:         String(item.gtin ?? item.gtinCd ?? ""),
    descricao:    String(item.productDescription ?? item.descricao ?? item.nome ?? ""),
    marca:        String(item.brand ?? item.marca ?? ""),
    ncm:          String(item.ncm ?? item.ncmCode ?? ""),
    gpc:          String(item.gpcCategoryCode ?? item.gpc ?? ""),
    status:       String(item.gtinStatusCd ?? item.status ?? ""),
    empresa:      String(item.companyName ?? item.empresa ?? item.fabricante ?? ""),
    paisOrigem:   String(item.countryOfOrigin ?? item.paisOrigem ?? ""),
    unidadeMedida:String(item.unitOfMeasure ?? item.unidadeMedida ?? ""),
    pesoLiquido:  String(item.netContent ?? item.pesoLiquido ?? ""),
    raw:          item as Record<string, unknown>,
  };
}

// ─── Sub-componente: badge de status GS1 ─────────────────────────────────────

function GTINStatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  if (s.includes("activ") || s === "1" || s === "ativo") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
        <CheckCircle2 className="h-2.5 w-2.5" /> Ativo
      </span>
    );
  }
  if (s.includes("inactiv") || s === "0" || s === "inativo") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20">
        <X className="h-2.5 w-2.5" /> Inativo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted/30 text-muted-foreground border border-border/30">
      <Info className="h-2.5 w-2.5" /> {status ?? "–"}
    </span>
  );
}

// ─── Sub-componente: card de produto GS1 ─────────────────────────────────────

function ProductCard({ product }: { product: GS1ProductData }) {
  const [expanded, setExpanded] = useState(false);

  const fields = [
    { label: "GTIN",           value: product.gtin },
    { label: "Descrição",      value: product.descricao },
    { label: "Marca",          value: product.marca },
    { label: "NCM",            value: product.ncm },
    { label: "GPC",            value: product.gpc },
    { label: "Empresa",        value: product.empresa },
    { label: "País de Origem", value: product.paisOrigem },
    { label: "Unid. Medida",   value: product.unidadeMedida },
    { label: "Peso Líquido",   value: product.pesoLiquido },
  ].filter(f => f.value && f.value !== "undefined" && f.value !== "");

  return (
    <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BadgeCheck className="h-4 w-4 text-teal-500 shrink-0" />
          <p className="text-[13px] font-semibold truncate">{product.descricao || "Produto GS1"}</p>
        </div>
        <GTINStatusBadge status={product.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {fields.slice(0, expanded ? undefined : 4).map(f => (
          <div key={f.label} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
            <p className="text-[11px] font-mono truncate">{f.value}</p>
          </div>
        ))}
      </div>

      {fields.length > 4 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-[10px] text-teal-600 hover:text-teal-500 font-medium"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
          {expanded ? "Ver menos" : `Ver mais ${fields.length - 4} campos`}
        </button>
      )}
    </div>
  );
}

// ─── Aba: Consultar GTIN (API Provider) ──────────────────────────────────────

function ConsultarGTINTab() {
  const [gtin, setGtin] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GS1ProductData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function handleSearch() {
    const gtinClean = gtin.replace(/\D/g, "").trim();
    if (!gtinClean || gtinClean.length < 8) {
      toast.error("Informe um GTIN válido (8, 12, 13 ou 14 dígitos)");
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    setNotFound(false);

    const res = await callGS1({
      endpoint: "provider",
      params: { gtin: gtinClean },
    });

    setLoading(false);

    if (!res.ok) {
      if (res.status === 404) {
        setNotFound(true);
      } else {
        setError(res.error ?? `Erro ${res.status} ao consultar a API GS1`);
      }
      return;
    }

    const parsed = res.data ? parseProviderResponse(res.data) : null;
    if (!parsed) {
      setNotFound(true);
    } else {
      setResult(parsed);
    }
  }

  return (
    <div className="space-y-4">
      {/* Explicação */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex gap-3">
        <Globe className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-[12px] font-semibold text-blue-700 dark:text-blue-400">API Provider — Verified by GS1</p>
          <p className="text-[11px] text-muted-foreground">
            Consulta dados de qualquer produto na base global GS1 usando o GTIN.
            Retorna: descrição, marca, NCM, GPC, empresa e mais.
          </p>
        </div>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={gtin}
          onChange={e => setGtin(e.target.value.replace(/\D/g, "").slice(0, 14))}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="GTIN (8, 12, 13 ou 14 dígitos)"
          inputMode="numeric"
          aria-label="GTIN"
          className="flex-1 min-w-0 h-11 rounded-xl border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          maxLength={14}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="h-11 px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-semibold flex items-center gap-2 transition-colors shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Consultar
        </button>
      </div>

      {/* Resultados */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-[12px] text-red-600">{error}</p>
        </div>
      )}

      {notFound && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-[12px] text-amber-600">
            GTIN não encontrado na base GS1 ou produto sem dados compartilhados.
          </p>
        </div>
      )}

      {result && <ProductCard product={result} />}

      <p className="text-[10px] text-muted-foreground/50">
        * O produto precisa ter sido cadastrado pelo dono da marca no CNP e ter dados compartilhados.
      </p>
    </div>
  );
}

// ─── Aba: Consultar por NCM / GPC ────────────────────────────────────────────

function ConsultarNCMTab() {
  const [tipo, setTipo] = useState<"NCM" | "GPC">("NCM");
  const [valor, setValor] = useState("");
  const [pagina, setPagina] = useState("0");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GS1ProductData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);

  async function handleSearch() {
    const v = valor.replace(/\D/g, "").trim();
    if (!v) {
      toast.error(`Informe um código ${tipo} válido`);
      return;
    }
    setLoading(true);
    setResults([]);
    setError(null);

    const params: Record<string, string> = {
      tipoChave: tipo,
      chave: v,
      pagina,
    };

    const res = await callGS1({ endpoint: "provider_keys", params });
    setLoading(false);

    if (!res.ok) {
      setError(res.error ?? `Erro ${res.status} ao consultar API GS1`);
      return;
    }

    const data = res.data ?? {};
    const rawItems: Record<string, unknown>[] =
      (data.products as Record<string, unknown>[]) ??
      (data.items as Record<string, unknown>[]) ??
      (Array.isArray(data) ? data as Record<string, unknown>[] : []);

    setTotalPages((data.totalPages as number) ?? null);
    setResults(
      rawItems
        .map(item => parseProviderResponse(item))
        .filter((p): p is GS1ProductData => p !== null)
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 flex gap-3">
        <FileSearch className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-[12px] font-semibold text-violet-700 dark:text-violet-400">API Provider — Chaves Alternativas</p>
          <p className="text-[11px] text-muted-foreground">
            Busca produtos por NCM (Nomenclatura Comum do Mercosul) ou GPC (Categoria Global do Produto).
            Use <code className="bg-muted px-0.5 rounded">pagina=0</code> para ver quantas páginas existem.
          </p>
        </div>
      </div>

      {/* Tipo de chave */}
      <div className="flex gap-2">
        {(["NCM", "GPC"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTipo(t)}
            className={cn(
              "h-10 px-5 rounded-xl text-sm font-semibold border transition-colors",
              tipo === t
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border/50 hover:border-violet-500/40"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="flex flex-wrap gap-2">
        <input
          value={valor}
          onChange={e => setValor(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder={tipo === "NCM" ? "Ex: 90181990" : "Ex: 10000248"}
          className="flex-1 min-w-[8rem] h-11 rounded-xl border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={pagina}
          onChange={e => setPagina(e.target.value.replace(/\D/g, ""))}
          placeholder="Página"
          aria-label="Página" inputMode="numeric"
          className="w-20 h-11 rounded-xl border border-input bg-background px-3 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="h-11 px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-semibold flex items-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Buscar
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-[12px] text-red-600">{error}</p>
        </div>
      )}

      {totalPages !== null && (
        <p className="text-[10px] text-muted-foreground">
          Total de páginas: <strong>{totalPages}</strong> · Página atual: {pagina}
        </p>
      )}

      <div className="space-y-2">
        {results.map((p, i) => (
          <ProductCard key={p.gtin || i} product={p} />
        ))}
      </div>

      {results.length === 0 && !loading && !error && (
        <p className="text-center py-8 text-sm text-muted-foreground">
          Nenhum resultado. Informe um código e clique em Buscar.
        </p>
      )}
    </div>
  );
}

// ─── Aba: CNP Sync ────────────────────────────────────────────────────────────

function CNPSyncTab({ devices }: { devices: DeviceGTIN[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, GS1ProductData | "not_found" | "error">>({});

  const devicesComGtin = useMemo(() => devices.filter(d => !!d.gtin), [devices]);

  async function verificar(d: DeviceGTIN) {
    if (!d.gtin) return;
    setLoadingId(d.id);

    const res = await callGS1({
      endpoint: "cnp_get",
      gtin: d.gtin,
    });

    setLoadingId(null);

    if (res.status === 404) {
      setResults(prev => ({ ...prev, [d.id]: "not_found" }));
      return;
    }
    if (!res.ok) {
      setResults(prev => ({ ...prev, [d.id]: "error" }));
      toast.error(`Erro ao verificar ${d.model}: ${res.error}`);
      return;
    }

    const parsed = res.data ? parseProviderResponse(res.data) : null;
    if (parsed) {
      setResults(prev => ({ ...prev, [d.id]: parsed }));
    } else {
      setResults(prev => ({ ...prev, [d.id]: "not_found" }));
    }
  }

  async function verificarTodos() {
    for (const d of devicesComGtin) {
      await verificar(d);
      // pequeno delay para não sobrecarregar
      await new Promise(r => setTimeout(r, 300));
    }
    toast.success("Verificação concluída");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 flex gap-3">
        <ClipboardList className="h-4 w-4 text-teal-500 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-[12px] font-semibold text-teal-700 dark:text-teal-400">CNP — Verificação de Cadastro</p>
          <p className="text-[11px] text-muted-foreground">
            Verifica se os GTINs cadastrados nos dispositivos existem no Cadastro Nacional de Produtos da GS1 Brasil.
            Use para garantir que seus produtos estão regularizados antes da rastreabilidade UDI/SIUD.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {devicesComGtin.length} de {devices.length} peças com GTIN
        </p>
        {devicesComGtin.length > 0 && (
          <button
            onClick={verificarTodos}
            disabled={loadingId !== null}
            className="h-11 px-4 rounded-xl border bg-card hover:bg-muted text-sm font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {loadingId ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Verificar todos
          </button>
        )}
      </div>

      {devicesComGtin.length === 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
          <AlertCircle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-[12px] text-amber-600 font-medium">Nenhuma peça com GTIN cadastrado</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Cadastre o GTIN das peças na aba ANVISA para habilitar a verificação.
          </p>
        </div>
      )}

      {devicesComGtin.length > 0 && <div className="rounded-2xl border bg-card overflow-hidden divide-y">
        {devicesComGtin.map((d) => {
          const r = results[d.id];
          const isLoading = loadingId === d.id;

          return (
            <div key={d.id}>
              <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-sm font-medium truncate">{d.model}</p>
                  <p className="text-xs font-mono text-muted-foreground">{d.gtin}</p>
                </div>

                {/* Status */}
                <div className="shrink-0">
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin text-teal-500" />}
                  {!isLoading && !r && (
                    <span className="text-[10px] text-muted-foreground/50 italic">não verificado</span>
                  )}
                  {!isLoading && r === "not_found" && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                      <AlertCircle className="h-3 w-3" /> Não encontrado no CNP
                    </span>
                  )}
                  {!isLoading && r === "error" && (
                    <span className="flex items-center gap-1 text-[10px] text-red-600 font-medium">
                      <AlertTriangle className="h-3 w-3" /> Erro na consulta
                    </span>
                  )}
                  {!isLoading && r && r !== "not_found" && r !== "error" && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                      <CheckCircle2 className="h-3 w-3" /> Cadastrado no CNP
                    </span>
                  )}
                </div>

                <button
                  onClick={() => verificar(d)}
                  disabled={isLoading}
                  className="h-10 px-3 rounded-xl border bg-card hover:bg-muted text-xs font-semibold transition-colors disabled:opacity-50 shrink-0"
                >
                  Verificar
                </button>
              </div>

              {/* Dados expandidos se encontrado */}
              {!isLoading && r && r !== "not_found" && r !== "error" && (
                <div className="px-3 pb-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 border-t border-border/10 pt-2">
                  {[
                    { label: "Marca",    value: (r as GS1ProductData).marca },
                    { label: "NCM",      value: (r as GS1ProductData).ncm },
                    { label: "GPC",      value: (r as GS1ProductData).gpc },
                    { label: "Status",   value: (r as GS1ProductData).status },
                  ].filter(f => f.value && f.value !== "undefined").map(f => (
                    <div key={f.label}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
                      <p className="text-[10px] font-mono truncate">{f.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

// ─── Aba: Visão Geral ─────────────────────────────────────────────────────────

function VisaoGeralTab({
  devices,
  onTabChange,
}: {
  devices: DeviceGTIN[];
  onTabChange: (t: TabGS1) => void;
}) {
  const semGtin = devices.filter(d => !d.gtin).length;
  const comGtin = devices.filter(d => !!d.gtin).length;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <KpiCard label="Peças" value={devices.length} Icon={Hash} sub="cadastradas" />
        <KpiCard label="Com GTIN" value={comGtin} Icon={BadgeCheck} tom="ok" onClick={() => onTabChange("cnp_sync")} sub="verificar no CNP" />
        <KpiCard label="Sem GTIN" value={semGtin} Icon={AlertCircle} tom={semGtin > 0 ? "atencao" : "neutro"} sub={semGtin > 0 ? "cadastre na aba ANVISA" : "tudo certo"} />
      </div>

      {/* Ações rápidas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          onClick={() => onTabChange("consultar_gtin")}
          className="flex items-center gap-3 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 transition-colors text-left"
        >
          <Globe className="h-5 w-5 text-blue-500 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-blue-700 dark:text-blue-400">Consultar GTIN</p>
            <p className="text-[10px] text-muted-foreground">Verified by GS1 · API Provider</p>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
        </button>
        <button
          onClick={() => onTabChange("consultar_ncm")}
          className="flex items-center gap-3 p-3 rounded-xl border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 transition-colors text-left"
        >
          <FileSearch className="h-5 w-5 text-violet-500 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-violet-700 dark:text-violet-400">Buscar NCM / GPC</p>
            <p className="text-[10px] text-muted-foreground">Chaves alternativas · API Provider</p>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
        </button>
        <button
          onClick={() => onTabChange("cnp_sync")}
          className="flex items-center gap-3 p-3 rounded-xl border border-teal-500/20 bg-teal-500/5 hover:bg-teal-500/10 transition-colors text-left"
        >
          <ShieldCheck className="h-5 w-5 text-teal-500 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-teal-700 dark:text-teal-400">Verificar CNP</p>
            <p className="text-[10px] text-muted-foreground">Cadastro Nacional de Produtos</p>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
        </button>
      </div>

      {/* Links externos */}
      <div className="flex flex-col sm:flex-row gap-2">
        <a
          href="https://cnp.gs1br.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Portal CNP — Cadastro Nacional de Produtos
        </a>
        <a
          href="https://swagger-api.gs1br.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 h-11 px-4 rounded-xl border bg-card hover:bg-muted text-foreground text-sm font-semibold transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Swagger GS1 Brasil
        </a>
      </div>

      {/* Lista de peças sem GTIN */}
      {semGtin > 0 && (
        <section className="rounded-2xl border bg-card overflow-hidden">
          <p className="px-4 py-3 border-b text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Peças sem GTIN ({semGtin}) — cadastre na aba ANVISA
          </p>
          <ul className="divide-y">
            {devices.filter(d => !d.gtin).slice(0, 5).map(d => (
              <li key={d.id} className="px-4 py-2.5 flex items-center gap-3">
                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm truncate flex-1 min-w-0">{d.model}</p>
                <p className="text-xs font-mono text-muted-foreground shrink-0">{d.reference}</p>
              </li>
            ))}
          </ul>
          {semGtin > 5 && (
            <p className="px-4 py-2 border-t text-xs text-muted-foreground text-center">+ {semGtin - 5} peças sem GTIN</p>
          )}
        </section>
      )}
    </div>
  );
}

// ─── GS1 Panel Principal ──────────────────────────────────────────────────────

const GS1_SUBTABS: { id: TabGS1; label: string }[] = [
  { id: "visao_geral",     label: "Visão geral" },
  { id: "consultar_gtin",  label: "Consultar GTIN" },
  { id: "consultar_ncm",   label: "NCM / GPC" },
  { id: "cnp_sync",        label: "Verificar CNP" },
];

export const GS1Panel = memo(function GS1Panel() {
  const [devices, setDevices]     = useState<DeviceGTIN[]>([]);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<TabGS1>("visao_geral");

  useEffect(() => {
    fetchAllPages<DeviceGTIN>("devices_regularizacao", "model")
      .then(all =>
        setDevices(
          all.map(d => ({
            id:                 d.id,
            model:              d.model,
            reference:          d.reference,
            gtin:               d.gtin ?? null,
            udi_di:             d.udi_di ?? null,
            brand_name:         d.brand_name ?? null,
            classification_code: d.classification_code ?? null,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {/* Sub-abas */}
      <Segmentado<TabGS1> valor={activeTab} onChange={setActiveTab} className="w-full sm:w-auto sm:inline-flex"
        opcoes={GS1_SUBTABS.map(t => ({ id: t.id, label: t.label }))} />

      {/* Conteúdo */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {activeTab === "visao_geral"    && <VisaoGeralTab devices={devices} onTabChange={setActiveTab} />}
          {activeTab === "consultar_gtin" && <ConsultarGTINTab />}
          {activeTab === "consultar_ncm"  && <ConsultarNCMTab />}
          {activeTab === "cnp_sync"       && <CNPSyncTab devices={devices} />}
        </>
      )}
    </div>
  );
});

export default GS1Panel;
