import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/browser';
import { privateErrorEvent } from '../monitoringPrivacy';

export const sensitiveEvent: ErrorEvent = { type: undefined,
  event_id: 'a'.repeat(32), timestamp: 123,
  message: 'PRIVATE_TASK_TITLE',
  request: { data: { context: { tasks: ['PRIVATE_BODY_TASK'], note: 'PRIVATE_BODY_NOTE' }, messages: ['PRIVATE_DANTE'] }, headers: { Authorization: 'PRIVATE_TOKEN' }, cookies: { session: 'PRIVATE_COOKIE' }, url: 'https://example.com/tasks?note=PRIVATE_URL' },
  user: { email: 'PRIVATE_EMAIL' }, extra: { raw: { note: 'PRIVATE_EXTRA' } },
  breadcrumbs: [{ message: 'PRIVATE_CONSOLE', data: { content: 'PRIVATE_BREADCRUMB' } }],
  contexts: { app: { content: 'PRIVATE_CONTEXT' } }, tags: { note: 'PRIVATE_TAG' },
  logentry: { message: 'PRIVATE_LOG' }, transaction: 'PRIVATE_ROUTE', fingerprint: ['PRIVATE_FINGERPRINT'],
  exception: { values: [{ type: 'TypeError', value: 'PRIVATE_ERROR_NOTE', mechanism: { type: 'PRIVATE_MECHANISM', handled: false }, stacktrace: { frames: [{ filename: 'https://example.com/assets/app.js?note=PRIVATE_FILENAME', function: 'PRIVATE_FUNCTION', context_line: 'PRIVATE_SOURCE', pre_context: ['PRIVATE_PRE'], post_context: ['PRIVATE_POST'], vars: { content: 'PRIVATE_LOCAL' }, lineno: 12, colno: 9, in_app: true }] } }] },
};
describe('Sentry privacy allowlist', () => {
  it('removes application content from every event surface, including requests and exception messages', () => {
    const safe = privateErrorEvent(sensitiveEvent, 'javascript');
    expect(JSON.stringify(safe)).not.toContain('PRIVATE_');
    expect(safe?.request).toBeUndefined();
    expect(safe?.breadcrumbs).toBeUndefined();
    expect(safe?.exception?.values?.[0]).toMatchObject({ type: 'TypeError', value: 'Error details removed for privacy', stacktrace: { frames: [{ filename: 'client.js', lineno: 12, colno: 9 }] } });
    expect(sensitiveEvent.message).toBe('PRIVATE_TASK_TITLE');
  });
  it('does not allow arbitrary error names, event IDs or invalid coordinates', () => {
    const safe = privateErrorEvent({ type: undefined, event_id: 'PRIVATE_ID', exception: { values: [{ type: 'PRIVATE_TYPE', value: 'note', stacktrace: { frames: [{ lineno: NaN, colno: -1, filename: '/PRIVATE_PATH' }] } }] } }, 'node');
    expect(JSON.stringify(safe)).not.toContain('PRIVATE_');
    expect(safe?.exception?.values?.[0].type).toBe('Error');
    expect(safe?.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBeUndefined();
  });
  it('drops message-only events rather than sending user text', () => {
    expect(privateErrorEvent({ type: undefined, message: 'Private task or note' }, 'node')).toBeNull();
  });
});
