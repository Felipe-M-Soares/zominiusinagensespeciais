/**
 * Spinner de carregamento de tela inteira.
 * Substitui o padrão duplicado nas 6 funções de rota em App.tsx.
 */
export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
