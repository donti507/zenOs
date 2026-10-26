export const DANTE_USAGE_CHANGED = 'zenos:dante-usage-changed';
/** No request content is attached; both chat and voice use this refresh signal. */
export function notifyDanteUsage() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DANTE_USAGE_CHANGED));
}
