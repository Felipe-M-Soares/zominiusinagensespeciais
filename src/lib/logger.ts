/**
 * Logger centralizado.
 * Em produção (import.meta.env.PROD) suprime debug/info e mantém apenas error,
 * evitando vazar informação interna no console do browser.
 */
const isDev = !import.meta.env.PROD;

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
  info:  (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn:  (...args: unknown[]) => { if (isDev) console.warn(...args); },
  error: (...args: unknown[]) => console.error(...args), // sempre ativo
};
