import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), globalHandlersIntegration: vi.fn(() => ({ name: 'GlobalHandlers' })) }));
vi.mock('@sentry/browser', () => sdk);
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); sdk.init.mockReturnValue({}); });
it('does not initialize or capture without a client DSN', async () => {
  const monitoring = await import('../monitoring');
  expect(await monitoring.initClientMonitoring('')).toBe(false);
  monitoring.captureClientError(new Error('Private note'));
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.captureException).not.toHaveBeenCalled();
});
it('enables only explicit global error handling and the privacy filter when configured', async () => {
  const monitoring = await import('../monitoring');
  expect(await monitoring.initClientMonitoring('https://public@example.com/1')).toBe(true);
  await monitoring.initClientMonitoring('https://public@example.com/1');
  expect(sdk.init).toHaveBeenCalledOnce();
  const options = sdk.init.mock.calls[0][0];
  expect(options).toMatchObject({ defaultIntegrations: false, sendDefaultPii: false, enableLogs: false, tracesSampleRate: 0, maxBreadcrumbs: 0, sendClientReports: false });
  expect(options.integrations).toEqual([{ name: 'GlobalHandlers' }]);
  const safe = options.beforeSend({ request: { data: 'PRIVATE_BODY' }, exception: { values: [{ value: 'PRIVATE_DANTE' }] } });
  expect(JSON.stringify(safe)).not.toContain('PRIVATE_');
  const error = new Error('Private note');
  monitoring.captureClientError(error);
  expect(sdk.captureException).toHaveBeenCalledWith(error);
});
it('allows the app to continue if initialization fails', async () => {
  sdk.init.mockImplementation(() => { throw new Error('invalid DSN'); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { expect(await (await import('../monitoring')).initClientMonitoring('bad')).toBe(false); }
  finally { warning.mockRestore(); }
});
