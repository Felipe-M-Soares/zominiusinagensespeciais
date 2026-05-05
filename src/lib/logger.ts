/**
 * Logger centralizado.
 * PERF-02 FIX: Em produção, erros não são expostos no console do browser
 * (que poderia vazar nomes de colunas, constraints e detalhes internos do banco).
 * Para monitoramento em produção, integrar Sentry ou similar aqui.
 */
const isDev = !import.meta.env.PROD;

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
  info:  (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn:  (...args: unknown[]) => { if (isDev) console.warn(...args); },
  error: (...args: unknown[]) => {
    if (isDev) {
      console.error(...args);
    }
    // Em produção: enviar para serviço de monitoramento (ex: Sentry)
    // Exemplo: Sentry.captureException(args[0] instanceof Error ? args[0] : new Error(String(args[0])));
    // NÃO usar console.error em produção — expõe detalhes internos no DevTools do usuário
  },
};
