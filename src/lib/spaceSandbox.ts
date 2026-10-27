import { spaceCode, type SpaceCode } from "../../shared/space";
import type { ZenosState } from "../types";
export const SPACE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
const tags = new Set(
  "main section article aside header footer nav div span p h1 h2 h3 h4 h5 h6 strong b em i u s small mark code pre blockquote br hr ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col a button input textarea select option optgroup label fieldset legend progress meter canvas img details summary time figure figcaption form".split(
    " ",
  ),
);
const attributes = new Set(
  "id class style role title type value name placeholder checked selected disabled readonly multiple min max step rows cols width height alt for tabindex colspan rowspan scope open datetime autocomplete".split(
    " ",
  ),
);
/** An inert template is parsed and serialized, never attached to the app DOM. */
export function sanitizeSpaceHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const stack = Array.from(template.content.childNodes).map((node) => ({
    node,
    depth: 0,
  }));
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.parentNode?.removeChild(node);
      continue;
    }
    const el = node as HTMLElement;
    if (
      depth > 50 ||
      el.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      !tags.has(el.localName)
    ) {
      el.remove();
      continue;
    }
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name === "href" && el.localName === "a" && /^#[\w-]*$/.test(value))
        continue;
      if (
        name === "src" &&
        el.localName === "img" &&
        /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
      )
        continue;
      if (
        attributes.has(name) ||
        /^aria-[a-z-]+$/.test(name) ||
        /^data-[a-z0-9-]+$/.test(name)
      )
        continue;
      el.removeAttribute(attribute.name);
    }
    if (el.localName === "button" && !el.hasAttribute("type"))
      el.setAttribute("type", "button");
    for (const child of Array.from(el.childNodes))
      stack.push({ node: child, depth: depth + 1 });
  }
  return template.innerHTML;
}
/** Self-contained: serialized into srcdoc and removed before any generated code. */
function bridgeBootstrap(token: string) {
  "use strict";
  const nativeSend = parent.postMessage.bind(parent);
  const postPort = Function.prototype.call.bind(
    MessagePort.prototype.postMessage,
  ) as (port: MessagePort, data: unknown) => void;
  const closePort = Function.prototype.call.bind(
    MessagePort.prototype.close,
  ) as (port: MessagePort) => void;
  const Channel = MessageChannel;
  const PromiseType = Promise;
  const setTimer = setTimeout.bind(window);
  const clearTimer = clearTimeout.bind(window);
  document.currentScript?.remove();
  let readyResolve!: () => void;
  const ready = new PromiseType<void>((resolve) => {
    readyResolve = resolve;
  });
  window.addEventListener(
    "message",
    (event) => {
      if (
        !event.isTrusted ||
        event.source !== parent ||
        event.data?.type !== "zen:probe" ||
        event.ports.length !== 1
      )
        return;
      const port = event.ports[0];
      const timeout = setTimer(() => closePort(port), 5000);
      port.onmessage = (reply) => {
        if (reply.isTrusted && reply.data?.ok === true) {
          clearTimer(timeout);
          readyResolve();
          closePort(port);
        }
      };
      postPort(port, { token });
    },
    true,
  );
  const read = (method: "tasks" | "events") =>
    new PromiseType<unknown[]>((resolve, reject) => {
      let channel: MessageChannel | undefined;
      const timeout = setTimer(() => {
        if (channel) closePort(channel.port1);
        reject(new Error("The page bridge is unavailable."));
      }, 10000);
      ready.then(() => {
        channel = new Channel();
        channel.port1.onmessage = (event) => {
          if (!event.isTrusted) return;
          clearTimer(timeout);
          closePort(channel!.port1);
          if (event.data?.ok === true && Array.isArray(event.data.data))
            resolve(event.data.data);
          else
            reject(
              new Error(
                typeof event.data?.error === "string"
                  ? event.data.error
                  : "Page permission required.",
              ),
            );
        };
        nativeSend({ type: "zen:read", token, method }, "*", [channel.port2]);
      });
    });
  Object.defineProperty(window, "zen", {
    value: Object.freeze({
      tasks: () => read("tasks"),
      events: () => read("events"),
    }),
    writable: false,
    configurable: false,
  });
}
export function spaceSrcdoc(raw: SpaceCode, token: string, dark: boolean) {
  const code = spaceCode(raw);
  if (!/^[a-z0-9-]{20,80}$/i.test(token))
    throw new Error("Invalid sandbox session.");
  const html = sanitizeSpaceHtml(code.html);
  const script = (source: string) =>
    source.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
  const css = code.css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SPACE_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>:root{color-scheme:${dark ? "dark" : "light"};--background:${dark ? "#111115" : "#f8f8fc"};--foreground:${dark ? "#f1f0fa" : "#1b1b21"};--primary:${dark ? "#c4b5fd" : "#5b5fef"};--surface:${dark ? "#1c1b22" : "#ffffff"}}*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font-family:system-ui,sans-serif}button,input,select,textarea{font:inherit}img,canvas{max-width:100%}${css}</style><script>${script(`(${bridgeBootstrap.toString()})(${JSON.stringify(token)})`)}</script></head><body>${html}<script>${script(code.js)}</script></body></html>`;
}
export function spaceBridgeData(
  method: "tasks" | "events",
  state: ZenosState,
  googleEvents: any[],
) {
  const text = (value: unknown, max = 200) =>
    typeof value === "string" ? value.slice(0, max) : "";
  if (method === "tasks")
    return [
      ...state.tasks.filter((row) => row.status !== "done"),
      ...state.tasks.filter((row) => row.status === "done"),
    ]
      .slice(0, 200)
      .map((row) => ({
        id: String(row.id).slice(0, 80),
        title: text(row.title),
        status: ["todo", "inprogress", "done"].includes(row.status)
          ? row.status
          : "todo",
        date: text(row.date, 10),
        progress: Number.isFinite(row.progress)
          ? Math.max(0, Math.min(100, row.progress))
          : 0,
      }));
  return [
    ...(state.meetings || []).map((row) => ({
      id: String(row.id).slice(0, 80),
      title: text(row.subject),
      start: [text(row.date, 10), text(row.time, 8)].filter(Boolean).join("T"),
      end: "",
      source: "meeting",
    })),
    ...googleEvents.map((row) => ({
      id: text(row.id, 80),
      title: text(row.summary),
      start: text(row.start?.dateTime || row.start?.date, 40),
      end: text(row.end?.dateTime || row.end?.date, 40),
      source: "calendar",
    })),
  ].slice(0, 200);
}
