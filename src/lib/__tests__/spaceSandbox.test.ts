// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  sanitizeSpaceHtml,
  spaceSrcdoc,
  spaceBridgeData,
  SPACE_CSP,
} from "../spaceSandbox";
import type { ZenosState } from "../../types";
it("removes active/foreign markup, refresh/base tags, handlers and network attributes before constructing srcdoc", () => {
  const html = sanitizeSpaceHtml(
    '<meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil"><script>parent.hacked=true</script><iframe src="https://evil"></iframe><svg><script>alert(1)</script></svg><div onclick="alert(1)"><a href="javascript:alert(1)">Hi</a><img src="https://evil/x" srcset="https://evil/y"><button id="ok">OK</button></div>',
  );
  expect(html).not.toMatch(
    /<script|<iframe|<svg|<meta|<base|onclick|javascript:|https:/,
  );
  expect(html).toContain('id="ok"');
  expect(html).toContain('type="button"');
  const doc = spaceSrcdoc(
    {
      html: "<h1>Safe</h1>",
      css: '</style><iframe src="https://evil">',
      js: 'const text="</script><iframe src=x>";',
    },
    "10000000-0000-0000-0000-000000000001",
    true,
  );
  expect(doc.startsWith("<!doctype html>")).toBe(true);
  expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(
    doc.indexOf("<script>"),
  );
  expect(doc).not.toContain("</script><iframe");
  expect(doc).not.toContain("</style><iframe");
  expect(SPACE_CSP).toContain("connect-src 'none'");
  expect(SPACE_CSP).not.toContain("unsafe-eval");
  expect(SPACE_CSP).not.toContain("https:");
});
it("shares only allowlisted task/event fields, never notes, identity, cookies or tokens", () => {
  const state = {
    tasks: [
      {
        id: 1,
        title: "Task",
        status: "todo",
        date: "2026-10-27",
        progress: 40,
        note: "PRIVATE_NOTE",
        user_id: "PRIVATE_OWNER",
        token: "PRIVATE_TOKEN",
      },
    ],
    meetings: [
      {
        id: "m",
        subject: "Meeting",
        personName: "PRIVATE_PERSON",
        date: "2026-10-27",
        time: "10:00",
        notes: "PRIVATE_NOTES",
      },
    ],
  } as unknown as ZenosState;
  const tasks = spaceBridgeData("tasks", state, []);
  expect(tasks).toEqual([
    {
      id: "1",
      title: "Task",
      status: "todo",
      date: "2026-10-27",
      progress: 40,
    },
  ]);
  const events = spaceBridgeData("events", state, [
    {
      id: "g",
      summary: "Calendar",
      start: { date: "2026-10-28" },
      description: "PRIVATE",
      access_token: "PRIVATE",
    },
  ]);
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
  expect(events).toHaveLength(2);
});
