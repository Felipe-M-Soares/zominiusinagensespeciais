/**
 * Carregamento de tela inteira (rotas, sessão, módulos sob demanda).
 * Usa h-full dentro do AppShell e ocupa a tela toda fora dele.
 */
export function LoadingScreen() {
  return (
    <div className="min-h-[60vh] h-full flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      <span className="text-xs text-muted-foreground">Carregando…</span>
    </div>
  );
}
