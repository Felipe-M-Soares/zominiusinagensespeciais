/**
 * FuturasPanel — Funcionalidades Futuras + Suporte Offline (Módulo 11 + 12)
 * Roadmap: IoT, ERP, IA preditiva, mobile, BI, alertas automáticos, notificações push
 * + Documentação do modo offline (PWA + sync)
 */

import { useState } from "react";
import {
  Sparkles, Wifi, WifiOff, Cpu, Link2, BarChart3, Bell,
  Smartphone, Brain, ChevronDown, ChevronUp, CheckCircle2,
  Clock, AlertTriangle, ArrowRight, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type StatusRoadmap = "planejado" | "em_desenvolvimento" | "beta" | "disponivel";

interface ItemRoadmap {
  id: string;
  titulo: string;
  descricao: string;
  detalhe: string;
  status: StatusRoadmap;
  previsao?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  tags: string[];
  beneficios: string[];
}

const STATUS_ROADMAP: Record<StatusRoadmap, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  planejado: { label: "Planejado", color: "text-muted-foreground", bg: "bg-muted/40", icon: Clock },
  em_desenvolvimento: { label: "Em Desenvolvimento", color: "text-blue-500", bg: "bg-blue-500/10", icon: Cpu },
  beta: { label: "Beta / Piloto", color: "text-amber-500", bg: "bg-amber-500/10", icon: AlertTriangle },
  disponivel: { label: "Disponível", color: "text-green-500", bg: "bg-green-500/10", icon: CheckCircle2 },
};

const ROADMAP: ItemRoadmap[] = [
  {
    id: "offline",
    titulo: "Modo Offline (PWA)",
    descricao: "Uso completo sem conexão à internet, sincronização automática ao reconectar",
    detalhe: "O sistema utiliza Service Workers e IndexedDB para armazenar dados localmente. Apontamentos, paradas e refugos registrados offline ficam em fila e são sincronizados com o Supabase automaticamente ao restabelecer a conexão. Conflitos são resolvidos com estratégia last-write-wins com log de auditoria.",
    status: "em_desenvolvimento",
    previsao: "Q2 2025",
    icon: WifiOff,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
    tags: ["PWA", "Service Worker", "IndexedDB", "Sync"],
    beneficios: [
      "Registrar apontamentos mesmo sem Wi-Fi",
      "Dados sempre salvos localmente primeiro",
      "Sync automático e transparente ao reconectar",
      "Indicador visual de status de sincronização",
    ],
  },
  {
    id: "iot",
    titulo: "Integração IoT",
    descricao: "Coleta automática de dados de máquinas via sensores e CLPs",
    detalhe: "Conexão com PLCs (Allen-Bradley, Siemens S7), coletores OPC-UA e protocolos MQTT. Dados de produção, temperatura, vibração e consumo energético alimentados automaticamente no dashboard sem intervenção do operador.",
    status: "planejado",
    previsao: "Q3 2025",
    icon: Zap,
    color: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    tags: ["OPC-UA", "MQTT", "PLC", "CLP", "Sensores"],
    beneficios: [
      "Apontamento 100% automático sem papel",
      "Dados de OEE em tempo real por sensor",
      "Alertas automáticos de desvio de processo",
      "Rastreabilidade total de lote e máquina",
    ],
  },
  {
    id: "erp",
    titulo: "Integração com ERP",
    descricao: "Conexão bidirecional com SAP, TOTVS, Oracle e outros ERPs",
    detalhe: "API REST para integração com ERPs legados e modernos. Ordens de produção importadas do ERP, produção apontada sincronizada de volta, consumo de MP atualizado em tempo real no ERP. Suporte a SAP RFC, TOTVS Fluig e Oracle E-Business Suite.",
    status: "planejado",
    previsao: "Q4 2025",
    icon: Link2,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    tags: ["SAP", "TOTVS", "API REST", "Webhook"],
    beneficios: [
      "Elimina dupla digitação entre MES e ERP",
      "Ordens de produção importadas automaticamente",
      "Estoque de MP sincronizado em tempo real",
      "NF e rastreabilidade integrados",
    ],
  },
  {
    id: "ia_preditiva",
    titulo: "IA para Previsão de Falhas",
    descricao: "Machine Learning para prever paradas e manutenção preditiva",
    detalhe: "Modelos de ML treinados com histórico de paradas, horímetro e dados de sensores para prever falhas com até 72h de antecedência. Algoritmos de anomaly detection em tempo real, recomendações automáticas de manutenção e impacto estimado na produção.",
    status: "planejado",
    previsao: "2026",
    icon: Brain,
    color: "text-[hsl(var(--primary))] dark:text-violet-400",
    bg: "bg-[hsl(var(--primary)/0.10)]",
    border: "border-[hsl(var(--primary)/0.20)]",
    tags: ["Machine Learning", "Anomaly Detection", "Manutenção Preditiva"],
    beneficios: [
      "Redução de paradas não planejadas em ~40%",
      "Manutenção baseada em condição real",
      "Alertas antecipados com 24-72h de aviso",
      "Relatório de vida útil de componentes",
    ],
  },
  {
    id: "mobile",
    titulo: "Aplicativo Mobile Nativo",
    descricao: "App iOS e Android com câmera, scanner de QR Code e notificações push",
    detalhe: "App React Native com suporte offline completo. Operadores escaneiam QR Code da máquina/lote para iniciar apontamento. Fotos de defeitos capturadas diretamente pelo app. Supervisores recebem alertas de paradas e desvios em push notification.",
    status: "planejado",
    previsao: "Q1 2026",
    icon: Smartphone,
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    tags: ["React Native", "iOS", "Android", "QR Code", "Push Notification"],
    beneficios: [
      "Apontamento via QR Code em segundos",
      "Foto de defeitos direto no celular",
      "Push notifications para supervisores",
      "Funciona offline na fábrica",
    ],
  },
  {
    id: "bi",
    titulo: "Dashboard BI Avançado",
    descricao: "Business Intelligence com drill-down, KPIs personalizados e comparativos",
    detalhe: "Integração com Power BI embedded ou Metabase para dashboards gerenciais avançados. Drill-down por máquina, produto, turno e operador. Análise de tendências, benchmarking entre linhas e previsão de produção baseada em dados históricos.",
    status: "em_desenvolvimento",
    previsao: "Q2 2025",
    icon: BarChart3,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    tags: ["Power BI", "Metabase", "Drill-down", "KPI"],
    beneficios: [
      "Análise comparativa entre períodos",
      "KPIs customizados por gerência",
      "Exportação automática de relatórios",
      "Previsão de metas com base em histórico",
    ],
  },
  {
    id: "alertas",
    titulo: "Alertas Automáticos Inteligentes",
    descricao: "Notificações por WhatsApp, e-mail e SMS para eventos críticos",
    detalhe: "Sistema de regras configuráveis que dispara alertas quando OEE cai abaixo de threshold, máquina para por mais de X minutos, refugo ultrapassa índice definido ou estoque de MP atinge mínimo. Integração com WhatsApp Business API, e-mail SMTP e SMS.",
    status: "em_desenvolvimento",
    previsao: "Q2 2025",
    icon: Bell,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    tags: ["WhatsApp API", "Email", "SMS", "Regras configuráveis"],
    beneficios: [
      "Alerta imediato de paradas críticas",
      "Notificação quando OEE cai abaixo do limite",
      "Aviso de estoque mínimo de MP",
      "Escalada automática para supervisão",
    ],
  },
];

// ── Card Roadmap ──────────────────────────────────────────────────────────────

function RoadmapCard({ item }: { item: ItemRoadmap }) {
  const [expandido, setExpandido] = useState(false);
  const sc = STATUS_ROADMAP[item.status];

  return (
    <div className={cn("rounded-xl border transition-all duration-200", item.bg, item.border)}>
      <button className="w-full p-4 text-left" onClick={() => setExpandido(v => !v)}>
        <div className="flex items-start gap-3">
          <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", item.bg)}>
            <item.icon className={cn("h-5 w-5", item.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={cn("font-semibold text-sm", item.color)}>{item.titulo}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.descricao}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium", sc.color, sc.bg)}>
                  <sc.icon className="h-2.5 w-2.5" />
                  {sc.label}
                </div>
                {item.previsao && (
                  <span className="text-[9px] text-muted-foreground">{item.previsao}</span>
                )}
              </div>
            </div>
          </div>
          <div className="shrink-0 mt-1">
            {expandido ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mt-3 ml-[52px]">
          {item.tags.map(tag => (
            <span key={tag} className={cn("text-[9px] font-medium px-2 py-0.5 rounded-full border", item.color, item.bg, item.border)}>
              {tag}
            </span>
          ))}
        </div>
      </button>

      {/* Expandido */}
      {expandido && (
        <div className="px-4 pb-4 ml-[52px] space-y-3 animate-in fade-in duration-150">
          <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-current/10 pt-3">
            {item.detalhe}
          </p>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Benefícios esperados</p>
            <div className="space-y-1.5">
              {item.beneficios.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ArrowRight className={cn("h-3 w-3 shrink-0 mt-0.5", item.color)} />
                  <p className="text-[11px] text-muted-foreground">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Indicador Offline ─────────────────────────────────────────────────────────

function StatusOffline() {
  const [online] = useState(navigator.onLine);

  return (
    <div className={cn(
      "rounded-xl border p-4 flex items-start gap-3",
      online ? "bg-green-500/5 border-green-500/20" : "bg-amber-500/5 border-amber-500/20"
    )}>
      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
        online ? "bg-green-500/10" : "bg-amber-500/10")}>
        {online ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-amber-500" />}
      </div>
      <div>
        <p className={cn("font-semibold text-sm", online ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400")}>
          {online ? "Online — Sincronizado" : "Modo Offline Ativo"}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
          {online
            ? "Todos os dados estão sincronizados com o servidor. Operação normal."
            : "Os dados registrados estão sendo salvos localmente. Serão sincronizados automaticamente ao reconectar."}
        </p>
        {!online && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[10px] text-amber-500 font-medium">3 registros aguardando sincronização</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function FuturasPanel() {
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");

  const filtered = ROADMAP.filter(r =>
    filtroStatus === "todos" || r.status === filtroStatus
  );

  const counts = {
    total: ROADMAP.length,
    em_desenvolvimento: ROADMAP.filter(r => r.status === "em_desenvolvimento").length,
    planejado: ROADMAP.filter(r => r.status === "planejado").length,
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="rounded-xl border bg-violet-500/5 border-[hsl(var(--primary)/0.20)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="font-semibold text-sm text-[hsl(var(--primary))] dark:text-violet-400">Roadmap Tecnológico</h2>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Expansão contínua do sistema industrial. As funcionalidades abaixo estão no pipeline de desenvolvimento,
          priorizadas por impacto operacional e demanda dos usuários.
        </p>
      </div>

      {/* Status atual de conexão */}
      <StatusOffline />

      {/* KPIs do roadmap */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total no Roadmap", value: counts.total, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
          { label: "Em Desenvolvimento", value: counts.em_desenvolvimento, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
          { label: "Planejados", value: counts.planejado, color: "text-muted-foreground", bg: "bg-muted/30", border: "border-border" },
        ].map(item => (
          <div key={item.label} className={cn("rounded-xl border p-3 text-center", item.bg, item.border)}>
            <p className={cn("text-2xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Filtro */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-xl overflow-x-auto">
        {[
          { key: "todos", label: "Todos" },
          { key: "em_desenvolvimento", label: "Em Desenvolvimento" },
          { key: "planejado", label: "Planejados" },
          { key: "beta", label: "Beta" },
          { key: "disponivel", label: "Disponíveis" },
        ].map(f => (
          <button key={f.key} onClick={() => setFiltroStatus(f.key)}
            className={cn("whitespace-nowrap text-xs font-medium py-2 px-3 rounded-lg transition-all",
              filtroStatus === f.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards do roadmap */}
      <div className="space-y-3">
        {filtered.map(item => (
          <RoadmapCard key={item.id} item={item} />
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum item nessa categoria</p>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="rounded-xl border bg-card/60 p-4 text-center space-y-1">
        <p className="text-xs font-medium">Tem uma sugestão de funcionalidade?</p>
        <p className="text-[11px] text-muted-foreground">
          Entre em contato com o time de TI ou use o canal de sugestões no sistema.
        </p>
      </div>
    </div>
  );
}
