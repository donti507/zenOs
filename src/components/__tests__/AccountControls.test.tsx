// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import AccountControls from '../AccountControls';

const account = vi.hoisted(() => ({
  user: { id: 'signed-in' } as { id: string } | null,
  isOffline: false,
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
