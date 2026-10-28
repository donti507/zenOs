import {tr,useUiLanguage} from '../i18n';
import { useEffect, useMemo, useRef, useState } from "react";
import { useZenos } from "../context/ZenosContext";
import type { SpaceSnapshot } from "../../shared/space";
import { spaceBridgeData, spaceSrcdoc } from "../lib/spaceSandbox";
import { btn } from "./ui/kit";
export default function SpaceFrame({ snapshot, widgetSize, publicPreview = false }: { snapshot: SpaceSnapshot; widgetSize?: "small" | "medium"; publicPreview?: boolean }) {
  useUiLanguage();
  const { state, stateRef, googleEvents, user, checkSpaceAccess } = useZenos();
  const events = useRef(googleEvents);
  events.current = googleEvents;
  const frame = useRef<HTMLIFrameElement>(null);
  const verified = useRef(false);
  const attempts = useRef(0);
  const loadEpoch = useRef(0);
  const lastRequest = useRef({ at: 0, count: 0 });
  const probes = useRef<Set<MessagePort>>(new Set());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [reload, setReload] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const identity = `${state.workspaceId}:${publicPreview}:${user?.id}:${snapshot.page.id}:${snapshot.version.id}:${snapshot.page.updatedAt}:${snapshot.page.permissions.tasks}:${snapshot.page.permissions.events}:${state.theme}:${reload}`;
  const token = useMemo(() => crypto.randomUUID(), [identity]);
  const doc = useMemo(
    () => spaceSrcdoc(snapshot.version, token, state.theme === "dark"),
    [snapshot.version, token, state.theme],
  );
  const current = useRef({ snapshot, token });
  current.current = { snapshot, token };
  const close = () => {
    ++loadEpoch.current;
    verified.current = false;
    for (const port of probes.current) port.close();
    probes.current.clear();
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
  };
  useEffect(() => {
    setBlocked(false);
    verified.current = false;
    attempts.current = 0;
    lastRequest.current = { at: 0, count: 0 };
    const receive = async (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "zen:read"
      )
        return;
      const port = event.ports[0];
      if (event.ports.length !== 1 || !port) return;
      const message = event.data;
      const active = current.current;
      const activeEpoch = loadEpoch.current;
      const method = message.method;
      if (
        !verified.current ||
        message.token !== active.token ||
        !["tasks", "events"].includes(method)
      ) {
        port.close();
        return;
      }
      const now = Date.now();
      if (now - lastRequest.current.at > 1000)
        lastRequest.current = { at: now, count: 0 };
      const allowed =
        !publicPreview && !stateRef.current.workspaceId && active.snapshot.page.permissions[method as "tasks" | "events"];
      if (++lastRequest.current.count > 10 || !allowed) {
        port.postMessage({
          ok: false,
          error: !allowed
            ? (publicPreview ? "Public gallery pages cannot access workspace data." : "Grant this page permission in My Space first.")
            : "Too many bridge requests. Try again shortly.",
        });
        port.close();
        return;
      }
      probes.current.add(port);
      try {
        const granted = await checkSpaceAccess(
          active.snapshot.page.id,
          active.snapshot.version.id,
          method,
        );
        if (
          !!stateRef.current.workspaceId ||
          current.current.token !== active.token ||
          loadEpoch.current !== activeEpoch ||
          !verified.current ||
          event.source !== frame.current?.contentWindow
        )
          return;
        port.postMessage(
          granted
            ? {
                ok: true,
                data: spaceBridgeData(method, stateRef.current, events.current),
              }
            : {
                ok: false,
                error:
                  "Access changed. Refresh the page and grant this version permission.",
              },
        );
      } catch {
        /* No data on a permission/storage failure. */
      } finally {
        probes.current.delete(port);
        port.close();
      }
    };
    window.addEventListener("message", receive);
    return () => {
      close();
      window.removeEventListener("message", receive);
    };
  }, [token, checkSpaceAccess]);
  const loaded = () => {
    close();
    verified.current = false;
    if (++attempts.current > 2) {
      setBlocked(true);
      return;
    }
    const channel = new MessageChannel();
    probes.current.add(channel.port1);
    const activeToken = token;
    const activeEpoch = loadEpoch.current;
    const timeout = setTimeout(() => {
      probes.current.delete(channel.port1);
      channel.port1.close();
      if (current.current.token === activeToken && loadEpoch.current === activeEpoch) setBlocked(true);
    }, 2500);
    timers.current.add(timeout);
    channel.port1.onmessage = (event) => {
      if (current.current.token !== activeToken || loadEpoch.current !== activeEpoch) return;
      if (event.data?.token !== activeToken) {
        setBlocked(true);
        return;
      }
      clearTimeout(timeout);
      timers.current.delete(timeout);
      probes.current.delete(channel.port1);
      verified.current = true;
      channel.port1.postMessage({ ok: true });
      channel.port1.close();
    };
    frame.current?.contentWindow?.postMessage({ type: "zen:probe" }, "*", [
      channel.port2,
    ]);
  };
  return (
    <section className="space-y-2 min-w-0" aria-label={tr("Sandboxed page preview")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{tr("Preview")}</h2>
        <button
          className={btn.secondary}
          onClick={() => {
            close();
            setReload((value) => value + 1);
          }}
        >{tr("Reload preview")}</button>
      </div>
      {blocked ? (
        <p
          role="alert"
          className="p-5 rounded-xl bg-error-container text-error"
        >{tr("The preview could not verify its sandbox session or navigated away. Reload it to continue.")}</p>
      ) : (
        <iframe
          key={token}
          ref={frame}
          title={tr("My Space preview: {{0}}",snapshot.page.title)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; fullscreen 'none'"
          srcDoc={doc}
          onLoad={loaded}
          className={`w-full ${widgetSize === "small" ? "h-64" : widgetSize === "medium" ? "h-96" : "h-[60dvh] min-h-80"} rounded-xl border border-outline-variant bg-surface-container-lowest`}
        />
      )}
      <p className="text-xs text-on-surface-variant">
        {publicPreview ? tr("Public sandbox · No app, account, token or workspace data access.") : tr("Private sandbox · No app, account or token access. Data access is off unless you grant it in the page editor.")}
      </p>
    </section>
  );
}
