import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), onUncaughtExceptionIntegration: vi.fn(() => ({ name: 'Uncaught' })), onUnhandledRejectionIntegration: vi.fn(() => ({ name: 'Rejections' })) }));
vi.mock('@sentry/node', () => sdk);
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); sdk.init.mockReturnValue({}); });
it('does nothing when server monitoring is disabled and preserves Express error handling', async () => {
  const monitoring = await import('../monitoring');
  expect(await monitoring.initServerMonitoring('')).toBe(false);
  const error = new Error('Private note');
  const next = vi.fn();
  monitoring.captureExpressError(error, { body: 'Private task' } as any, {} as any, next);
  expect(next).toHaveBeenCalledWith(error);
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.captureException).not.toHaveBeenCalled();
});
it('captures errors without attaching Express requests and filters content before sending', async () => {
  const monitoring = await import('../monitoring');
  expect(await monitoring.initServerMonitoring('https://public@example.com/1')).toBe(true);
  const error = new Error('PRIVATE_ERROR');
  const next = vi.fn();
  monitoring.captureExpressError(error, { body: 'PRIVATE_REQUEST', headers: { authorization: 'PRIVATE_TOKEN' } } as any, {} as any, next);
  expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(error);
  expect(next).toHaveBeenCalledWith(error);
  const options = sdk.init.mock.calls[0][0];
  expect(options).toMatchObject({ defaultIntegrations: false, sendDefaultPii: false, tracesSampleRate: 0, enableLogs: false, maxBreadcrumbs: 0, registerEsmLoaderHooks: false, skipOpenTelemetrySetup: true });
  expect(options.integrations).toEqual([{ name: 'Uncaught' }, { name: 'Rejections' }]);
  expect(JSON.stringify(options.beforeSend({ request: { data: 'PRIVATE_REQUEST' }, exception: { values: [{ value: 'PRIVATE_ERROR' }] } }))).not.toContain('PRIVATE_');
});
it('fails open if the optional SDK cannot initialize', async () => {
  sdk.init.mockImplementation(() => { throw new Error('SDK failed'); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { expect(await (await import('../monitoring')).initServerMonitoring('bad')).toBe(false); }
  finally { warning.mockRestore(); }
});
