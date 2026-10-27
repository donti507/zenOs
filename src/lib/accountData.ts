import type { SupabaseClient } from '@supabase/supabase-js';

export const ACCOUNT_TABLES = ['tasks', 'categories', 'meetings', 'vault_items', 'dante_messages', 'dante_memory', 'lectures', 'space_pages', 'space_page_versions'] as const;

/** Read fresh, complete data rather than the UI's truncated chat history. */
export async function exportAccountData(client: SupabaseClient, userId: string) {
  if (!userId) throw new Error('Sign in to export your data.');
  const entries = await Promise.all(ACCOUNT_TABLES.map(async table => {
    const rows: Record<string, unknown>[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from(table).select('*').eq('user_id', userId)
        .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Could not export ${table}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return [table, rows] as const;
  }));
  return { version: 1, exportedAt: new Date().toISOString(), ...Object.fromEntries(entries) };
}

export async function deleteAccountData(client: SupabaseClient) {
  const { error } = await client.rpc('delete_my_account');
  if (error) throw new Error(`Could not delete your account: ${error.message}`);
}

export function downloadAccountData(data: unknown, date: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `zen-os-data-${date}.json`;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
