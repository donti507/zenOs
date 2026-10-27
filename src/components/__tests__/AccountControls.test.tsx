// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import AccountControls from '../AccountControls';

const account = vi.hoisted(() => ({
  user: { id: 'signed-in' } as { id: string } | null,
  isOffline: false,
  buildBadges: [] as {key:'first_page'|'first_remix'|'challenge_winner'|'seven_day_streak';earnedAt:string}[],
  billing: null as { enabled: boolean; plan: 'free' | 'pro'; hasCustomer?: boolean } | null,
  startBilling: vi.fn(),
  exportMyData: vi.fn(),
  deleteMyAccount: vi.fn(),
}));
vi.mock('../../context/ZenosContext', () => ({ useZenos: () => account }));
// Keep these tests focused on control behavior, independent of animation timers.
vi.mock('../ui/kit', () => ({
  btn: { secondary: '', danger: '' },
  Modal: ({ open, children, footer }: any) => open ? <div role="dialog">{children}{footer}</div> : null,
}));
let host: HTMLDivElement;
let root: Root;
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  account.user = { id: 'signed-in' };
  account.isOffline = false;
  account.buildBadges = [];
  account.billing = null; account.startBilling.mockReset().mockResolvedValue(undefined);
  account.exportMyData.mockReset().mockResolvedValue(undefined);
  account.deleteMyAccount.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async () => { await act(async () => root.render(<AccountControls />)); };

describe('account controls', () => {
  it('hides cloud account controls in local mode and when signed out', async () => {
    account.isOffline = true;
    await render();
    expect(host.textContent).toBe('');
    account.isOffline = false;
    account.user = null;
    await render();
    expect(host.textContent).toBe('');
  });
  it('requires explicit confirmation and allows cancellation without deletion', async () => {
    await render();
    await click('Delete my account');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(account.deleteMyAccount).not.toHaveBeenCalled();
    await click('Cancel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(account.deleteMyAccount).not.toHaveBeenCalled();
    await click('Delete my account');
    await click('Permanently delete account');
    expect(account.deleteMyAccount).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('keeps the confirmation open and shows a failed deletion', async () => {
    account.deleteMyAccount.mockRejectedValue(new Error('Deletion denied'));
    await render();
    await click('Delete my account');
    await click('Permanently delete account');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Deletion denied');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it('downloads through the context export action and reports failures', async () => {
    account.exportMyData.mockRejectedValue(new Error('Export failed'));
    await render();
    await click('Export my data (JSON)');
    expect(account.exportMyData).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Export failed');
    expect(account.deleteMyAccount).not.toHaveBeenCalled();
  });
  it('blocks repeated destructive requests while deletion is pending', async () => {
    let finish!: () => void;
    account.deleteMyAccount.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await render();
    await click('Delete my account');
    await click('Permanently delete account');
    expect(button('Deleting…').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    await click('Deleting…');
    expect(account.deleteMyAccount).toHaveBeenCalledOnce();
    await act(async () => finish());
  });
});

it('shows upgrades only when enabled and hides billing in local mode', async () => {
  await render(); expect(host.textContent).not.toContain('Upgrade to Pro');
  account.billing = { enabled: true, plan: 'free' }; await render();
  await click('Upgrade to Pro'); expect(account.startBilling).toHaveBeenCalledWith('checkout');
  account.isOffline = true; await render(); expect(host.textContent).toBe('');
});
it('opens the portal for Pro and reports billing errors accessibly', async () => {
  account.billing = { enabled: true, plan: 'pro' };
  account.startBilling.mockRejectedValue(new Error('Billing unavailable'));
  await render(); expect(host.textContent).not.toContain('Upgrade to Pro');
  await click('Manage subscription'); expect(account.startBilling).toHaveBeenCalledWith('portal');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Billing unavailable');
});
it('lets a free customer manage a past-due or canceled subscription', async () => {
  account.billing = { enabled: true, plan: 'free', hasCustomer: true }; await render();
  await click('Manage subscription'); expect(account.startBilling).toHaveBeenCalledWith('portal');
});

it('shows earned builder badges in cloud and local account menus',async()=>{
 account.buildBadges=[{key:'challenge_winner',earnedAt:'2026-10-27'}];await render();expect(host.querySelector('[aria-label="Your builder badges"]')?.textContent).toContain('Challenge winner');
 account.buildBadges=[{key:'first_remix',earnedAt:'2026-10-27'}];account.isOffline=true;await render();expect(host.textContent).toContain('First remix');expect(host.textContent).not.toContain('Export my data');
});
