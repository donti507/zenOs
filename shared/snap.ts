export const MAX_SNAP_BYTES = 5 * 1024 * 1024;
export const MAX_SNAP_ITEMS = 50;
export const SNAP_TYPES = ['task', 'exam', 'meeting'] as const;
export type SnapItem = { title: string; date: string; type: typeof SNAP_TYPES[number] };
export function validSnapDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** Unknown/ambiguous dates stay blank for user review; never invent a deadline. */
export function parseSnapItems(value: unknown): SnapItem[] {
  const items = (value as any)?.items;
  if (!Array.isArray(items) || items.length > MAX_SNAP_ITEMS) throw new Error('Invalid extracted items');
  return items.map(item => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 200 || !SNAP_TYPES.includes(item.type)) throw new Error('Invalid extracted item');
    return { title: item.title.trim(), date: validSnapDate(item.date) ? item.date : '', type: item.type };
  });
}
export function snapItemError(item: SnapItem) {
  if (!item.title.trim() || item.title.trim().length > 200) return 'Add a title of up to 200 characters.';
  if (!validSnapDate(item.date)) return 'Choose a valid date before creating this item.';
  if (!SNAP_TYPES.includes(item.type)) return 'Choose a valid item type.';
  return null;
}
