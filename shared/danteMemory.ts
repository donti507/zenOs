export type DanteMemory = { id: string; fact: string; createdAt: string };
export const MEMORY_LIMIT = 100;
export const MEMORY_PROMPT_LIMIT = 30;
export function validateMemoryFact(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 200) throw new Error('A fact must contain 1–200 characters.');
  return value.trim();
}
export function memoryFromRow(row: any): DanteMemory {
  if (typeof row?.id !== 'string' || !row.id || row.id.length > 64) throw new Error('Invalid memory ID.');
  const createdAt = row.created_at ?? row.createdAt;
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid memory date.');
  return { id: row.id, fact: validateMemoryFact(row.fact), createdAt };
}
export function recentMemory(value: unknown, limit = MEMORY_PROMPT_LIMIT): DanteMemory[] {
  if (!Array.isArray(value)) return [];
  const facts: DanteMemory[] = []; const seen = new Set<string>();
  for (const raw of value.slice(0, MEMORY_LIMIT)) {
    try { const row = memoryFromRow(raw); if (!seen.has(row.id)) { seen.add(row.id); facts.push(row); } } catch { /* reject malformed/unbounded client or local data */ }
  }
  return facts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
}
