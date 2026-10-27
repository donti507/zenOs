import { spaceSlug, spaceText, SPACE_LIMITS, type SpaceSnapshot } from '../../shared/space';

/** Only a concrete personal-page route is an edit target; Home widgets and /space are not. */
export function spaceVoiceSlug(pathname: string): string | null {
  const match = /^\/space\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try { return spaceSlug(decodeURIComponent(match[1])); } catch { return null; }
}

export function spaceVoiceConfirmation(language: string) {
  const confirmations: Record<string, string> = {
    en: 'Page updated. New save point created.',
    pl: 'Strona zaktualizowana. Zapisano nową wersję.',
    de: 'Seite aktualisiert. Neue Version gespeichert.',
    es: 'Página actualizada. Nueva versión guardada.',
    fr: 'Page mise à jour. Nouvelle version enregistrée.',
    uk: 'Сторінку оновлено. Нову версію збережено.',
  };
  return confirmations[language.split('-')[0]] || confirmations.en;
}

export async function editSpaceByVoice(options: {
  slug: string;
  pageId?: string;
  instruction: string;
  isOffline: boolean;
  signal: AbortSignal;
  isCurrent: () => boolean;
  loadSpacePage: (slug: string) => Promise<SpaceSnapshot>;
  editSpacePage: (snapshot: SpaceSnapshot, prompt: string, model: string, requestId: string, signal: AbortSignal) => Promise<SpaceSnapshot>;
}): Promise<SpaceSnapshot> {
  const check = () => {
    options.signal.throwIfAborted();
    if (!options.isCurrent()) throw new DOMException('Page or account changed.', 'AbortError');
  };
  check();
  const instruction = spaceText(options.instruction, SPACE_LIMITS.prompt, 'page instruction');
  const slug = spaceSlug(options.slug);
  const [snapshot, response] = await Promise.all([
    options.loadSpacePage(slug),
    fetch('/api/space/status', { signal: options.signal, cache: 'no-store' }),
  ]);
  check();
  const status = response.ok ? await response.json() : null;
  check();
  if (!status?.ready) throw new Error('Page editing is unavailable. Check the page builder setup.');
  if (status.authRequired && options.isOffline) throw new Error('Sign in to edit this page with voice on this server.');
  const models = status.models;
  if (!Array.isArray(models) || models.length < 1 || models.length > 3 || models.some(model => typeof model !== 'string' || !/^[a-z0-9_.:/-]{1,120}$/i.test(model) || model.includes('://')))
    throw new Error('No allowed page-builder model is available.');
  if (snapshot.page.slug !== slug || (options.pageId && snapshot.page.id !== options.pageId))
    throw new Error('This page changed. Reopen it before editing with voice.');
  const saved = await options.editSpacePage(snapshot, instruction, models[0], crypto.randomUUID(), options.signal);
  check();
  return saved;
}
