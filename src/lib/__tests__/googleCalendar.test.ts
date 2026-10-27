import { afterEach, expect, it, vi } from 'vitest';
import { fetchGoogleCalendarEvents, createGoogleCalendarEvent } from '../googleCalendar';
afterEach(() => vi.unstubAllGlobals());
it('obtains a valid token automatically and retries a definitive expired-token response once', async () => {
  const token = vi.fn().mockResolvedValueOnce('expired').mockResolvedValueOnce('fresh');
  const request = vi.fn().mockResolvedValueOnce({ status: 401, ok: false }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: 'event' }] }) });
  vi.stubGlobal('fetch', request);
  expect(await fetchGoogleCalendarEvents(token, 2026, 9)).toEqual([{ id: 'event' }]);
  expect(token.mock.calls).toEqual([[false], [true]]);
  expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
});
it('refreshes meeting creation safely on 401, without repeating writes on transient failures', async () => {
  const token = vi.fn().mockResolvedValue('fresh'); const event = { summary: 'Review', description: '', date: '2026-10-27', startTime: '10:00', endTime: '11:00' };
  const request = vi.fn().mockResolvedValueOnce({ status: 401, ok: false }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'new-event' }) }); vi.stubGlobal('fetch', request);
  expect(await createGoogleCalendarEvent(token, event)).toEqual({ id: 'new-event' });
  expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
  request.mockReset().mockResolvedValue({ status: 503, ok: false });
  await expect(createGoogleCalendarEvent(token, event)).rejects.toThrow('temporarily unavailable'); expect(request).toHaveBeenCalledOnce();
});
it('does not loop on persistent auth failures or log error response bodies', async () => {
  const token = vi.fn().mockResolvedValue('token'); const request = vi.fn().mockResolvedValue({ status: 401, ok: false }); vi.stubGlobal('fetch', request);
  await expect(fetchGoogleCalendarEvents(token, 2026, 9)).rejects.toThrow('Reconnect'); expect(request).toHaveBeenCalledTimes(2);
});
