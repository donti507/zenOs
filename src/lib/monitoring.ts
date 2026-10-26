import { privateErrorEvent } from '../../shared/monitoringPrivacy';

let capture: ((error: unknown) => void) | undefined;

/** Do not import or initialize the SDK without the opt-in Vite build variable. */
export async function initClientMonitoring(dsn: string | undefined = (import.meta as any).env?.VITE_SENTRY_DSN): Promise<boolean> {
  if (!dsn?.trim()) return false;
  if (capture) return true;
  try {
    const sentry = await import('@sentry/browser');
    const client = sentry.init({
      dsn,
      defaultIntegrations: false,
      integrations: [sentry.globalHandlersIntegration()],
      sendDefaultPii: false,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      enableLogs: false,
      tracesSampleRate: 0,
      beforeSend: event => privateErrorEvent(event, 'javascript'),
    });
    if (!client) return false;
    capture = error => { sentry.captureException(error); };
    return true;
  } catch {
    console.warn('[monitoring] Sentry could not initialize; monitoring is disabled.');
    return false;
  }
}

export function captureClientError(error: unknown) { capture?.(error); }
