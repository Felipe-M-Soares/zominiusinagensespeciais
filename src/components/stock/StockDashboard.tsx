import { Package, TrendingDown, Wrench, ArrowDownCircle, ArrowUpCircle, Truck, Activity, PackageCheck, X } from "lucide-react";
import type { StockItem, AllMovement } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { fetchAllMovements } from "@/hooks/useStock";
import { supabase } from "@/integrations/supabase/client";
import { StockGlobalSearch } from "@/components/stock/StockGlobalSearch";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";

interface Props {
  items: StockItem[];
  loading: boolean;
  onEstoqueBaixo?: () => void;
}

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  bg: string;
  border: string;
  description?: string;
  onClick?: () => void;
}

function KpiCard({ icon: Icon, label, value, color, bg, border, description, onClick }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 flex items-start gap-3",
        bg,
        border,
        onClick && "cursor-pointer hover:brightness-110 transition-all active:scale-[0.98]"
      )}
      onClick={onClick}
    >
      <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", bg)}>
        <Icon className={cn("h-5 w-5", color)} />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
        {description && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

interface LoteBaixo {
  device_id: string;
  device_model: string;
  quantity: number;
}

interface EstoqueBaixoModalProps {
  open: boolean;
  onClose: () => void;
  lotes: LoteBaixo[];
}

function EstoqueBaixoModal({ open, onClose, lotes }: EstoqueBaixoModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-warning" />
            <p className="text-sm font-semibold">Lotes com Estoque Baixo na Expedição</p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-border/20">
          {lotes.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground/60">
              Nenhum lote com estoque baixo
            </div>
          ) : (
            lotes.map((lote, idx) => (
              <div key={idx} className="flex items-center justify-between px-5 py-3 hover:bg-muted/10 transition-colors">
                <p className="text-[13px] font-medium truncate flex-1 pr-4">{lote.device_model}</p>
                <span className={cn(
                  "text-sm font-bold tabular-nums px-2.5 py-0.5 rounded-lg",
                  lote.quantity === 0 ? "text-red-500 bg-red-500/10" : "text-warning bg-warning/10"
                )}>
                  {lote.quantity} un.
                </span>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-border/40 bg-muted/10">
          <p className="text-[11px] text-muted-foreground/60">
            {lotes.length} {lotes.length === 1 ? "lote abaixo" : "lotes abaixo"} de 100 unidades na expedição (incluindo zerados)
          </p>
        </div>
      </div>
    </div>
  );
}

export function StockDashboard({ items, loading, onEstoqueBaixo }: Props) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [movLoading, setMovLoading] = useState(true);
  const [pedidosSeparando, setPedidosSeparando] = useState(0);
  const [totalExpedicao, setTotalExpedicao] = useState(0);
  const [totalRetrabalho, setTotalRetrabalho] = useState(0);
  const [totalTipos, setTotalTipos] = useState(0);
  const [lotesExpedicao, setLotesExpedicao] = useState(0);
  const [lotesRetrabalho, setLotesRetrabalho] = useState(0);
  const [lotesBaixo, setLotesBaixo] = useState<LoteBaixo[]>([]);
  const [modalBaixoOpen, setModalBaixoOpen] = useState(false);
  const [giroData, setGiroData] = useState<{ name: string; giro: number; color: string }[]>([]);
  const alertedRef = useRef(false);

  // Realtime: notifica quando estoque baixo aparece pela primeira vez nesta sessão
  useEffect(() => {
    if (lotesBaixo.length > 0 && !alertedRef.current) {
      alertedRef.current = true;
      toast.warning(
        `${lotesBaixo.length} ${lotesBaixo.length === 1 ? "produto" : "produtos"} com estoque baixo na expedição.`,
        { duration: 6000, action: { label: "Ver", onClick: () => onEstoqueBaixo?.() } }
      );
    }
  }, [lotesBaixo, onEstoqueBaixo]);

  useEffect(() => {
    let cancelled = false;
    setMovLoading(true);
    // Busca mais para compensar os filtrados; exclui movimentos comerciais e financeiros
    fetchAllMovements(50).then(data => {
      if (!cancelled) {
        const soEstoque = data.filter(m => {
          const r = m.reason ?? "";
          // Exclui saídas de pedido comercial (separação concluída)
          if (r.startsWith("Pedido comercial")) return false;
          // Exclui faturamentos (NF emitida pelo financeiro)
          if (/^NF\s/i.test(r)) return false;
          return true;
        }).slice(0, 10);
        setMovements(soEstoque);
        setMovLoading(false);
      }
    }).catch(() => { if (!cancelled) setMovLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    supabase
      .from("pedidos_comerciais")
      .select("id", { count: "exact", head: true })
      .eq("status", "separando")
      .then(({ count }) => setPedidosSeparando(count ?? 0));

    async function loadTotals() {
      const PAGE_SIZE = 1000;

      // 1. Busca todos os stock_items
      let allRows: { id: string; device_id: string; quantity: number; fase: string }[] = [];
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("stock_items")
          .select("id, device_id, quantity, fase")
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error || !data || data.length === 0) break;
        allRows = allRows.concat(data as { id: string; device_id: string; quantity: number; fase: string }[]);
        if (data.length < PAGE_SIZE) break;
        page++;
      }

      if (!allRows.length) return;

      // 2. Agrupa por fase
      let exped = 0, retrab = 0;
      const tiposSet = new Set<string>();
      const expByDevice = new Map<string, number>();
      const expedicaoItemIds: string[] = [];
      const retrabalhoItemIds: string[] = [];

      for (const row of allRows) {
        const qty = (row.quantity as number) ?? 0;
        const fase = row.fase as string;
        const deviceId = row.device_id as string;
        tiposSet.add(deviceId);

        if (fase === "expedicao") {
          exped += qty;
          expByDevice.set(deviceId, (expByDevice.get(deviceId) ?? 0) + qty);
          expedicaoItemIds.push(row.id);
        } else if (fase === "retrabalho") {
          retrab += qty;
          retrabalhoItemIds.push(row.id);
        }
      }

      // 3. Conta lotes distintos com saldo > 0 na expedição
      async function countLotesComSaldo(itemIds: string[]): Promise<number> {
        if (itemIds.length === 0) return 0;
        const BATCH = 500;
        const movMap = new Map<string, number>();
        for (let i = 0; i < itemIds.length; i += BATCH) {
          const chunk = itemIds.slice(i, i + BATCH);
          let movPage = 0;
          while (true) {
            const { data: movData } = await supabase
              .from("stock_movements")
              .select("lote, type, quantity")
              .in("stock_item_id", chunk)
              .neq("lote", null)
              .range(movPage * PAGE_SIZE, (movPage + 1) * PAGE_SIZE - 1);
            if (!movData || movData.length === 0) break;
            for (const m of movData as { lote: string; type: string; quantity: number }[]) {
              if (!m.lote) continue;
              const key = m.lote.toUpperCase();
              movMap.set(key, (movMap.get(key) ?? 0) + (m.type === "entrada" ? m.quantity : -m.quantity));
            }
            if (movData.length < PAGE_SIZE) break;
            movPage++;
          }
        }
        return Array.from(movMap.values()).filter(s => s > 0).length;
      }

      const [lotesExpCount, lotesRetrabCount] = await Promise.all([
        countLotesComSaldo(expedicaoItemIds),
        countLotesComSaldo(retrabalhoItemIds),
      ]);

      // 4. Lotes (devices) na expedição com quantidade < 100 (incluindo zerados)
      const baixoDeviceIds: string[] = [];
      for (const [deviceId, qty] of expByDevice.entries()) {
        if (qty < 100) baixoDeviceIds.push(deviceId);
      }

      let baixoLotes: LoteBaixo[] = [];
      if (baixoDeviceIds.length > 0) {
        const { data: devData } = await supabase
          .from("devices")
          .select("id, model")
          .in("id", baixoDeviceIds);
        if (devData) {
          const modelMap = new Map((devData as { id: string; model: string }[]).map(d => [d.id, d.model]));
          baixoLotes = baixoDeviceIds
            .map(id => ({
              device_id: id,
              device_model: modelMap.get(id) ?? id,
              quantity: expByDevice.get(id) ?? 0,
            }))
            .sort((a, b) => a.quantity - b.quantity);
        }
      }

      // 5. Atualiza estados
      setTotalExpedicao(exped);
      setTotalRetrabalho(retrab);
      setTotalTipos(tiposSet.size);
      setLotesExpedicao(lotesExpCount);
      setLotesRetrabalho(lotesRetrabCount);
      setLotesBaixo(baixoLotes);

      // 6. Giro de estoque — top 8 devices na expedição por quantidade
      const COLORS = ["hsl(197 100% 47%)", "hsl(152 60% 40%)", "hsl(38 92% 50%)",
        "hsl(280 60% 55%)", "hsl(15 80% 55%)", "hsl(200 70% 50%)", "hsl(340 70% 55%)", "hsl(80 60% 45%)"];
      if (baixoDeviceIds.length > 0 || expByDevice.size > 0) {
        const { data: devData2 } = await supabase
          .from("devices").select("id, model")
          .in("id", Array.from(expByDevice.keys()).slice(0, 20));
        if (devData2) {
          const modelMap2 = new Map((devData2 as { id: string; model: string }[]).map(d => [d.id, d.model]));
          const sorted = Array.from(expByDevice.entries())
            .sort((a, b) => b[1] - a[1]).slice(0, 8);
          const totalQty = sorted.reduce((s, [, q]) => s + q, 0);
          const giro = sorted.map(([id, qty], i) => ({
            name: (modelMap2.get(id) ?? id).length > 14
              ? (modelMap2.get(id) ?? id).slice(0, 13) + "…"
              : (modelMap2.get(id) ?? id),
            giro: totalQty > 0 ? Math.round((qty / totalQty) * 100) : 0,
            color: COLORS[i % COLORS.length],
          }));
          setGiroData(giro);
        }
      }
    }

    loadTotals();
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border bg-muted/20 p-4 h-24 animate-pulse" />
          ))}
        </div>
        <div className="rounded-2xl border bg-muted/20 h-48 animate-pulse" />
        <div className="rounded-2xl border bg-muted/20 h-36 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Pesquisa Global de Estoque ── */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Pesquisa Geral do Estoque</p>
          <span className="text-[10px] text-muted-foreground/50 ml-auto">Localização · Lotes · Reservas · Retrabalho</span>
        </div>
        <div className="p-4">
          <StockGlobalSearch />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1 — Total de Peças na Expedição */}
        <KpiCard
          icon={Package}
          label="Total de Peças"
          value={totalExpedicao.toLocaleString("pt-BR")}
          color="text-primary"
          bg="bg-primary/5"
          border="border-primary/20"
          description={`${totalTipos} tipos · ${lotesExpedicao} lotes na expedição`}
        />

        {/* Card 2 — Peças em Retrabalho */}
        <KpiCard
          icon={Wrench}
          label="Peças em Retrabalho"
          value={totalRetrabalho.toLocaleString("pt-BR")}
          color="text-amber-500"
          bg="bg-amber-500/5"
          border="border-amber-500/20"
          description={`${lotesRetrabalho} ${lotesRetrabalho === 1 ? "lote" : "lotes"} em retrabalho`}
        />

        {/* Card 3 — Estoque Baixo (clicável) */}
        <KpiCard
          icon={TrendingDown}
          label="Estoque Baixo"
          value={lotesBaixo.length}
          color="text-warning"
          bg="bg-warning/5"
          border="border-warning/20"
          description="Lotes na expedição zerados ou abaixo de 100 un."
          onClick={() => setModalBaixoOpen(true)}
        />

        {/* Card 4 — Pedidos Separando (inalterado) */}
        <KpiCard
          icon={PackageCheck}
          label="Pedidos Separando"
          value={pedidosSeparando}
          color="text-blue-500"
          bg="bg-blue-500/5"
          border="border-blue-500/20"
          description="Em separação no estoque"
        />
      </div>

      <EstoqueBaixoModal
        open={modalBaixoOpen}
        onClose={() => setModalBaixoOpen(false)}
        lotes={lotesBaixo}
      />

      {/* Giro de Estoque — Distribuição por Produto (Expedição) */}
      {giroData.length > 0 && (
        <div className="rounded-2xl border border-border/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Distribuição de Estoque por Produto</p>
            </div>
            <span className="text-[11px] text-muted-foreground/60">Top {giroData.length} produtos · Expedição</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={giroData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))"
                  interval={0} angle={-25} textAnchor="end" height={44} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))"
                  tickFormatter={v => `${v}%`} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 12, fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v}% do estoque`, "Participação"]}
                />
                <Bar dataKey="giro" radius={[6, 6, 0, 0]}>
                  {giroData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Últimas Movimentações */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Últimas Movimentações</p>
        </div>
        {movLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : movements.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground/60">Nenhuma movimentação registrada</div>
        ) : (
          <div className="divide-y divide-border/20">
            {movements.map(m => {
              const isEntrada = m.type === "entrada";
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                  <div className={cn(
                    "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
                    isEntrada ? "bg-primary/10" : "bg-success/10"
                  )}>
                    {isEntrada
                      ? <ArrowDownCircle className="h-3.5 w-3.5 text-primary" />
                      : <ArrowUpCircle className="h-3.5 w-3.5 text-success" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{m.device_model}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {m.user_display_name ?? "—"} · {new Date(m.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-primary" : "text-success")}>
                      {isEntrada ? "+" : "-"}{m.quantity}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">un.</span>
                    {m.fase === "expedicao" && (
                      <span title="Expedição">
                        <Truck className="h-3 w-3 text-muted-foreground/40" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
