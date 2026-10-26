// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { declineLocalImport, importLocalData, shouldOfferLocalImport } from '../localImport';
beforeEach(() => localStorage.clear());
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;
describe('local import lifecycle', () => {
  it('offers only when supported local data exists and remembers decline per account', () => {
    expect(shouldOfferLocalImport(localStorage, 'a')).toBe(false);
    localStorage.setItem('zenos_tasks', '[{"id":"local","title":"Task"}]');
    declineLocalImport(localStorage, 'a');
    expect(shouldOfferLocalImport(localStorage, 'a')).toBe(false);
    expect(shouldOfferLocalImport(localStorage, 'b')).toBe(true);
    expect(localStorage.getItem('zenos_tasks')).not.toBeNull();
  });
  it('clears only imported keys after success and remembers the account', async () => {
    for (const key of ['tasks', 'categories', 'meetings', 'vault']) localStorage.setItem(`zenos_${key}`, '[{"id":"local"}]');
    localStorage.setItem('zenos_theme', 'dark');
    localStorage.setItem('zenos_dante_history', '[{"content":"Keep"}]');
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await importLocalData(client(rpc), localStorage, 'a');
    expect(rpc.mock.calls[0][0]).toBe('import_local_data');
    expect(Object.keys(rpc.mock.calls[0][1].payload)).toEqual(['tasks', 'categories', 'meetings', 'vault']);
    expect(localStorage.getItem('zenos_tasks')).toBeNull();
    expect(localStorage.getItem('zenos_meetings')).toBeNull();
    expect(localStorage.getItem('zenos_categories')).toBeNull();
    expect(localStorage.getItem('zenos_vault')).toBeNull();
    expect(localStorage.getItem('zenos_theme')).toBe('dark');
    expect(localStorage.getItem('zenos_dante_history')).toContain('Keep');
    expect(shouldOfferLocalImport(localStorage, 'a')).toBe(false);
  });
  it('preserves local data on failure and reuses the batch ID on retry', async () => {
    localStorage.setItem('zenos_tasks', '[{"title":"Task"}]');
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: 'offline' } }).mockResolvedValueOnce({ error: null });
    await expect(importLocalData(client(rpc), localStorage, 'a')).rejects.toThrow('offline');
    expect(localStorage.getItem('zenos_tasks')).toContain('Task');
    expect(shouldOfferLocalImport(localStorage, 'a')).toBe(true);
    await importLocalData(client(rpc), localStorage, 'a');
    expect(rpc.mock.calls[0][1].batch_id).toBe(rpc.mock.calls[1][1].batch_id);
  });
  it('preserves data edited by another tab while uploading', async () => {
    localStorage.setItem('zenos_tasks', '[{"title":"Original"}]');
    const rpc = vi.fn().mockImplementation(async () => {
      localStorage.setItem('zenos_tasks', '[{"title":"New"}]');
      return { error: null };
    });
    await importLocalData(client(rpc), localStorage, 'a');
    expect(localStorage.getItem('zenos_tasks')).toContain('New');
  });
  it('retries the original snapshot and keeps newer edits after a lost response', async () => {
    localStorage.setItem('zenos_tasks', '[{"title":"Original"}]');
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: 'lost response' } }).mockResolvedValueOnce({ error: null });
    await expect(importLocalData(client(rpc), localStorage, 'a')).rejects.toThrow();
    localStorage.setItem('zenos_tasks', '[{"title":"Newer"}]');
    await importLocalData(client(rpc), localStorage, 'a');
    expect(rpc.mock.calls[1][1].payload.tasks[0].title).toBe('Original');
    expect(localStorage.getItem('zenos_tasks')).toContain('Newer');
  });
  it('never uploads or clears malformed local data', async () => {
    localStorage.setItem('zenos_tasks', '{"not":"an array"}');
    const rpc = vi.fn();
    await expect(importLocalData(client(rpc), localStorage, 'a')).rejects.toThrow('invalid');
    expect(rpc).not.toHaveBeenCalled();
    expect(localStorage.getItem('zenos_tasks')).not.toBeNull();
  });
});
