import type { SupabaseClient } from '@supabase/supabase-js';

export const LOCAL_IMPORT_KEYS = {
  tasks: 'zenos_tasks', categories: 'zenos_categories', meetings: 'zenos_meetings', vault: 'zenos_vault',
} as const;
const choiceKey = (userId: string) => `zenos_local_import_choice_${userId}`;
const batchKey = 'zenos_local_import_batch';

export function readLocalImport(storage: Storage) {
  return Object.fromEntries(Object.entries(LOCAL_IMPORT_KEYS).map(([name, key]) => {
    const raw = storage.getItem(key);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) throw new Error(`Local ${name} data is invalid. Your data has not been removed.`);
    return [name, rows];
  }));
}

export function shouldOfferLocalImport(storage: Storage, userId: string) {
  if (storage.getItem(choiceKey(userId))) return false;
  return Object.values(readLocalImport(storage)).some(rows => rows.length > 0);
}

export function declineLocalImport(storage: Storage, userId: string) {
  storage.setItem(choiceKey(userId), 'declined');
}

/** The server transaction and persistent batch ID make retries safe after a lost response. */
export async function importLocalData(client: SupabaseClient, storage: Storage, userId: string) {
  if (!userId) throw new Error('Sign in before importing.');
  let batch: { id: string; payload: ReturnType<typeof readLocalImport>; snapshot: Record<string, string | null> };
  const saved = storage.getItem(batchKey);
  if (saved) {
    batch = JSON.parse(saved);
  } else {
    batch = {
      id: crypto.randomUUID(),
      payload: readLocalImport(storage),
      snapshot: Object.fromEntries(Object.values(LOCAL_IMPORT_KEYS).map(key => [key, storage.getItem(key)])),
    };
    storage.setItem(batchKey, JSON.stringify(batch));
  }
  const { error } = await client.rpc('import_local_data', { payload: batch.payload, batch_id: batch.id });
  if (error) throw new Error(`Import failed: ${error.message}. Your local data is still available.`);
  // Persist the account's decision before cleanup, so storage errors can be retried safely.
  storage.setItem(choiceKey(userId), 'imported');
  for (const key of Object.values(LOCAL_IMPORT_KEYS)) {
    // Another tab may have edited local data while the request was in progress.
    if (storage.getItem(key) === batch.snapshot[key]) storage.removeItem(key);
  }
  storage.removeItem(batchKey);
}
