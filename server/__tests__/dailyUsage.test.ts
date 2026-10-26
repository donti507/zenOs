import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDailyUsage, dailyLimit, usageDay } from '../dailyUsage';

function response() {
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader: vi.fn() };
  return res;
}
const userId = '00000000-0000-0000-0000-000000000001';
const row = { allowed: true, date: '2026-10-26', messages: 1, transcriptions: 0 };
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;
it('defaults invalid limits and uses UTC rollover regardless of local timezone', () => {
  for (const invalid of [undefined, '', 'oops', '-1', '0', '1.5', 'Infinity']) expect(dailyLimit(invalid)).toBe(20);
  expect(dailyLimit('35')).toBe(35);
  expect(usageDay(new Date('2026-10-26T23:59:59Z'))).toEqual({ date: '2026-10-26', resetsAt: '2026-10-27T00:00:00.000Z' });
  expect(usageDay(new Date('2026-10-27T00:00:00Z')).date).toBe('2026-10-27');
});
it('skips storage entirely without the service key or for anonymous/local requests', async () => {
  const getClient = vi.fn(); const next = vi.fn(); const res = response();
  await createDailyUsage({ client: getClient }).count('messages')({ userId } as any, res, next);
  await createDailyUsage({ key: 'server-only', client: getClient }).count('transcriptions')({ userId: 'anon:127.0.0.1' } as any, res, next);
  expect(next).toHaveBeenCalledTimes(2); expect(getClient).not.toHaveBeenCalled();
  await createDailyUsage().read({ userId } as any, res, vi.fn());
  expect(res.json).toHaveBeenCalledWith({ enabled: false });
});
it('reserves against the verified user, ignoring IDs and counters in the request body', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
  const next = vi.fn();
  await createDailyUsage({ key: 'server-only', limit: '25', client: () => client(rpc) }).count('messages')({ userId, body: { user_id: 'someone-else', messages: 0 } } as any, response(), next);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('consume_dante_usage', { p_user_id: userId, p_kind: 'messages', p_limit: 25 });
  expect(next).toHaveBeenCalledOnce();
});
it.each(['messages', 'transcriptions'] as const)('rejects exhausted %s with a friendly 429, retry metadata and no provider call', async kind => {
  const rpc = vi.fn().mockResolvedValue({ data: [{ ...row, allowed: false, messages: 20, transcriptions: 20 }], error: null });
  const res = response(); const next = vi.fn();
  await createDailyUsage({ key: 'server-only', client: () => client(rpc) }).count(kind)({ userId } as any, res, next);
  expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json.mock.calls[0][0].error).toContain('midnight UTC');
  expect(res.json.mock.calls[0][0].usage.messagesRemaining).toBe(0);
  expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
});
it('fails closed with 503 when enabled counting is unavailable', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'PRIVATE_DATABASE_FAILURE' } });
  const res = response(); const next = vi.fn();
  await createDailyUsage({ key: 'server-only', client: () => client(rpc) }).count('messages')({ userId } as any, res, next);
  expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('PRIVATE_DATABASE_FAILURE');
});
it('reads only this user and today without consuming allowance, including a new account', async () => {
  const eq = vi.fn();
  const query = { eq, maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  eq.mockReturnValue(query);
  const from = vi.fn(() => ({ select: vi.fn(() => query) })); const rpc = vi.fn();
  const res = response();
  await createDailyUsage({ key: 'server-only', client: () => ({ from, rpc }) as unknown as SupabaseClient }).read({ userId, query: { user_id: 'someone-else' } } as any, res, vi.fn());
  expect(eq).toHaveBeenCalledWith('user_id', userId); expect(eq).toHaveBeenCalledWith('date', usageDay().date);
  expect(rpc).not.toHaveBeenCalled();
  expect(res.json.mock.calls[0][0]).toMatchObject({ enabled: true, limit: 20, messagesRemaining: 20, transcriptionsRemaining: 20 });
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});
