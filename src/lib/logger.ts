/**
 * Logger centralizado.
 * QUAL-04: Em produção integra com Sentry via VITE_SENTRY_DSN.
 * Em desenvolvimento expõe logs no console normalmente.
 */

const isDev = !import.meta.env.PROD;
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Lazy-initialise Sentry only in production when DSN is configured
let sentryReady = false;
async function initSentry() {
  if (sentryReady || isDev || !SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/browser");
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: "production",
      // Keep a lean sample rate — adjust as needed
      tracesSampleRate: 0.1,
    });
    sentryReady = true;
  } catch {
    // Sentry unavailable — degrade silently; don't break the app
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
    // Sentry capture failed — ignore
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
      // QUAL-04: Report to Sentry in production when DSN is configured
      captureError(args[0]);
    } else {
      // Fallback: log to console in production when Sentry is not configured
      // so errors are never silently swallowed
      console.error(...args);
    }
  },
};
