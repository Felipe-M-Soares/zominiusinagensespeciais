/**
 * KeyboardShortcutsHelp — Painel de ajuda com atalhos de teclado
 *
 * Abre via Ctrl+/ e mostra todos os atalhos disponíveis no sistema.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const SHORTCUTS = [
  { keys: ["Ctrl", "K"], label: "Focar na busca principal" },
  { keys: ["Ctrl", "/"], label: "Mostrar atalhos de teclado" },
  { keys: ["Escape"], label: "Fechar modal / limpar busca" },
  { keys: ["Enter"], label: "Confirmar busca / autocomplete" },
  { keys: ["↑", "↓"], label: "Navegar nas sugestões" },
];

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("zomini:show-shortcuts", handler);
    return () => window.removeEventListener("zomini:show-shortcuts", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Atalhos de teclado</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-1">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <Badge key={k} variant="outline" className="text-[10px] px-1.5 py-0.5 font-mono">
                    {k}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/60 pt-1">
          Pressione <kbd className="text-[10px] border rounded px-1">Ctrl+/</kbd> a qualquer momento para ver este painel
        </p>
      </DialogContent>
    </Dialog>
  );
}
