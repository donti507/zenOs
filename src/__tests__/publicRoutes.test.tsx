// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
const ctx = vi.hoisted(() => ({ user: null as { id: string } | null, isLoadingData: false, setShowBriefing: vi.fn(), passwordRecovery: false, setPasswordRecovery: vi.fn(), state: { theme: 'light' }, toggleTheme: vi.fn() }));
vi.mock('../context/ZenosContext', () => ({ useZenos: () => ctx, ZenosProvider: ({ children }: any) => children }));
vi.mock('../pages/Login', () => ({ default: ({ initialView }: any) => <h1>{initialView === 'reset-password' ? 'Reset password' : 'Existing Login'}</h1> }));
vi.mock('../pages/Home', () => ({ default: () => <h1>Workspace Home</h1> }));
vi.mock('../components/layout/AppShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet />, PageLoader: () => <p>Loading</p> };
});
// Compile the real landing module before rendering; route behavior is under test here.
beforeAll(async () => { await import('../pages/Landing'); });
let host: HTMLDivElement;
let root: Root;
function Back() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Browser back</button>; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  ctx.user = null; ctx.passwordRecovery = false; ctx.isLoadingData = false;
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(path = '/') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><AppRoutes /><Back /></MemoryRouter>));
  // First-time dynamic imports can finish after the initial act() turn.
  await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('h1')).not.toBeNull(); });
}
const link = (name: string) => Array.from(host.querySelectorAll('a')).find(a => a.textContent?.trim() === name)!;
it('shows the public landing at root and opens existing Login with browser-back support', async () => {
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('Your day,organised by AI');
  expect(host.textContent).not.toContain('Existing Login');
  await act(async () => link('Get started').click());
  expect(host.querySelector('h1')?.textContent).toBe('Existing Login');
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Browser back')!.click());
  expect(host.querySelector('h1')?.textContent).toContain('organised by AI');
});
it.each(['real-account', 'offline-user-123'])('keeps Home at root for signed-in/demo user %s', async id => {
  ctx.user = { id };
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('Workspace Home');
});
it('keeps login on protected deep links and password recovery ahead of the landing page', async () => {
  await render('/tasks');
  expect(host.querySelector('h1')?.textContent).toBe('Existing Login');
  ctx.passwordRecovery = true;
  await render('/');
  expect(host.querySelector('h1')?.textContent).toBe('Reset password');
});
it('navigates the public footer to Privacy and Terms without an auth gate', async () => {
  await render();
  await act(async () => link('Privacy').click());
  expect(host.querySelector('h1')?.textContent).toBe('Privacy Policy');
  // Legal links are normal document links; verify the direct public route as well.
  await act(async () => root.unmount()); root = createRoot(host);
  await render('/terms');
  expect(host.querySelector('h1')?.textContent).toBe('Terms of Service');
});
it('includes six feature cards and keeps the Pro checkout unavailable', async () => {
  await render();
  const names = Array.from(host.querySelectorAll('#features h3')).map(h => h.textContent);
  expect(names).toEqual(['Dante chat', 'Dante Live voice', 'Board', 'Calendar', 'Meetings', 'Analytics']);
  expect(host.querySelectorAll('#how-it-works li')).toHaveLength(3);
  expect(host.querySelector('#pricing')?.textContent).toContain('20 Dante messages/day');
  const pro = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Coming soon');
  expect(pro?.disabled).toBe(true);
  expect(host.querySelectorAll('#faq details').length).toBeGreaterThan(0);
});
it('uses the shared theme toggle', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Switch to dark mode"]')!.click());
  expect(ctx.toggleTheme).toHaveBeenCalledOnce();
});
