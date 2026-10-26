// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import DanteUsageNotice from '../DanteUsageNotice';
const ctx = vi.hoisted(() => ({ danteUsage: null as any, danteUsageError: null as string | null }));
vi.mock('../../context/ZenosContext', () => ({ useZenos: () => ctx }));
it('shows the actual allowance, including exhaustion and custom limits, without inventing disabled/error allowances', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); const root = createRoot(host);
  const render = () => act(async () => root.render(<DanteUsageNotice />));
  try {
    ctx.danteUsage = { enabled: true, messagesRemaining: 17, transcriptionsRemaining: 19, limit: 20 };
    await render(); expect(host.textContent).toContain('17 of 20 messages left today');
    ctx.danteUsage = { ...ctx.danteUsage, messagesRemaining: 0, limit: 25 };
    await render(); expect(host.textContent).toContain('0 of 25 messages left today');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    ctx.danteUsage = { enabled: false };
    await render(); expect(host.textContent).not.toContain('messages left');
    ctx.danteUsageError = 'Usage unavailable';
    await render(); expect(host.textContent).toContain('Usage unavailable');
  } finally { await act(async () => root.unmount()); }
});
