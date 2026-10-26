// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LocalImportDialog from '../LocalImportDialog';
const ctx = vi.hoisted(() => ({ localImportOpen: true, localImportBusy: false, localImportError: null as string | null, importLocalWorkspace: vi.fn(), declineLocalWorkspace: vi.fn() }));
vi.mock('../../context/ZenosContext', () => ({ useZenos: () => ctx }));
vi.mock('../ui/kit', () => ({ btn: { primary: '', secondary: '' }, Modal: ({ open, title, children, footer, onClose }: any) => open ? <div role="dialog"><h2>{title}</h2>{children}{footer}<button onClick={onClose}>Close</button></div> : null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  ctx.localImportOpen = true; ctx.localImportBusy = false; ctx.localImportError = null;
  ctx.importLocalWorkspace.mockReset(); ctx.declineLocalWorkspace.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<LocalImportDialog />)); }
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
it('shows the requested question and invokes context actions', async () => {
  await render();
  expect(host.querySelector('h2')?.textContent).toBe('Import your local data into your account?');
  await act(async () => button('Import local data').click());
  expect(ctx.importLocalWorkspace).toHaveBeenCalledOnce();
  await act(async () => button('No, thanks').click());
  expect(ctx.declineLocalWorkspace).toHaveBeenCalledOnce();
});
it('disables actions during import and exposes retry errors accessibly', async () => {
  ctx.localImportBusy = true;
  await render();
  expect(button('Importing…').disabled).toBe(true);
  expect(button('No, thanks').disabled).toBe(true);
  ctx.localImportBusy = false; ctx.localImportError = 'Try again';
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Try again');
  expect(button('Import local data').disabled).toBe(false);
});
it('renders nothing when there is no pending import', async () => {
  ctx.localImportOpen = false;
  await render();
  expect(host.textContent).toBe('');
});
