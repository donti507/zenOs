import type { ErrorEvent, StackFrame } from '@sentry/browser';

const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError']);
const coordinate = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

function scrubFrame(frame: StackFrame): StackFrame {
  // Even filenames/functions/source lines can contain user text. Keep only a fixed
  // location label and numeric coordinates; never include source context or locals.
  const filename = frame.filename?.endsWith('/server.cjs') ? 'server.cjs'
    : frame.filename?.endsWith('/server.ts') ? 'server.ts'
    : frame.filename?.includes('/assets/') ? 'client.js' : '[code]';
  return { filename, lineno: coordinate(frame.lineno), colno: coordinate(frame.colno), in_app: frame.in_app === true };
}

/** Rebuild rather than blacklist: arbitrary messages, bodies, URLs, headers,
 * cookies, breadcrumbs, contexts, extras, user fields, logs, locals and source
 * context must never leave the app. Message-only events are dropped entirely. */
export function privateErrorEvent(event: ErrorEvent, platform: 'javascript' | 'node'): ErrorEvent | null {
  if (!event.exception?.values?.length) return null;
  return {
    type: undefined,
    event_id: /^[a-f0-9]{32}$/i.test(event.event_id || '') ? event.event_id : undefined,
    timestamp: typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? event.timestamp : undefined,
    platform,
    level: 'error',
    exception: {
      values: event.exception.values.slice(0, 3).map(exception => ({
        type: ERROR_TYPES.has(exception.type || '') ? exception.type : 'Error',
        value: 'Error details removed for privacy',
        mechanism: { type: 'generic', handled: exception.mechanism?.handled !== false },
        stacktrace: exception.stacktrace ? { frames: exception.stacktrace.frames?.slice(-50).map(scrubFrame) } : undefined,
      })),
    },
  };
}
