/**
 * ReportarNaoConformidadeModal — "Abrir Não Conformidade", disponível para
 * QUALQUER usuário autenticado (qualquer setor), não só Qualidade.
 *
 * Qualquer setor pode encontrar um problema na empresa (o caso mais comum é
 * a inspeção encontrar uma peça com defeito) e abrir uma NC. A partir daí a
 * Qualidade analisa e decide entre abrir uma Ocorrência (registro simples)
 * ou uma RNC (Relatório de Não Conformidade — tratamento formal). Ver painel
 * de gestão em NaoConformidadePanel.tsx (dentro de Qualidade).
 *
 * Quando a NC envolve peça, usa o mesmo mecanismo de busca por referência
 * usado no resto do app (tabela devices) + campo de lote livre — o mesmo
 * dado usado nas movimentações de estoque (stock_movements.lote) — para
 * manter a rastreabilidade consistente com o restante do sistema.
 */
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, CheckCircle2, Search, X, Package } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface DeviceOption {
  id: string;
  reference: string;
  model: string;
}

interface ReportarNaoConformidadeModalProps {
  /** Quando true, renderiza só o item de menu (sem trigger próprio). */
  asMenuItem?: boolean;
  /** Trigger no estilo dos botões da sidebar do AppShell (ícone + texto opcional). */
  sidebarTrigger?: boolean;
  /** Quando sidebarTrigger=true e a sidebar está colapsada, mostra só o ícone. */
  collapsed?: boolean;
  className?: string;
}

export function ReportarNaoConformidadeModal({ asMenuItem, sidebarTrigger, collapsed, className }: ReportarNaoConformidadeModalProps) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [envolvePeca, setEnvolvePeca] = useState(false);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceOptions, setDeviceOptions] = useState<DeviceOption[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceOption | null>(null);
  const [lote, setLote] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // número da NC gerada

  function reset() {
    setTitulo(""); setDescricao(""); setEnvolvePeca(false);
    setDeviceQuery(""); setDeviceOptions([]); setSelectedDevice(null);
    setLote(""); setQuantidade(""); setSent(null);
  }

  const buscarDevices = useDebounce(async (q: string) => {
    if (q.trim().length < 2) { setDeviceOptions([]); return; }
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("id, reference, model")
        .or(`reference.ilike.%${q.trim()}%,model.ilike.%${q.trim()}%`)
        .limit(8);
      if (error) throw error;
      setDeviceOptions((data as DeviceOption[]) ?? []);
    } catch (err) {
      logger.error("ReportarNaoConformidade: erro na busca de peça", err);
    } finally {
      setSearching(false);
    }
  }, 350);

  const handleDeviceQueryChange = useCallback((v: string) => {
    setDeviceQuery(v);
    setSelectedDevice(null);
    buscarDevices(v);
  }, [buscarDevices]);

  async function handleSend() {
    const t = titulo.trim();
    const d = descricao.trim();
    if (t.length < 3) { toast.error("Informe um título curto para a não conformidade."); return; }
    if (d.length < 10) { toast.error("Descreva o que foi encontrado com mais detalhes."); return; }
    if (envolvePeca && !selectedDevice) { toast.error("Selecione a peça envolvida."); return; }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("abrir_nao_conformidade", {
        p_titulo: t,
        p_descricao: d,
        p_envolve_peca: envolvePeca,
        p_device_id: envolvePeca ? selectedDevice!.id : null,
        p_lote: envolvePeca && lote.trim() ? lote.trim() : null,
        p_quantidade_afetada: envolvePeca && quantidade.trim() ? Number(quantidade) : null,
      });
      const result = data as { ok?: boolean; error?: string; numero?: string } | null;
      if (error || result?.ok === false) {
        toast.error(result?.error ?? "Não foi possível abrir a não conformidade.");
        return;
      }
      setSent(result?.numero ?? null);
    } catch {
      toast.error("Erro ao enviar. Verifique sua conexão.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {sidebarTrigger ? (
        <button
          type="button"
          onClick={() => { reset(); setOpen(true); }}
          title="Reportar uma não conformidade"
          className={cn(
            "w-full flex items-center rounded-lg text-sm font-medium text-muted-foreground hover:text-orange-500 hover:bg-orange-500/10 transition-colors",
            collapsed ? "p-2.5 justify-center" : "px-3 py-2 gap-3",
            className
          )}
        >
          <AlertTriangle className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
          {!collapsed && <span>Não Conformidade</span>}
        </button>
      ) : asMenuItem ? (
        <button
          type="button"
          onClick={() => { reset(); setOpen(true); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
            className
          )}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Não Conformidade</span>
        </button>
      ) : (
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)} onClick={() => { reset(); setOpen(true); }}>
          <AlertTriangle className="h-3.5 w-3.5" /> Não Conformidade
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">Não conformidade registrada!</p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Protocolo <span className="font-mono font-semibold">{sent}</span>. A Qualidade foi notificada e vai analisar.
                </p>
              </div>
              <Button size="sm" onClick={() => setOpen(false)}>Fechar</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4.5 w-4.5 text-orange-500" />
                  Abrir Não Conformidade
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <p className="text-[12px] text-muted-foreground -mt-1">
                  Encontrou um problema? Qualquer setor pode registrar aqui — a Qualidade vai analisar e decidir
                  entre abrir uma Ocorrência ou uma RNC.
                </p>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Título</Label>
                  <Input
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    placeholder="Ex: Peça com defeito na inspeção"
                    maxLength={200}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Descrição</Label>
                  <Textarea
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    placeholder="Descreva o que foi encontrado, quando e onde..."
                    rows={4}
                    maxLength={4000}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Envolve uma peça específica?</span>
                  </div>
                  <Switch checked={envolvePeca} onCheckedChange={setEnvolvePeca} />
                </div>

                {envolvePeca && (
                  <div className="space-y-3 rounded-lg bg-muted/30 p-3 border border-border/40">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Peça (referência ou modelo)
                      </Label>
                      {selectedDevice ? (
                        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{selectedDevice.reference}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{selectedDevice.model}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setSelectedDevice(null); setDeviceQuery(""); }}
                            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            value={deviceQuery}
                            onChange={(e) => handleDeviceQueryChange(e.target.value)}
                            placeholder="Digite para buscar a peça..."
                            className="pl-8"
                          />
                          {searching && (
                            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                          {deviceOptions.length > 0 && (
                            <div className="mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                              {deviceOptions.map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => { setSelectedDevice(d); setDeviceOptions([]); }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors border-b border-border/30 last:border-0"
                                >
                                  <span className="font-medium">{d.reference}</span>
                                  <span className="text-muted-foreground"> — {d.model}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Lote (opcional)
                        </Label>
                        <Input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Ex: L2026-04" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Qtd. afetada
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          value={quantidade}
                          onChange={(e) => setQuantidade(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <Button className="w-full" onClick={handleSend} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <AlertTriangle className="h-4 w-4 mr-1.5" />}
                  Enviar para a Qualidade
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
