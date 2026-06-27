import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AdminClearRpc =
  | "admin_clear_stock_movements"
  | "admin_clear_comercial"
  | "admin_clear_producao"
  | "admin_clear_rastreabilidade"
  | "admin_clear_financeiro"
  | "admin_clear_audit_log";

interface Props {
  /** Nome da RPC SECURITY DEFINER que faz a limpeza (ex: "admin_clear_stock_movements") */
  rpc: AdminClearRpc;
  /** Texto curto no botão, ex: "Apagar histórico" */
  label?: string;
  /** Título do modal de confirmação */
  confirmTitle: string;
  /** Descrição do que será apagado e do que é preservado */
  confirmDescription: string;
  /** Chamado após apagar com sucesso (ex: refetch da lista) */
  onCleared?: () => void;
  /** Classe extra para o botão, se precisar ajustar tamanho/posição no layout da página */
  className?: string;
}

/**
 * Botão + modal de confirmação para apagar histórico de um módulo via RPC
 * SECURITY DEFINER (admin only). Reusa o mesmo padrão visual e de chamada já
 * usado em BackupPanel.tsx (Estoque), só que pronto para ser colocado direto
 * no cabeçalho de qualquer página de módulo (Qualidade, Comercial, Produção,
 * Financeiro, Admin), sem precisar abrir um painel separado.
 *
 * A RPC em si decide o que é apagado — este componente só dispara a chamada
 * e mostra confirmação. Cada RPC admin_clear_* já valida role=admin no
 * servidor; o controle de exibir ou não este botão (isAdmin) fica a cargo de
 * quem usa o componente.
 */
export function ClearHistoryButton({
  rpc,
  label = "Apagar histórico",
  confirmTitle,
  confirmDescription,
  onCleared,
  className,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleClear() {
    setClearing(true);
    const { data, error } = await supabase.rpc(rpc);
    setClearing(false);

    const result = data as { ok?: boolean; error?: string; deleted?: number } | null;

    if (error || result?.ok === false) {
      toast.error(result?.error ?? error?.message ?? "Erro ao apagar histórico.");
      return;
    }

    const count = result?.deleted;
    toast.success(
      typeof count === "number"
        ? `Histórico apagado (${count} registro${count !== 1 ? "s" : ""}).`
        : "Histórico apagado com sucesso."
    );
    setConfirmOpen(false);
    onCleared?.();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        title={confirmTitle}
        className={cn(
          "h-8 px-3 rounded-xl border border-destructive/30 text-[12px] text-destructive font-medium",
          "hover:bg-destructive/10 transition-colors flex items-center gap-1.5 shrink-0",
          className
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {label}
      </button>

      {confirmOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-destructive/30 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-bold text-destructive">{confirmTitle}</p>
                <p className="text-[12px] text-muted-foreground mt-1">{confirmDescription}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={clearing}
                className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {clearing
                  ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Trash2 className="h-3.5 w-3.5" />}
                Apagar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
