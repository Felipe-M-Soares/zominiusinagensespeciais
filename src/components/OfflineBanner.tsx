/**
 * OfflineBanner — Banner persistente de status de conexão
 *
 * Exibe um banner fixo no topo quando o usuário está offline,
 * mostrando o número de operações pendentes de sincronização.
 * Diferente do toast (que desaparece), o banner permanece visível
 * enquanto a conexão estiver ausente — crítico para operadores
 * em galpões com Wi-Fi instável.
 */
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { cn } from "@/lib/utils";
import { WifiOff, RefreshCw, Wifi } from "lucide-react";
import { useState, useEffect } from "react";

export function OfflineBanner() {
  const { isOnline, pendingCount, syncing, syncQueue } = useOfflineSync();
  const [justCameOnline, setJustCameOnline] = useState(false);

  // Mostra brevemente o banner "Conectado" ao reconectar
  useEffect(() => {
    if (isOnline && pendingCount === 0) {
      setJustCameOnline(true);
      const t = setTimeout(() => setJustCameOnline(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOnline, pendingCount]);

  // Nada a mostrar: online sem pendentes e sem transição
  if (isOnline && !syncing && pendingCount === 0 && !justCameOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "w-full px-4 py-2 flex items-center justify-between gap-3 text-xs font-medium transition-all duration-300",
        !isOnline
          ? "bg-destructive/10 text-destructive border-b border-destructive/20"
          : syncing
          ? "bg-warning/10 text-warning border-b border-warning/20"
          : "bg-success/10 text-success border-b border-success/20"
      )}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Wifi className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>
          {!isOnline
            ? pendingCount > 0
              ? `Sem conexão — ${pendingCount} operaç${pendingCount === 1 ? "ão" : "ões"} aguardando sincronização`
              : "Sem conexão — operações serão salvas localmente"
            : syncing
            ? `Sincronizando ${pendingCount} operaç${pendingCount === 1 ? "ão" : "ões"}...`
            : "Conexão restaurada"}
        </span>
      </div>
      {isOnline && pendingCount > 0 && !syncing && (
        <button
          onClick={syncQueue}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-current hover:opacity-80 transition-opacity"
        >
          <RefreshCw className="h-3 w-3" />
          Sincronizar
        </button>
      )}
    </div>
  );
}
