/**
 * logger — Logger centralizado com integração opcional ao Sentry
 *
 * Em desenvolvimento: todos os níveis aparecem no console.
 * Em produção com VITE_SENTRY_DSN configurado: erros são enviados ao Sentry.
 * Em produção sem Sentry: erros caem no console (nunca silenciados).
 *
 * Uso: import { logger } from "@/lib/logger"
 *      logger.error("Mensagem", errorObject)
 */

const isDev = !import.meta.env.PROD;
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let sentryReady = false;

async function initSentry() {
  if (sentryReady || isDev || !SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/browser");
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: "production",
      tracesSampleRate: 0.1,
    });
    sentryReady = true;
  } catch {
    // Sentry indisponível — degrada silenciosamente, não bloqueia o app
  }
}

async function captureError(err: unknown) {
  if (isDev || !SENTRY_DSN) return;
  await initSentry();
  if (!sentryReady) return;
  try {
    const Sentry = await import("@sentry/browser");
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  } catch {
    // Falha no Sentry não deve quebrar o app
  }
}

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args); },
  info:  (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn:  (...args: unknown[]) => { if (isDev) console.warn(...args); },
  error: (...args: unknown[]) => {
    if (isDev) {
      console.error(...args);
    } else if (SENTRY_DSN) {
      captureError(args[0]);
    } else {
      // Fallback: erros nunca são silenciados em produção
      console.error(...args);
    }
  },
};
