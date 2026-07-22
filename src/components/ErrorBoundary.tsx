import { Component, type ReactNode, type ErrorInfo } from "react";
import { logger } from "@/lib/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary global — captura erros de render antes que derrubem toda a aplicação.
 * Sem este componente, qualquer exceção em um componente React durante o render
 * propaga para cima e desmonta a árvore inteira, deixando o usuário com tela branca.
 *
 * Uso: envolver o <App /> em main.tsx com <ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // logger.error já envia ao Sentry quando VITE_SENTRY_DSN está
    // configurado (ver src/lib/logger.ts) — sem essa variável, cai no
    // console normalmente, sem quebrar nada.
    logger.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="text-center space-y-4 max-w-md">
            <h1 className="text-2xl font-semibold text-foreground">Algo deu errado</h1>
            <p className="text-sm text-muted-foreground">
              Ocorreu um erro inesperado. Tente recarregar a página.
            </p>
            {/* SECURITY: exibe detalhes do erro apenas em desenvolvimento.
                Em produção, error.message pode vazar caminhos internos,
                nomes de variáveis e mensagens de bibliotecas terceiras. */}
            {import.meta.env.DEV && this.state.error?.message && (
              <p className="text-xs text-muted-foreground font-mono bg-muted px-3 py-2 rounded-lg text-left break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
