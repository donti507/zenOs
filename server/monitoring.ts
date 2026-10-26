import type { ErrorRequestHandler } from 'express';
import { privateErrorEvent } from '../shared/monitoringPrivacy';

let capture: ((error: unknown) => void) | undefined;

/** Default-off: no SDK import, process handlers, or network activity without a DSN. */
export async function initServerMonitoring(dsn: string | undefined = process.env.SENTRY_DSN): Promise<boolean> {
  if (!dsn?.trim()) return false;
  if (capture) return true;
  try {
    const sentry = await import('@sentry/node');
    const client = sentry.init({
      dsn,
      defaultIntegrations: false,
      integrations: [sentry.onUncaughtExceptionIntegration(), sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
      skipOpenTelemetrySetup: true,
      registerEsmLoaderHooks: false,
      sendDefaultPii: false,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      enableLogs: false,
      tracesSampleRate: 0,
      beforeSend: event => privateErrorEvent(event, 'node'),
    });
    if (!client) return false;
    capture = error => { sentry.captureException(error); };
    return true;
  } catch {
    console.warn('[monitoring] Sentry could not initialize; monitoring is disabled.');
    return false;
  }
}

export function captureServerError(error: unknown) { capture?.(error); }

// Never attach req/res as capture context; preserve Express's existing response handling.
export const captureExpressError: ErrorRequestHandler = (error, _req, _res, next) => {
  captureServerError(error);
  next(error);
};
