// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BillingReturn from '../../pages/BillingReturn';
const ctx = vi.hoisted(() => ({ billing: { enabled: true, plan: 'free' as 'free' | 'pro' }, isOffline: false, refreshBilling: vi.fn(), startBilling: vi.fn() }));
vi.mock('../../context/ZenosContext', () => ({ useZenos: () => ctx }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  ctx.billing = { enabled: true, plan: 'free' }; ctx.isOffline = false;
  ctx.refreshBilling.mockReset().mockResolvedValue(undefined); ctx.startBilling.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = (result: 'success' | 'cancel' | 'upgrade') => act(async () => root.render(<MemoryRouter><BillingReturn result={result} /></MemoryRouter>));
it('never grants Pro from a success URL and polls server state with cleanup', async () => {
  vi.useFakeTimers(); await render('success');
  expect(host.textContent).toContain('checking your subscription'); expect(host.textContent).not.toContain('subscription is active');
  expect(ctx.refreshBilling).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(2000)); expect(ctx.refreshBilling).toHaveBeenCalledTimes(2);
  ctx.billing.plan = 'pro'; await render('success');
  expect(host.textContent).toContain('Your Pro subscription is active');
  expect(host.textContent).toContain('Manage subscription');
  expect(ctx.startBilling).not.toHaveBeenCalled();
});
it('shows cancel/upgrade content without opening checkout automatically and hides local purchases', async () => {
  await render('cancel'); expect(host.textContent).toContain('Checkout canceled'); expect(ctx.startBilling).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Upgrade to Pro')!.click());
  expect(ctx.startBilling).toHaveBeenCalledWith('checkout');
  ctx.isOffline = true; await render('upgrade');
  expect(host.textContent).toContain('Your local data stays in this browser');
  expect(host.querySelectorAll('button')).toHaveLength(0);
});
it('uses an accessible error and permits retry if billing fails', async () => {
  ctx.startBilling.mockRejectedValue(new Error('No network')); await render('upgrade');
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not open billing');
  expect(host.querySelector('button')?.disabled).toBe(false);
});
