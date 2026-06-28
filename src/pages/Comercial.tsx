/**
 * Comercial — Página exclusiva para vendedoras (e admins)
 *
 * Rota: /comercial
 * Acesso: role === "comercial" | "admin"
 *
 * Fluxo:
 *  1. Vendedora seleciona ou cadastra cliente
 *  2. Visualiza peças disponíveis na expedição
 *  3. Cria pedido (nome do cliente + lote + quantidade)
 *  4. Peças ficam reservadas no estoque
 *  5. Admin/Estoque fatura o pedido → peças saem da expedição
 */

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CardSkeleton } from "@/components/PageSkeleton";
import { useStock, fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement } from "@/hooks/useStock";
import { useClickOutside } from "@/hooks/useClickOutside";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ShoppingBag,
  UserPlus,
  User,
  Search,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  PackageCheck,
  Clock,
  Package,
  Tag,
  ChevronDown,
  ChevronUp,
  FileText,
  Phone,
  Mail,
  MapPin,
  ShoppingCart,
  Ban,
  Truck,
  Boxes,
  LayoutDashboard,
  History,
  Trophy,
  TrendingUp,
  Download,
  Bell,
  Copy,
  MessageSquare,
  Send,
  RotateCcw,
  Pencil,
  FileDown,
  Loader2,
} from "lucide-react";
import { PageNav } from "@/components/PageNav";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Logo } from "@/components/Logo";

import { loteValido, displayLote } from "@/lib/lote";
import { TabelaPrecos } from "@/components/TabelaPrecos";
import { escHtml } from "@/lib/escHtml";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import type { Cliente, PedidoCompleto } from "@/types/comercial";
import { logAudit } from "@/types/comercial";

// ─── Modais extraídos — lazy-loaded para reduzir o bundle inicial da página ────
// (ver src/components/comercial/). Cada um só baixa quando de fato abre.
const ClienteModal           = lazy(() => import("@/components/comercial/ClienteModal").then(m => ({ default: m.ClienteModal })));
const NovoPedidoModal        = lazy(() => import("@/components/comercial/NovoPedidoModal").then(m => ({ default: m.NovoPedidoModal })));
const AdicionarPecaModal     = lazy(() => import("@/components/comercial/AdicionarPecaModal").then(m => ({ default: m.AdicionarPecaModal })));
const FaturarModal           = lazy(() => import("@/components/comercial/FaturarModal").then(m => ({ default: m.FaturarModal })));
const HistoricoClienteModal  = lazy(() => import("@/components/comercial/HistoricoClienteModal").then(m => ({ default: m.HistoricoClienteModal })));
const ComentariosModal       = lazy(() => import("@/components/comercial/ComentariosModal").then(m => ({ default: m.ComentariosModal })));
const HistoricoGeralModal    = lazy(() => import("@/components/comercial/HistoricoGeralModal").then(m => ({ default: m.HistoricoGeralModal })));



// ─── Botão Reenviar Pedido Retornado ──────────────────────────────────────────

function ReenviarPedidoRetornadoBtn({ pedidoId, onComentar, onReenviar }: { pedidoId: string; onComentar: () => void; onReenviar: () => void }) {
  async function handleReenviar() {
    onReenviar(); // otimista — atualiza UI na hora
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ status: "pendente", observacoes: null })
      .eq("id", pedidoId);
    if (error) toast.error("Erro ao reenviar pedido.");
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onComentar}
        className="h-9 px-3 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 border border-orange-500/30 transition-colors shrink-0"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        Ver motivo
      </button>
      <button
        type="button"
        onClick={handleReenviar}
        className="flex-1 h-9 rounded-xl bg-orange-500 hover:bg-orange-400 active:scale-95 text-white text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 min-w-0"
      >
        <Send className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Reenviar ao Estoque</span>
      </button>
    </div>
  );
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: PedidoCompleto;
  isAdmin: boolean;
  canConfirm?: boolean;
  clientes: Cliente[];
  onFaturar: (p: PedidoCompleto) => void;
  onCancelar: (p: PedidoCompleto) => void;
  onAdicionarPeca: (p: PedidoCompleto) => void;
  onDuplicar: (p: PedidoCompleto) => void;
  onComentar: (p: PedidoCompleto) => void;
  onReenviar: (p: PedidoCompleto) => void;
  onRemoverItemComercial: (pedido: PedidoCompleto, item: PedidoCompleto["itens"][0]) => void;
  onEditarPedido: (p: PedidoCompleto) => void;
}

function PedidoCard({ pedido, isAdmin, canConfirm, clientes, onFaturar, onCancelar, onAdicionarPeca, onDuplicar, onComentar, onReenviar, onRemoverItemComercial, onEditarPedido }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const temDesconto = pedido.desconto_pct > 0;

  const dtCriacao = new Date(pedido.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
  const hrCriacao = new Date(pedido.created_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit",
  });
  const prazoFmt = pedido.prazo_entrega
    ? new Date(pedido.prazo_entrega + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : null;
  const prazoAtrasado = pedido.prazo_entrega && !(["cancelado","enviado","faturado"] as string[]).includes(pedido.status)
    && new Date(pedido.prazo_entrega) < new Date();

  // FIX: forma_pagamento/parcelas não fazem parte do tipo PedidoCompleto
  // (usado só na listagem) — busca sob demanda, só quando o usuário pede o PDF.
  async function handleGerarPdf() {
    if (gerandoPdf) return;
    setGerandoPdf(true);
    try {
      const { data } = await supabase
        .from("pedidos_comerciais")
        .select("forma_pagamento, parcelas")
        .eq("id", pedido.id)
        .maybeSingle();
      const d = data as { forma_pagamento?: string | null; parcelas?: number | null } | null;
      const cliente = clientes.find(c => c.id === pedido.cliente_id) ?? null;
      const { baixarPdfPedido } = await import("@/lib/pedidoPdf");
      await baixarPdfPedido(pedido, cliente, {
        titulo: pedido.status === "pendente" ? "Orçamento" : "Pedido",
        formaPagamento: d?.forma_pagamento ?? null,
        parcelas: d?.parcelas ?? null,
      });
    } catch {
      toast.error("Erro ao gerar PDF.");
    } finally {
      setGerandoPdf(false);
    }
  }

  // ── Paleta de status ──────────────────────────────────────────────────────
  const STATUS: Record<string, {
    accent: string;        // cor da barra lateral e badge
    badgeBg: string;       // fundo do badge
    badgeText: string;     // texto do badge
    badgeBorder: string;   // borda do badge
    label: string;
    icon: React.ReactNode;
    statusBtnBg: string;   // fundo do botão de estado
    statusBtnText: string;
    statusBtnBorder: string;
  }> = {
    pendente:  {
      accent: "#f59e0b",
      badgeBg: "bg-amber-50 dark:bg-amber-950/50",
      badgeText: "text-amber-700 dark:text-amber-300",
      badgeBorder: "border-amber-300 dark:border-amber-700",
      label: "Pendente",
      icon: <Clock className="h-3 w-3" />,
      statusBtnBg: "bg-amber-50 dark:bg-amber-950/30",
      statusBtnText: "text-amber-700 dark:text-amber-300",
      statusBtnBorder: "border-amber-200 dark:border-amber-800",
    },
    separando: {
      accent: "#3b82f6",
      badgeBg: "bg-blue-50 dark:bg-blue-950/50",
      badgeText: "text-blue-700 dark:text-blue-300",
      badgeBorder: "border-blue-300 dark:border-blue-700",
      label: "Separando",
      icon: <PackageCheck className="h-3 w-3" />,
      statusBtnBg: "bg-blue-50 dark:bg-blue-950/30",
      statusBtnText: "text-blue-700 dark:text-blue-300",
      statusBtnBorder: "border-blue-200 dark:border-blue-800",
    },
    pronto: {
      accent: "#10b981",
      badgeBg: "bg-emerald-50 dark:bg-emerald-950/50",
      badgeText: "text-emerald-700 dark:text-emerald-300",
      badgeBorder: "border-emerald-300 dark:border-emerald-700",
      label: "Pronto",
      icon: <CheckCircle2 className="h-3 w-3" />,
      statusBtnBg: "bg-emerald-50 dark:bg-emerald-950/30",
      statusBtnText: "text-emerald-700 dark:text-emerald-300",
      statusBtnBorder: "border-emerald-200 dark:border-emerald-800",
    },
    faturado: {
      accent: "#7c3aed",
      badgeBg: "bg-violet-50 dark:bg-violet-950/50",
      badgeText: "text-violet-700 dark:text-violet-300",
      badgeBorder: "border-violet-300 dark:border-violet-700",
      label: "Faturado",
      icon: <CheckCircle2 className="h-3 w-3" />,
      statusBtnBg: "bg-violet-50 dark:bg-violet-950/30",
      statusBtnText: "text-violet-700 dark:text-violet-300",
      statusBtnBorder: "border-violet-200 dark:border-violet-800",
    },
    enviado: {
      accent: "#14b8a6",
      badgeBg: "bg-teal-50 dark:bg-teal-950/50",
      badgeText: "text-teal-700 dark:text-teal-300",
      badgeBorder: "border-teal-300 dark:border-teal-700",
      label: "Enviado",
      icon: <Truck className="h-3 w-3" />,
      statusBtnBg: "bg-teal-50 dark:bg-teal-950/30",
      statusBtnText: "text-teal-700 dark:text-teal-300",
      statusBtnBorder: "border-teal-200 dark:border-teal-800",
    },
    cancelado: {
      accent: "#94a3b8",
      badgeBg: "bg-muted/40",
      badgeText: "text-muted-foreground",
      badgeBorder: "border-border",
      label: "Cancelado",
      icon: <Ban className="h-3 w-3" />,
      statusBtnBg: "bg-muted/30",
      statusBtnText: "text-muted-foreground",
      statusBtnBorder: "border-border",
    },
    retorno: {
      accent: "#f97316",
      badgeBg: "bg-orange-50 dark:bg-orange-950/50",
      badgeText: "text-orange-700 dark:text-orange-300",
      badgeBorder: "border-orange-300 dark:border-orange-700",
      label: "Retorno",
      icon: <RotateCcw className="h-3 w-3" />,
      statusBtnBg: "bg-orange-50 dark:bg-orange-950/30",
      statusBtnText: "text-orange-700 dark:text-orange-300",
      statusBtnBorder: "border-orange-200 dark:border-orange-800",
    },
  };

  const s = STATUS[pedido.status] ?? STATUS["cancelado"];

  return (
    <div
      className="rounded-2xl bg-card overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
      style={{
        border: "1px solid hsl(var(--border) / 0.5)",
        boxShadow: "0 1px 3px hsl(var(--border) / 0.2), 0 6px 16px -4px hsl(var(--border) / 0.12)",
      }}
    >
      {/* Barra lateral colorida por status */}
      <div className="flex">
        <div className="w-1 shrink-0 rounded-l-2xl" style={{ background: s.accent }} />

        <div className="flex-1 min-w-0 p-4 space-y-3">

          {/* ── Linha 1: Avatar cliente + nome + badge status ── */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Avatar com inicial */}
              <div
                className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-white text-[13px] font-black"
                style={{ background: `linear-gradient(135deg, ${s.accent}cc, ${s.accent})` }}
              >
                {pedido.cliente_nome.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-[14px] font-bold text-foreground leading-tight truncate">
                  {pedido.cliente_nome}
                </h3>
                {pedido.vendedora_nome && (
                  <p className="text-[10px] text-muted-foreground/70 leading-tight truncate">
                    por {pedido.vendedora_nome}
                  </p>
                )}
              </div>
            </div>

            {/* Badge status */}
            <span className={cn(
              "shrink-0 flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border",
              s.badgeBg, s.badgeText, s.badgeBorder
            )}>
              {s.icon}
              {s.label}
            </span>
          </div>

          {/* ── Linha 2: Métricas (peças + desconto + data) ── */}
          <div className="flex items-center gap-2">
            {/* Qtd de peças */}
            <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2 bg-muted/25 border border-border/50">
              <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                  {pedido.itens.length} tipo{pedido.itens.length !== 1 ? "s" : ""}
                </p>
                <p className="text-[16px] font-black text-foreground leading-none tabular-nums">
                  {totalItens}
                  <span className="text-[10px] font-semibold text-muted-foreground ml-1">un.</span>
                </p>
              </div>
            </div>

            {/* Desconto — destaque se tiver */}
            {temDesconto ? (
              <div className="flex flex-col items-center justify-center rounded-xl px-3 py-2 border min-w-[54px]"
                style={{
                  background: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
                  borderColor: "#6ee7b7",
                }}>
                <span className="text-[17px] font-black text-emerald-800 leading-none tabular-nums">
                  {pedido.desconto_pct}%
                </span>
                <span className="text-[8px] font-bold text-emerald-700 uppercase tracking-widest leading-none mt-0.5">
                  desc.
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl px-3 py-2 bg-muted/20 border border-border/40 min-w-[54px]">
                <span className="text-[10px] font-medium text-muted-foreground/50">Sem desc.</span>
              </div>
            )}
            {/* Frete */}
            {(pedido.frete ?? 0) > 0 && (
              <div className="flex flex-col items-center justify-center rounded-xl px-2 py-2 border border-violet-500/25 min-w-[50px]"
                style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)", borderColor: "#c4b5fd" }}>
                <Truck className="h-3 w-3 text-violet-600 mb-0.5" />
                <span className="text-[9px] font-bold text-violet-700 leading-none">
                  R$ {(pedido.frete).toFixed(0)}
                </span>
              </div>
            )}
          </div>

          {/* ── Linha 3: Data/hora ── */}
          <div className="flex items-center gap-1.5">
            <Clock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
            <span className="text-[10px] text-muted-foreground/60">
              {dtCriacao} às {hrCriacao}
            </span>
            {prazoFmt && (
              <span className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded-md border",
                prazoAtrasado
                  ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                  : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
              )}>
                prazo: {prazoFmt}
              </span>
            )}
          </div>

          {/* ── Itens expandidos ── */}
          {expanded && (
            <div className="space-y-1.5 pt-1 border-t border-border/40">
              {pedido.itens.map((it, idx) => (
                <div key={it.id}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 bg-muted/20 border border-border/40 group"
                >
                  <div
                    className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0 text-[9px] font-black text-white"
                    style={{ background: s.accent + "cc" }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-foreground truncate leading-tight">
                      {it.device_model}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {displayLote(it.lote) && (
                        <span className="text-[9px] font-mono text-muted-foreground/60 bg-muted/40 rounded px-1">
                          {displayLote(it.lote)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right flex items-center gap-2">
                    <div>
                      <span className="text-[13px] font-black tabular-nums" style={{ color: s.accent }}>
                        {it.quantidade}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-0.5">un.</span>
                    </div>
                    {pedido.status === "pendente" && (
                      <button
                        type="button"
                        onClick={() => {
                          if (pedido.itens.length <= 1) { toast.error("O pedido precisa ter ao menos 1 peça."); return; }
                          onRemoverItemComercial(pedido, it);
                        }}
                        className="h-6 w-6 flex items-center justify-center rounded-lg bg-destructive/10 hover:bg-destructive/25 text-destructive/60 hover:text-destructive transition-colors shrink-0"
                        title="Remover peça"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {pedido.observacoes && (
                <div className="flex items-start gap-2 px-2 pt-1 pb-0.5">
                  <FileText className="h-3 w-3 mt-0.5 text-muted-foreground/50 shrink-0" />
                  <span className="text-[11px] text-muted-foreground/80 italic leading-relaxed">
                    {pedido.observacoes}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Botão expandir ── */}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded-xl text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 transition-colors border border-border/40"
          >
            {expanded
              ? <><ChevronUp className="h-3 w-3" />Ocultar peças</>
              : <><ChevronDown className="h-3 w-3" />Ver {pedido.itens.length} peça{pedido.itens.length !== 1 ? "s" : ""}</>}
          </button>

          {/* ── Ações rápidas: comentar, gerar PDF e duplicar ── */}
          <div className="flex gap-2">
            {pedido.status === "pendente" && (
              <button type="button" onClick={() => onComentar(pedido)}
                className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-medium text-muted-foreground hover:bg-muted/40 border border-border/40 transition-colors">
                <MessageSquare className="h-3 w-3" /> Comentários
              </button>
            )}
            <button type="button" onClick={handleGerarPdf} disabled={gerandoPdf}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-medium text-muted-foreground hover:bg-muted/40 border border-border/40 transition-colors disabled:opacity-50">
              {gerandoPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
              {pedido.status === "pendente" ? "Orçamento" : "PDF"}
            </button>
            <button type="button" onClick={() => onDuplicar(pedido)}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-medium text-muted-foreground hover:bg-muted/40 border border-border/40 transition-colors">
              <Copy className="h-3 w-3" /> Duplicar
            </button>
          </div>

          {/* ── Botão adicionar peça (só pendente) ── */}
          {pedido.status === "pendente" && (
            <button
              type="button"
              onClick={() => onAdicionarPeca(pedido)}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-semibold transition-colors"
              style={{
                background: "#ede9fe",
                color: "#6d28d9",
                border: "1px solid #c4b5fd",
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar peça
            </button>
          )}

          {/* ── Ações Admin (confirmar / cancelar) ── */}
          {pedido.status === "pendente" && (isAdmin || canConfirm) && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onFaturar(pedido)}
                className="flex-1 h-9 rounded-xl text-white text-[12px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  boxShadow: "0 2px 8px rgba(124,58,237,0.35)",
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar Pedido
              </button>
              <button
                type="button"
                onClick={() => onCancelar(pedido)}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-500 transition-colors border border-border"
                title="Cancelar pedido"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* ── Indicadores de estado (sem ação) ── */}
          {(["separando","pronto","faturado","enviado","cancelado","retorno"] as const).includes(
            pedido.status as "separando"|"pronto"|"faturado"|"enviado"|"cancelado"|"retorno"
          ) && (
            <div className={cn(
              "flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-bold border",
              s.statusBtnBg, s.statusBtnText, s.statusBtnBorder
            )}>
              {pedido.status === "separando" && <><PackageCheck className="h-3.5 w-3.5" />Estoque sendo separado...</>}
              {pedido.status === "pronto"    && <><CheckCircle2 className="h-3.5 w-3.5" />Pronto — aguardando NF</>}
              {pedido.status === "faturado"  && <><CheckCircle2 className="h-3.5 w-3.5" />Nota fiscal emitida</>}
              {pedido.status === "enviado"   && <><Truck className="h-3.5 w-3.5" />Enviado ao cliente! 🎉</>}
              {pedido.status === "cancelado" && <><Ban className="h-3.5 w-3.5" />Pedido cancelado</>}
              {pedido.status === "retorno"   && <><RotateCcw className="h-3.5 w-3.5" />Retornado pelo estoque — revise</>}
            </div>
          )}

          {/* Editar pedido em retorno */}
          {pedido.status === "retorno" && (
            <button
              type="button"
              onClick={() => onEditarPedido(pedido)}
              className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl text-[12px] font-semibold transition-colors border border-orange-500/40 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" /> Editar Pedido
            </button>
          )}

          {/* Botão reenviar pedido retornado */}
          {pedido.status === "retorno" && (
            <ReenviarPedidoRetornadoBtn pedidoId={pedido.id} onComentar={() => onComentar(pedido)} onReenviar={() => onReenviar(pedido)} />
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Card de Cliente ──────────────────────────────────────────────────────────

interface ClienteCardProps {
  cliente: Cliente;
  isAdmin: boolean;
  onPedido: (c: Cliente) => void;
  onEditar: (c: Cliente) => void;
  onExcluir: (c: Cliente) => void;
  onHistorico?: (c: Cliente) => void;
}

function ClienteCard({ cliente: c, isAdmin, onPedido, onEditar, onExcluir, onHistorico }: ClienteCardProps) {
  return (
    <div className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5" style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-violet-500 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold truncate">{c.nome}</h3>
            {c.documento && <p className="text-[11px] text-muted-foreground/70 font-mono">{c.documento}</p>}
          </div>
          <div className="h-8 w-8 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-violet-500" />
          </div>
        </div>
        <div className="space-y-1">
          {c.telefone && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"><Phone className="h-3 w-3" /><span>{c.telefone}</span></div>}
          {c.email && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"><Mail className="h-3 w-3" /><span className="truncate">{c.email}</span></div>}
          {c.endereco && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{c.endereco}</span></div>}
        </div>
        <div className="flex gap-1.5 pt-1 border-t border-border/20">
          <button type="button" onClick={() => onPedido(c)} className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-[10px] font-medium transition-colors">
            <ShoppingCart className="h-3 w-3" /> Pedido
          </button>
          <button type="button" onClick={() => onHistorico && onHistorico(c)} className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground transition-colors" title="Histórico de compras">
            <History className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => onEditar(c)} className="h-7 flex items-center justify-center px-2 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors">
            Editar
          </button>
          {isAdmin && (
            <button type="button" onClick={() => onExcluir(c)} className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Notificações Bell ───────────────────────────────────────────────────────

function NotificacoesBell({ userId }: { userId: string }) {
  const [notifs, setNotifs] = useState<{ id: string; titulo: string; mensagem: string | null; lida: boolean; created_at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notificacoes")
      .select("id, titulo, mensagem, lida, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifs((data as typeof notifs) ?? []);
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [load, userId]);

  // Realtime subscription — recebe notificação instantaneamente e mostra toast
  useEffect(() => {
    const channel = supabase
      .channel(`notif-${userId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notificacoes",
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        const row = payload.new as { titulo?: string; mensagem?: string | null };
        load();
        toast(row.titulo ?? "Nova notificação", {
          description: row.mensagem ?? undefined,
          duration: 5000,
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  // FIX: useClickOutside substitui document.addEventListener duplicado
  useClickOutside(ref, () => setOpen(false));

  async function marcarLidas() {
    const ids = notifs.filter(n => !n.lida).map(n => n.id);
    if (ids.length === 0) return;
    await supabase.from("notificacoes").update({ lida: true }).in("id", ids);
    setNotifs(prev => prev.map(n => ({ ...n, lida: true })));
  }

  const naoLidas = notifs.filter(n => !n.lida).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); if (!open) marcarLidas(); }}
        className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
      >
        <Bell className="h-4 w-4" />
        {naoLidas > 0 && (
          <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-violet-500 border-2 border-background" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-2xl border border-border bg-card shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <span className="text-[12px] font-semibold">Notificações</span>
            {naoLidas > 0 && <span className="text-[10px] text-violet-500">{naoLidas} nova{naoLidas > 1 ? "s" : ""}</span>}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-border/20">
            {notifs.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">Nenhuma notificação</div>
            ) : notifs.map(n => (
              <div key={n.id} className={cn("px-4 py-3 transition-colors", n.lida ? "" : "bg-violet-500/5")}>
                <div className="flex items-start gap-2">
                  {!n.lida && <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold">{n.titulo}</p>
                    {n.mensagem && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.mensagem}</p>}
                    <p className="text-[10px] text-muted-foreground/50 mt-1">{new Date(n.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard Comercial ──────────────────────────────────────────────────────

interface DashboardComercialProps {
  pedidos: PedidoCompleto[];
  loading: boolean;
  currentUserName: string | null;
  isAdmin: boolean;
}

function DashboardComercial({ pedidos, loading, currentUserName, isAdmin }: DashboardComercialProps) {
  // Pedidos "confirmados" = qualquer status além de pendente e cancelado
  const CONFIRMADOS: PedidoCompleto["status"][] = ["separando", "pronto", "faturado", "enviado"];
  const confirmados = pedidos.filter(p => CONFIRMADOS.includes(p.status));

  // Para vendedoras: filtra apenas os próprios pedidos; admin vê todos
  const meusPedidos = isAdmin ? confirmados : confirmados.filter(p => p.vendedora_nome === currentUserName);

  const totalPedidosConfirmados = meusPedidos.length;
  const totalPecasConfirmadas = meusPedidos.reduce((sum, p) => sum + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);

  // Ranking vendedoras — admin vê todos; vendedora só vê a si mesma (não faz sentido mostrar ranking)
  const rankingVendedoras: Record<string, number> = {};
  for (const p of confirmados) {
    const nome = p.vendedora_nome ?? "—";
    rankingVendedoras[nome] = (rankingVendedoras[nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingVendList = Object.entries(rankingVendedoras)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Ranking clientes — vendedora vê só os seus clientes; admin vê todos
  const pedidosParaRankingClientes = isAdmin ? confirmados : confirmados.filter(p => p.vendedora_nome === currentUserName);
  const rankingClientes: Record<string, number> = {};
  for (const p of pedidosParaRankingClientes) {
    rankingClientes[p.cliente_nome] = (rankingClientes[p.cliente_nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingClientesList = Object.entries(rankingClientes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // PDF da vendedora atual
  function downloadPdfVendedora() {
    const meusPdfPedidos = isAdmin
      ? confirmados.filter(p => p.vendedora_nome === currentUserName)
      : meusPedidos;
    if (meusPdfPedidos.length === 0) { toast.error("Nenhum pedido confirmado seu encontrado."); return; }

    // Agrupa por modelo de peça (device_model) — mais robusto que stock_item_id
    // pois pedidos faturados podem ter itens sem join de stock_items
    const pecas: Record<string, { model: string; ref: string; total: number }> = {};
    for (const p of meusPdfPedidos) {
      for (const i of p.itens) {
        const model = i.device_model?.trim() || "—";
        const ref   = i.device_reference?.trim() || "—";
        const key   = `${model}||${ref}`;
        if (!pecas[key]) pecas[key] = { model, ref, total: 0 };
        pecas[key].total += (i.quantidade ?? 0);
      }
    }
    const pecasList = Object.values(pecas)
      .filter(p => p.model !== "—" || p.total > 0)
      .sort((a, b) => b.total - a.total);

    // XSS: escape all user-supplied values before injecting into HTML blob
    const esc = escHtml;

    // Monta HTML para impressão
    const html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Relatório de Pedidos — ${esc(currentUserName ?? "")}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p.sub { font-size: 12px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 10px; background: #f3f0ff; color: #5b21b6; border-bottom: 2px solid #ddd6fe; }
        td { padding: 7px 10px; border-bottom: 1px solid #eee; }
        tr:last-child td { border-bottom: none; }
        .total { font-weight: bold; font-size: 15px; color: #5b21b6; }
        .footer { margin-top: 20px; font-size: 11px; color: #999; }
      </style></head><body>
      <h1>📋 Relatório de Pedidos</h1>
      <p class="sub">Vendedora: <strong>${esc(currentUserName ?? "")}</strong> &nbsp;·&nbsp; Gerado em: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      ${pecasList.length > 0 ? `
      <table>
        <thead><tr><th>#</th><th>Peça</th><th>Referência</th><th>Qtd. Vendida</th></tr></thead>
        <tbody>
          ${pecasList.map((p, idx2) => `<tr><td>${idx2 + 1}</td><td>${esc(p.model)}</td><td>${esc(p.ref)}</td><td class="total">${p.total}</td></tr>`).join("")}
        </tbody>
      </table>` : `<p style="color:#888;font-size:13px">Detalhes das peças não disponíveis para este período.</p>`}
      <h2 style="font-size:14px;margin:20px 0 8px;color:#5b21b6">Pedidos</h2>
      <table>
        <thead><tr><th>#</th><th>Cliente</th><th>Status</th><th>Data</th><th>Peças</th></tr></thead>
        <tbody>
          ${meusPdfPedidos.map((p, idx2) => `<tr><td>${idx2 + 1}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.status)}</td><td>${new Date(p.created_at).toLocaleDateString("pt-BR")}</td><td>${p.itens.reduce((s,i) => s + i.quantidade, 0)}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="footer">Total de ${meusPdfPedidos.length} pedido(s) confirmado(s) &nbsp;·&nbsp; ${pecasList.reduce((s, p) => s + p.total, 0)} peças no total</p>
      </body></html>
    `;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      toast.error("Popup bloqueado. Permita popups para imprimir.");
      return;
    }
    w.addEventListener("load", () => {
      w.print();
      URL.revokeObjectURL(url);
    }, { once: true });
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border bg-muted/20 p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  const maxVend = rankingVendList[0]?.[1] ?? 1;
  const maxCli = rankingClientesList[0]?.[1] ?? 1;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Pedidos Efetuados</p>
            <p className="text-2xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{totalPedidosConfirmados.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">confirmados pela vendedora</p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Boxes className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Total de Peças</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{totalPecasConfirmadas.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">nos pedidos confirmados</p>
          </div>
        </div>
      </div>

      {/* Ranking Vendedoras — só admin vê */}
      {isAdmin && (
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold">Ranking de Vendedoras</p>
          <span className="text-[11px] text-muted-foreground/60">(peças em pedidos confirmados)</span>
        </div>
        {rankingVendList.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground/60">Nenhum dado disponível</div>
        ) : (
          <div className="divide-y divide-border/20">
            {rankingVendList.map(([nome, total], idx) => (
              <div key={nome} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  idx === 0 ? "bg-amber-400/20 text-amber-600" :
                  idx === 1 ? "bg-slate-300/20 text-slate-500" :
                  idx === 2 ? "bg-orange-300/20 text-orange-600" :
                  "bg-muted/40 text-muted-foreground"
                )}>{idx + 1}º</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium truncate">{nome}</span>
                    <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{total} un.</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all"
                      style={{ width: `${Math.round((total / maxVend) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Ranking Clientes */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">Clientes que Mais Compraram</p>
          <span className="text-[11px] text-muted-foreground/60">(peças em pedidos confirmados)</span>
        </div>
        {rankingClientesList.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground/60">Nenhum dado disponível</div>
        ) : (
          <div className="divide-y divide-border/20">
            {rankingClientesList.map(([nome, total], idx) => (
              <div key={nome} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  idx === 0 ? "bg-violet-500/20 text-violet-600" : "bg-muted/40 text-muted-foreground"
                )}>{idx + 1}º</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium truncate">{nome}</span>
                    <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{total} un.</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-300 transition-all"
                      style={{ width: `${Math.round((total / maxCli) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Botão PDF da vendedora */}
      <button
        type="button"
        onClick={downloadPdfVendedora}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-violet-500/30 text-violet-600 dark:text-violet-400 text-sm font-medium hover:bg-violet-500/10 transition-colors"
      >
        <Download className="h-4 w-4" />
        Baixar meu relatório em PDF
      </button>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function Comercial() {
  const navigate = useNavigate();
  const { signOut, isAdmin, role, user } = useAuth();

  const isVendedora = role === "comercial";
  const canAccess = isAdmin || isVendedora;

  // Nome da usuária logada
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const userEmail = user?.email ?? null;
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCurrentUserName((data as { display_name?: string } | null)?.display_name ?? userEmail));
  }, [user?.id, userEmail]);

  // Tema

  // Sub-tabs
  type SubTab = "dashboard" | "pedidos" | "clientes" | "historico" | "precos";
  const [subTab, setSubTab] = useState<SubTab>("pedidos");
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // Peças da expedição (para criar pedidos)
  const { items: allItems, loading: loadingStock, refetch: refetchStock } = useStock("");
  const expedicaoItems = allItems.filter(i => i.fase === "expedicao");
  // allStockItems: todas as peças com estoque disponível (qualquer fase) para busca no modal
  const allStockItems = allItems.filter(i => i.quantity_available > 0);

  // Pedidos
  const [pedidos, setPedidos] = useState<PedidoCompleto[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "pendente" | "pronto" | "enviado" | "retorno" | "cancelado">("todos");
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [faturarPedido, setFaturarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<PedidoCompleto | null>(null);
  const [adicionarPecaPedido, setAdicionarPecaPedido] = useState<PedidoCompleto | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [pedidoComCliente, setPedidoComCliente] = useState<Cliente | null>(null);

  // Clientes
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clienteSearchFilter, setClienteSearchFilter] = useState(""); // só atualiza em debounce
  const clienteSearchRef = useRef<HTMLInputElement>(null);
  const clienteSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadPedidosAbortRef = useRef<AbortController | null>(null);
  const [clienteModal, setClienteModal] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [deleteCliente, setDeleteCliente] = useState<Cliente | null>(null);
  const [deletingCliente, setDeletingCliente] = useState(false);
  const [historicoClienteId, setHistoricoClienteId] = useState<string | null>(null);
  const [comentarioPedidoId, setComentarioPedidoId] = useState<string | null>(null);
  const [duplicandoPedido, setDuplicandoPedido] = useState<PedidoCompleto | null>(null);
  const [editarPedidoRetorno, setEditarPedidoRetorno] = useState<PedidoCompleto | null>(null);
  const [removerItemPendente, setRemoverItemPendente] = useState<{ pedido: PedidoCompleto; item: PedidoCompleto["itens"][0] } | null>(null);
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  function handleDuplicar(pedido: PedidoCompleto) {
    setDuplicandoPedido(pedido);
    setNovoPedidoOpen(true);
  }

  const loadPedidos = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    loadPedidosAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadPedidosAbortRef.current = ctrl;

    setLoadingPedidos(true);
    try {
      const { data: pedidosData } = await supabase
        .from("pedidos_comerciais")
        .select("*, frete, clientes(nome)")
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;
      if (!pedidosData) { setPedidos([]); return; }

      const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);
      const { data: itensData } = await supabase
        .from("pedido_itens")
        .select("*, stock_items(device_id, devices(model, reference))")
        .in("pedido_id", pedidoIds.length > 0 ? pedidoIds : ["none"])
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;

      const itensPorPedido = new Map<string, PedidoCompleto["itens"]>();
      for (const it of (itensData ?? []) as Record<string, unknown>[]) {
        const pid = it.pedido_id as string;
        if (!itensPorPedido.has(pid)) itensPorPedido.set(pid, []);
        const si = it.stock_items as Record<string, unknown> | null;
        const dev = si?.devices as Record<string, unknown> | null;
        itensPorPedido.get(pid)!.push({
          id: it.id as string,
          stock_item_id: it.stock_item_id as string,
          lote: it.lote as string,
          quantidade: it.quantidade as number,
          quantidade_reservada: it.quantidade_reservada as number,
          device_model: dev?.model as string | undefined,
          device_reference: dev?.reference as string | undefined,
          valor_unitario: (it.valor_unitario as number | null) ?? 0,
          device_id: si?.device_id as string | undefined,
        });
      }

      setPedidos(pedidosData.map((p: Record<string, unknown>) => {
        const c = p.clientes as Record<string, unknown> | null;
        return { id: p.id as string, cliente_id: p.cliente_id as string, cliente_nome: c?.nome as string ?? "—", vendedora_nome: p.vendedora_nome as string | null, status: p.status as PedidoCompleto["status"], observacoes: p.observacoes as string | null, desconto_pct: (p.desconto_pct as number) ?? 0, frete: (p.frete as number) ?? 0, prazo_entrega: (p.prazo_entrega as string | null) ?? null, created_at: p.created_at as string, faturado_em: p.faturado_em as string | null, itens: itensPorPedido.get(p.id as string) ?? [] };
      }));
    } catch (_e) {
      toast.error("Erro ao carregar pedidos.", {
        action: { label: "Tentar novamente", onClick: loadPedidos }
      });
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    try {
      const { data, error } = await supabase.from("clientes").select("*").order("nome");
      if (error) { toast.error("Erro ao carregar clientes.", {
        action: { label: "Tentar novamente", onClick: loadClientes }
      }); return; }
      setClientes((data as Cliente[]) ?? []);
    } catch (_e) {
      toast.error("Erro ao carregar clientes.", {
        action: { label: "Tentar novamente", onClick: loadClientes }
      });
      setClientes([]);
    } finally {
      setLoadingClientes(false);
    }
  }, []);

  useEffect(() => { loadPedidos(); loadClientes(); }, [loadPedidos, loadClientes]);

  // Realtime: recarrega pedidos automaticamente quando outro usuário muda um pedido
  // (estoque confirma separação, devolve retorno, etc.) — sem precisar deslogar/relogar
  useEffect(() => {
    const channel = supabase
      .channel(`comercial-pedidos-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_comerciais" },
        () => { loadPedidos(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPedidos]);

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    try {
      // Use atomic RPC — cancels pedido + releases all reservations in one transaction
      const { error } = await supabase.rpc("cancel_pedido", { p_pedido_id: cancelarPedido.id });
      if (error) { toast.error("Erro ao cancelar."); return; }
      await logAudit(user?.id, currentUserName, "cancel_pedido", "pedido_comercial", cancelarPedido.id, { cliente: cancelarPedido.cliente_nome });
      toast.success("Pedido cancelado.");
      setCancelarPedido(null);
      loadPedidos();
      refetchStock();
    } catch (_e) {
      toast.error("Erro inesperado ao cancelar pedido.");
    } finally {
      setCancelando(false);
    }
  }

  async function handleDeleteCliente() {
    if (!deleteCliente) return;
    setDeletingCliente(true);
    // Admin pode apagar mesmo com pedidos vinculados — cancela pedidos primeiro
    if (isAdmin) {
      await supabase.from("pedido_itens").delete().in(
        "pedido_id",
        (await supabase.from("pedidos_comerciais").select("id").eq("cliente_id", deleteCliente.id)).data?.map((p: Record<string, unknown>) => p.id as string) ?? []
      );
      await supabase.from("pedidos_comerciais").delete().eq("cliente_id", deleteCliente.id);
    }
    const { error } = await supabase.from("clientes").delete().eq("id", deleteCliente.id);
    setDeletingCliente(false);
    if (error) { toast.error("Não foi possível excluir o cliente."); return; }
    toast.success("Cliente excluído.");
    setDeleteCliente(null);
    loadClientes();
  }

  const pedidosFiltrados = useMemo(() => pedidos.filter(p => {
    if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
    if (filtroDataInicio && p.created_at < filtroDataInicio) return false;
    if (filtroDataFim && p.created_at > filtroDataFim + "T23:59:59") return false;
    return true;
  }), [pedidos, filtroStatus, filtroDataInicio, filtroDataFim]);
  const pedidosPendentes  = useMemo(() => pedidos.filter(p => p.status === "pendente").length, [pedidos]);
  const pedidosAtrasados  = useMemo(() => pedidos.filter(p =>
    p.prazo_entrega && !["cancelado","enviado","faturado"].includes(p.status) &&
    new Date(p.prazo_entrega) < new Date()
  ).length, [pedidos]);
  const clientesFiltrados = useMemo(() => clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearchFilter.toLowerCase()) ||
    (c.documento ?? "").includes(clienteSearchFilter) ||
    (c.telefone ?? "").includes(clienteSearchFilter)
  ), [clientes, clienteSearchFilter]);

  const COMERCIAL_TABS = [
    {
      id: "dashboard" as SubTab,
      label: "Dashboard",
      Icon: LayoutDashboard,
      activeColor: "text-primary",
      activeBg: "bg-primary/10",
      activeBorder: "border-primary/40",
      badgeBg: "bg-primary/15",
      badgeText: "text-primary",
    },
    {
      id: "pedidos" as SubTab,
      label: "Pedidos",
      Icon: ShoppingBag,
      badge: pedidosPendentes,
      activeColor: "text-amber-600 dark:text-amber-400",
      activeBg: "bg-amber-500/10",
      activeBorder: "border-amber-500/40",
      badgeBg: "bg-amber-500/15",
      badgeText: "text-amber-600 dark:text-amber-400",
    },
    {
      id: "clientes" as SubTab,
      label: "Clientes",
      Icon: User,
      activeColor: "text-violet-600 dark:text-violet-400",
      activeBg: "bg-violet-500/10",
      activeBorder: "border-violet-500/40",
      badgeBg: "bg-violet-500/15",
      badgeText: "text-violet-600 dark:text-violet-400",
    },
    {
      id: "historico" as SubTab,
      label: "Histórico",
      Icon: History,
      activeColor: "text-cyan-600 dark:text-cyan-400",
      activeBg: "bg-cyan-500/10",
      activeBorder: "border-cyan-500/40",
      badgeBg: "bg-cyan-500/15",
      badgeText: "text-cyan-600 dark:text-cyan-400",
    },
    {
      id: "precos" as SubTab,
      label: "Tabela de Preços",
      Icon: Tag,
      activeColor: "text-emerald-600 dark:text-emerald-400",
      activeBg: "bg-emerald-500/10",
      activeBorder: "border-emerald-500/40",
      badgeBg: "bg-emerald-500/15",
      badgeText: "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-violet-500" />
            <h1 className="text-sm font-semibold">Comercial</h1>
            {!loadingPedidos && pedidosPendentes > 0 && (
              <span className="flex items-center gap-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                <Clock className="h-2.5 w-2.5" />
                {pedidosPendentes}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {user && <NotificacoesBell userId={user.id} />}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto"><div className="px-3 sm:px-4 py-4 space-y-4">
        {!canAccess ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground/20" />
            <p className="text-muted-foreground font-medium">Acesso restrito</p>
            <p className="text-sm text-muted-foreground/60">Esta área é exclusiva para vendedoras e administradores.</p>
          </div>
        ) : (
          <>
            {/* Info */}
            <div className="rounded-xl border bg-violet-500/5 border-violet-500/20 text-violet-700 dark:text-violet-300 px-4 py-3 text-[12px]">
              Cadastre clientes, visualize peças disponíveis na expedição e crie pedidos de venda. O estoque fatura e as peças saem automaticamente.
            </div>

            {/* Nav harmonizada */}
            <PageNav
              tabs={COMERCIAL_TABS}
              activeTab={subTab}
              onTabChange={(tab) => {
                if (tab === "historico") { setHistoricoOpen(true); return; }
                setSubTab(tab);
              }}
              loading={loadingPedidos}
            />

            {/* ── Aba Dashboard ── */}
            {subTab === "dashboard" && (
              <DashboardComercial
                pedidos={pedidos}
                loading={loadingPedidos}
                currentUserName={currentUserName}
                isAdmin={isAdmin}
              />
            )}

            {/* ── Aba Pedidos ── */}
            {subTab === "pedidos" && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  {/* Linha 1: filtros de status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {(["todos","pendente","pronto","enviado","retorno","cancelado"] as const).map(s => (
                      <button key={s} type="button" onClick={() => setFiltroStatus(s)}
                        className={cn("h-7 px-3 rounded-full text-[11px] font-semibold border transition-colors",
                          filtroStatus === s ? "bg-violet-600 text-white border-violet-600" : "bg-background text-muted-foreground border-border/50 hover:border-violet-400")}>
                        {s === "todos" ? "Todos" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                  {/* Linha 2: filtros de data + botão novo pedido */}
                  <div className="flex items-center gap-1.5">
                    <input type="date" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)}
                      className="h-7 flex-1 min-w-0 rounded-lg border border-border/50 bg-background text-[11px] px-2 focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
                    <span className="text-[10px] text-muted-foreground shrink-0">até</span>
                    <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)}
                      className="h-7 flex-1 min-w-0 rounded-lg border border-border/50 bg-background text-[11px] px-2 focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
                    {(filtroDataInicio || filtroDataFim) && (
                      <button type="button" onClick={() => { setFiltroDataInicio(""); setFiltroDataFim(""); }}
                        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted/50 text-muted-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <Button size="sm" className="h-7 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 shrink-0 ml-auto" onClick={() => { setPedidoComCliente(null); setNovoPedidoOpen(true); }}>
                      <Plus className="h-3.5 w-3.5" /> Novo
                    </Button>
                  </div>
                </div>

                {loadingPedidos ? (
                  <div className="flex items-center justify-center py-16"><div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : pedidosFiltrados.length === 0 ? (
                  <div className="text-center py-16 space-y-2">
                    <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-muted-foreground font-medium">Nenhum pedido encontrado</p>
                    <button type="button" onClick={() => setNovoPedidoOpen(true)} className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors">
                      <Plus className="h-3.5 w-3.5" /> Criar primeiro pedido
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {pedidosFiltrados.map(p => (
                      <PedidoCard key={p.id} pedido={p} isAdmin={isAdmin} canConfirm={isAdmin || isVendedora} clientes={clientes} onFaturar={setFaturarPedido} onCancelar={setCancelarPedido} onAdicionarPeca={setAdicionarPecaPedido} onDuplicar={handleDuplicar} onComentar={p => setComentarioPedidoId(p.id)}
                        onReenviar={p => setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, status: "pendente" as const } : x))}
                        onRemoverItemComercial={(pedido, item) => setRemoverItemPendente({ pedido, item })}
                        onEditarPedido={p => setEditarPedidoRetorno(p)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Aba Clientes ── */}
            {subTab === "clientes" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      ref={clienteSearchRef}
                      type="text"
                      placeholder="Buscar cliente..."
                      defaultValue=""
                      onChange={e => {
                        if (clienteSearchDebounce.current) clearTimeout(clienteSearchDebounce.current);
                        const v = e.target.value;
                        clienteSearchDebounce.current = setTimeout(() => setClienteSearchFilter(v), 300);
                      }}
                      className="pl-9 pr-8 h-9 w-full text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    {clienteSearchFilter && (
                      <button type="button" onClick={() => { if (clienteSearchRef.current) clienteSearchRef.current.value = ""; setClienteSearchFilter(""); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Button size="sm" className="h-9 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 shrink-0" onClick={() => { setEditCliente(null); setClienteModal(true); }}>
                    <UserPlus className="h-3.5 w-3.5" /> Novo
                  </Button>
                </div>

                {loadingClientes ? (
                  <div className="flex items-center justify-center py-16"><div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : clientesFiltrados.length === 0 ? (
                  <div className="text-center py-16 space-y-2">
                    <User className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-muted-foreground font-medium">{clienteSearchFilter ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
                    {!clienteSearchFilter && (
                      <button type="button" onClick={() => { setEditCliente(null); setClienteModal(true); }} className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors">
                        <UserPlus className="h-3.5 w-3.5" /> Cadastrar primeiro cliente
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {clientesFiltrados.map(c => (
                      <ClienteCard
                        key={c.id}
                        cliente={c}
                        isAdmin={isAdmin}
                        onPedido={(cl) => { setPedidoComCliente(cl); setNovoPedidoOpen(true); setSubTab("pedidos"); }}
                        onEditar={(cl) => { setEditCliente(cl); setClienteModal(true); }}
                        onExcluir={setDeleteCliente}
                        onHistorico={(cl) => setHistoricoClienteId(cl.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Aba Tabela de Preços ── */}
            {subTab === "precos" && (
              <TabelaPrecos modoTeste={false} canEdit={false} />
            )}
          </>
        )}
      </div>
      </main>

      {/* ── Modais ── */}
      <Suspense fallback={null}>
        <NovoPedidoModal
          open={novoPedidoOpen || !!editarPedidoRetorno}
          onClose={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); setDuplicandoPedido(null); setEditarPedidoRetorno(null); }}
          onSuccess={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); setDuplicandoPedido(null); setEditarPedidoRetorno(null); loadPedidos(); refetchStock(); }}
          clienteFixo={pedidoComCliente}
          duplicarDe={duplicandoPedido}
          editarPedido={editarPedidoRetorno}
          expedicaoItems={expedicaoItems}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ClienteModal
          open={clienteModal}
          onClose={() => { setClienteModal(false); setEditCliente(null); }}
          onSuccess={() => { setClienteModal(false); setEditCliente(null); loadClientes(); }}
          inicial={editCliente}
        />
      </Suspense>

      <Suspense fallback={null}>
        <FaturarModal
          pedido={faturarPedido}
          onClose={() => setFaturarPedido(null)}
          onSuccess={() => { setFaturarPedido(null); loadPedidos(); refetchStock(); }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <AdicionarPecaModal
          pedido={adicionarPecaPedido}
          expedicaoItems={expedicaoItems}
          onClose={() => setAdicionarPecaPedido(null)}
          onSuccess={() => { setAdicionarPecaPedido(null); loadPedidos(); refetchStock(); }}
        />
      </Suspense>

      {/* Cancelar pedido */}
      {cancelarPedido && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><Ban className="h-4 w-4 text-destructive" /></div>
              <div>
                <p className="text-sm font-semibold">Cancelar pedido?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{cancelarPedido.cliente_nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">As peças reservadas voltarão a ficar disponíveis na expedição.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCancelarPedido(null)} disabled={cancelando} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Voltar</button>
              <button type="button" onClick={handleCancelar} disabled={cancelando} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {cancelando ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                Cancelar pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excluir cliente */}
      {deleteCliente && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><Trash2 className="h-4 w-4 text-destructive" /></div>
              <div>
                <p className="text-sm font-semibold">Excluir cliente?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{deleteCliente.nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">{isAdmin ? "Como admin, você pode excluir este cliente mesmo que tenha pedidos vinculados. Os pedidos também serão removidos." : "Clientes com pedidos vinculados não podem ser excluídos."}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteCliente(null)} disabled={deletingCliente} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
              <button type="button" onClick={handleDeleteCliente} disabled={deletingCliente} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {deletingCliente ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remover item de pedido pendente */}
      {removerItemPendente && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <X className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Remover peça do pedido?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{removerItemPendente.item.device_model}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">{removerItemPendente.item.quantidade} un. voltam ao estoque disponível.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setRemoverItemPendente(null)} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
              <button type="button" onClick={async () => {
                const { item, pedido } = removerItemPendente;
                // Remove da UI imediatamente (otimista)
                setPedidos(prev => prev.map(p => p.id === pedido.id
                  ? { ...p, itens: p.itens.filter(i => i.id !== item.id) }
                  : p
                ));
                setRemoverItemPendente(null);
                // Persiste
                await supabase.from("pedido_itens").delete().eq("id", item.id);
                // Libera reserva via RPC SECURITY DEFINER (contorna RLS para role comercial)
                await supabase.rpc("release_item_reservation", {
                  p_stock_item_id: item.stock_item_id,
                  p_quantity: item.quantidade,
                });
                toast.success(`${item.device_model} removida do pedido.`);
              }} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors flex items-center justify-center gap-1.5">
                <X className="h-3.5 w-3.5" /> Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Histórico Geral */}
      <Suspense fallback={null}>
        <HistoricoGeralModal open={historicoOpen} onClose={() => setHistoricoOpen(false)} isAdmin={isAdmin} />
      </Suspense>
      <Suspense fallback={null}>
        <HistoricoClienteModal
          clienteId={historicoClienteId}
          clientes={clientes}
          onClose={() => setHistoricoClienteId(null)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <ComentariosModal
          pedidoId={comentarioPedidoId}
          onClose={() => setComentarioPedidoId(null)}
        />
      </Suspense>
    </div>
  );
}
