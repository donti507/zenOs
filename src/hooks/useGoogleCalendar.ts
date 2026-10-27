import { useCallback, useEffect, useRef, useState } from 'react';

export const GOOGLE_CONNECT_PENDING = 'zenos_google_calendar_connect';
export type GoogleProviderSession = { userId: string; refreshToken: string; authToken: string };
type Token = { owner: string; value: string; expiresAt: number };
export function useGoogleCalendar(options: { userId: string | null; isOffline: boolean; getAuthToken: () => Promise<string | null>; providerSession: GoogleProviderSession | null }) {
  const current = useRef(options); current.current = options;
  const epoch = useRef(0);
  const active = useRef(true);
  const canRestore = useRef(true);
  const cache = useRef<Token | null>(null);
  const pending = useRef<Promise<string> | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const connecting = useRef<Promise<string> | null>(null);
  const disconnecting = useRef(false);
  const seenSession = useRef<GoogleProviderSession | null>(null);
  const [status, setStatus] = useState<{ owner: string | null; connected: boolean; token: string | null; error: string | null }>({ owner: null, connected: false, token: null, error: null });
  const reset = useCallback(() => {
    ++epoch.current; canRestore.current = true; cache.current = null; pending.current = null; connecting.current = null;
    controllers.current.forEach(c => c.abort()); controllers.current.clear();
    setStatus({ owner: current.current.userId, connected: false, token: null, error: null });
  }, []);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; ++epoch.current; seenSession.current = null; controllers.current.forEach(c => c.abort()); };
  }, []);
  const requestToken = useCallback(async (providerSession?: GoogleProviderSession) => {
    const { userId: owner, isOffline, getAuthToken } = current.current;
    const generation = epoch.current;
    const valid = () => active.current && generation === epoch.current && current.current.userId === owner && !current.current.isOffline;
    if (!owner || isOffline) throw new Error('Connect Google Calendar with a signed-in account.');
    const authToken = providerSession?.authToken ?? await getAuthToken();
    if (!authToken || !valid()) throw new Error('Your Calendar session changed.');
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    let handled = false;
    try {
      const response = await fetch(providerSession ? '/api/google/connect' : '/api/google/token', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}`, ...(providerSession ? { 'Content-Type': 'application/json' } : {}) },
        ...(providerSession ? { body: JSON.stringify({ provider_refresh_token: providerSession.refreshToken }) } : {}),
        cache: 'no-store', signal: controller.signal,
      });
      if (!valid()) throw new Error('Your Calendar session changed.');
      const data = await response.json();
      if (!valid()) throw new Error('Your Calendar session changed.');
      if (!response.ok) {
        if (response.status === 401 || response.status === 404) {
          handled = true; canRestore.current = false; cache.current = null;
          setStatus({ owner, connected: false, token: null, error: response.status === 404 ? null : 'Reconnect Google Calendar and allow Calendar access.' });
        }
        throw new Error(response.status === 401 || response.status === 404 ? 'Reconnect Google Calendar and allow Calendar access.' : 'Google Calendar is temporarily unavailable. Please try again.');
      }
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('Invalid Calendar token response.');
      canRestore.current = true;
      cache.current = { owner, value: data.access_token, expiresAt: Date.now() + Math.max(0, data.expires_in * 1000 - 60000) };
      setStatus({ owner, connected: true, token: data.access_token, error: null });
      return data.access_token as string;
    } catch (error) {
      if (valid() && !handled) setStatus(previous => ({ ...previous, owner, error: 'Google Calendar could not sync. Try again or reconnect Calendar.' }));
      throw error;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }, []);
  const getGoogleAccessToken = useCallback((forceRefresh = false): Promise<string> => {
    if (disconnecting.current || !current.current.userId || current.current.isOffline) return Promise.reject(new Error('Connect Google Calendar with a signed-in account.'));
    if (connecting.current) return connecting.current;
    if (forceRefresh) cache.current = null;
    if (!forceRefresh && cache.current?.owner === current.current.userId && cache.current.expiresAt > Date.now()) return Promise.resolve(cache.current.value);
    if (pending.current) return pending.current;
    const promise = requestToken(); pending.current = promise;
    void promise.finally(() => { if (pending.current === promise) pending.current = null; }).catch(() => {});
    return promise;
  }, [requestToken]);
  // Restore the private server-side connection after reload, sign-in or account change.
  useEffect(() => {
    disconnecting.current = false; reset();
    if (!options.userId || options.isOffline) return;
    if (options.providerSession?.userId === options.userId && seenSession.current !== options.providerSession) return; // connect effect below
    void getGoogleAccessToken().catch(() => {});
  }, [options.userId, options.isOffline, reset, getGoogleAccessToken]);
  useEffect(() => {
    const session = options.providerSession;
    if (disconnecting.current || !session || options.isOffline || session.userId !== options.userId || (seenSession.current?.userId === session.userId && seenSession.current?.refreshToken === session.refreshToken)) return;
    seenSession.current = session;
    const promise = requestToken(session); connecting.current = promise;
    void promise.then(() => {
      try { sessionStorage.removeItem(GOOGLE_CONNECT_PENDING); } catch { /* storage unavailable */ }
    }).catch(() => { if (seenSession.current === session) seenSession.current = null; }).finally(() => { if (connecting.current === promise) connecting.current = null; });
  }, [options.providerSession, options.userId, options.isOffline, requestToken]);
  useEffect(() => {
    const focus = () => {
      if (canRestore.current && (!cache.current || cache.current.expiresAt <= Date.now())) void getGoogleAccessToken().catch(() => {});
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [getGoogleAccessToken]);
  const disconnectGoogleCalendar = useCallback(async () => {
    const { userId: owner, isOffline, getAuthToken } = current.current;
    if (!owner || isOffline) return;
    // Finish any credential upload before DELETE so a late upload cannot reconnect.
    if (disconnecting.current) return;
    disconnecting.current = true;
    const upload = connecting.current;
    reset(); canRestore.current = false;
    try { sessionStorage.removeItem(GOOGLE_CONNECT_PENDING); } catch { /* storage unavailable */ }
    try {
      await upload?.catch(() => {});
      if (current.current.userId !== owner || current.current.isOffline) return;
      const authToken = await getAuthToken();
      if (!authToken || current.current.userId !== owner) throw new Error('Sign in again to disconnect Calendar.');
      const response = await fetch('/api/google/token', { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` }, cache: 'no-store' });
      if (!response.ok) throw new Error('Could not disconnect Google Calendar. Please try again.');
    } catch {
      if (current.current.userId === owner && !current.current.isOffline) setStatus({ owner, connected: true, token: null, error: 'Could not disconnect Google Calendar. Please try again.' });
      throw new Error('Could not disconnect Google Calendar. Please try again.');
    } finally { disconnecting.current = false; }
  }, [reset]);
  const visible = status.owner === options.userId && !options.isOffline;
  return { accessToken: visible ? status.token : null, googleConnected: visible && status.connected, googleCalendarError: visible ? status.error : null, getGoogleAccessToken, disconnectGoogleCalendar };
}
