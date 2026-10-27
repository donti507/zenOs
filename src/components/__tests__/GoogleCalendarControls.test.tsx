// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Calendar from '../../pages/Calendar';
const ctx = vi.hoisted(() => ({
  state: { calYear: 2026, calMonth: 9, tasks: [], categories: [], meetings: [] },
  googleEvents: [], loadingEvents: false, googleConnected: true, googleCalendarError: null as string | null,
  disconnectGoogleCalendar: vi.fn(), isOffline: false, loginWithGoogle: vi.fn(),
  updateState: vi.fn(), setShowModal: vi.fn(), setEditTaskId: vi.fn(), toggleTaskDone: vi.fn(),
}));
vi.mock('../../context/ZenosContext', () => ({ useZenos: () => ctx }));
vi.mock('../SnapSyllabus', () => ({ default: () => null }));
vi.mock('../ExamPlanner', () => ({ default: () => null }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  ctx.googleConnected = true; ctx.googleCalendarError = null; ctx.isOffline = false;
  ctx.disconnectGoogleCalendar.mockReset().mockResolvedValue(undefined); ctx.loginWithGoogle.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<MemoryRouter><Calendar /></MemoryRouter>));
it('offers disconnect for a stored connection, with a pending state and accessible failure', async () => {
  let finish!: () => void; ctx.disconnectGoogleCalendar.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await render(); const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Disconnect Google Calendar')!;
  await act(async () => button.click()); expect(button.disabled).toBe(true); expect(button.textContent).toBe('Disconnecting…');
  await act(async () => finish()); expect(ctx.disconnectGoogleCalendar).toHaveBeenCalledOnce();
  ctx.disconnectGoogleCalendar.mockRejectedValue(new Error('failure'));
  await act(async () => button.click()); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not disconnect');
});
it('reconnects through explicit Calendar consent and hides cloud controls in local mode', async () => {
  ctx.googleConnected = false; await render();
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Connect')!.click());
  expect(ctx.loginWithGoogle).toHaveBeenCalledWith(true);
  ctx.isOffline = true; await render(); expect(host.textContent).not.toContain('Connect Google Calendar'); expect(host.textContent).not.toContain('Disconnect Google Calendar');
  expect(host.textContent).toContain('Calendar');
});
