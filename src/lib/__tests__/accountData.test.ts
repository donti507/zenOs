import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNT_TABLES, exportAccountData, deleteAccountData, downloadAccountData } from '../accountData';

function fakeClient(failTable?: string) {
  const queries: { table: string; userId?: string; offset?: number; columns?: string }[] = [];
  const from = vi.fn((table: string) => {
    const query = { table } as typeof queries[number];
    const chain = {
      select: vi.fn((columns: string) => { query.columns = columns; return chain; }),
      eq: vi.fn((column: string, id: string) => { expect(column).toBe('user_id'); query.userId = id; return chain; }),
      order: vi.fn((column: string) => { expect(column).toBe('id'); return chain; }),
      range: vi.fn(async (start: number, end: number) => {
        queries.push({ ...query, offset: start });
        expect(end - start).toBe(499);
        if (table === failTable) return { data: null, error: { message: 'access denied' } };
        // More than one server page, and far more than the 40-message UI limit.
        const count = table === 'dante_messages' ? (start === 0 ? 500 : 23) : 1;
        return { data: Array.from({ length: count }, (_, i) => ({ id: start + i, user_id: query.userId, ...(table === 'usos_accounts' ? { usos_user_id: '123', created_at: '2026-10-30', usos_access_token: 'never-export', usos_access_secret: 'never-export-secret' } : {}) })), error: null };
      }),
    };
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, queries, from };
}

describe('account data', () => {
  it('exports every data type and paginates the full Dante history, scoped to the signed-in user', async () => {
    const { client, queries } = fakeClient();
    const result = await exportAccountData(client, 'user-a');
    for (const table of ACCOUNT_TABLES) expect(result).toHaveProperty(table);
    expect((result as any).dante_messages).toHaveLength(523);
    expect(queries).toHaveLength(ACCOUNT_TABLES.length + 1);
    expect(queries.every(q => q.userId === 'user-a')).toBe(true);
    expect(queries.filter(q => q.table === 'dante_messages').map(q => q.offset)).toEqual([0, 500]);
    expect(result.version).toBe(1);
  });
  it('selects only safe USOS columns and never exports credentials', async () => {
    const { client, queries } = fakeClient();
    const result = await exportAccountData(client, 'user-a');
    expect(queries.find(query => query.table === 'usos_accounts')?.columns).toBe('id,user_id,usos_user_id,created_at');
    expect((result as any).usos_accounts).toEqual([{ id: 0, user_id: 'user-a', usos_user_id: '123', created_at: '2026-10-30' }]);
    expect(JSON.stringify(result)).not.toContain('never-export');
  });
  it('rejects a partial export when any table fails', async () => {
    await expect(exportAccountData(fakeClient('meetings').client, 'user-a')).rejects.toThrow('Could not export meetings: access denied');
  });
  it('does not query without a signed-in user', async () => {
    const { client, from } = fakeClient();
    await expect(exportAccountData(client, '')).rejects.toThrow('Sign in');
    expect(from).not.toHaveBeenCalled();
  });
  it('deletes through the authenticated transaction without accepting a target user ID', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await deleteAccountData({ rpc } as unknown as SupabaseClient);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_my_account');
  });
  it('surfaces deletion failures instead of claiming success', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'migration missing' } });
    await expect(deleteAccountData({ rpc } as unknown as SupabaseClient)).rejects.toThrow('migration missing');
  });
  it('downloads JSON and cleans up the anchor and object URL', async () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
    try {
      downloadAccountData({ tasks: [{ title: 'Keep me' }] }, '2026-10-26');
      expect(link.download).toBe('zen-os-data-2026-10-26.json');
      expect(link.click).toHaveBeenCalledOnce();
      expect(link.remove).toHaveBeenCalledOnce();
      const blob = create.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/json');
      expect(JSON.parse(await blob.text()).tasks[0].title).toBe('Keep me');
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith('blob:export');
    } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); }
  });
});
