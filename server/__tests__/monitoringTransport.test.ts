import { expect, it } from 'vitest';
import * as sentry from '@sentry/node';
import { privateErrorEvent } from '../../shared/monitoringPrivacy';

it('scrubs the actual SDK transport envelope, not just a mocked capture call', async () => {
  const envelopes: unknown[] = [];
  const client = sentry.init({
    dsn: 'https://public@example.com/1', defaultIntegrations: false,
    registerEsmLoaderHooks: false, skipOpenTelemetrySetup: true,
    sendDefaultPii: false, enableLogs: false, sendClientReports: false,
    beforeSend: event => privateErrorEvent(event, 'node'),
    transport: () => ({ send: async envelope => { envelopes.push(envelope); return {}; }, flush: async () => true }),
  });
  try {
    sentry.withScope(scope => {
      scope.setUser({ email: 'PRIVATE_EMAIL' });
      scope.setExtra('note', 'PRIVATE_NOTE');
      sentry.addBreadcrumb({ message: 'PRIVATE_DANTE' });
      sentry.captureException(new Error('PRIVATE_TASK'));
      sentry.captureMessage('PRIVATE_MESSAGE_ONLY');
      sentry.captureEvent({ request: { data: { messages: ['PRIVATE_BODY'], context: { tasks: ['PRIVATE_CONTEXT_TASK'] } }, headers: { authorization: 'PRIVATE_TOKEN' } }, exception: { values: [{ type: 'TypeError', value: 'PRIVATE_ERROR' }] } });
    });
    await client?.flush(2000);
    expect(envelopes).toHaveLength(2);
    const serialized = JSON.stringify(envelopes);
    expect(serialized).toContain('Error details removed for privacy');
    expect(serialized).not.toContain('PRIVATE_');
    expect(serialized).not.toContain('authorization');
  } finally { await client?.close(2000); }
});
