export const SPACE_LIMITS = {
  html: 24000,
  css: 16000,
  js: 24000,
  prompt: 2000,
  reply: 2000,
  explanation: 1200,
} as const;
export type SpaceCode = { html: string; css: string; js: string };
export type SpacePermissions = { tasks: boolean; events: boolean };
export type RemixCredit = {id:string;title:string;author:string;original?:{id:string;title:string;author:string}};
export type SpacePage = {
  remixSource?: RemixCredit | null;
  id: string;
  slug: string;
  title: string;
  dashboardSize?: "small" | "medium" | null;
  dashboardOrder?: number;
  currentVersionId: string;
  permissions: SpacePermissions;
  createdAt: string;
  updatedAt: string;
};
export type SpaceVersion = SpaceCode & {
  id: string;
  pageId: string;
  kind: "initial" | "ai" | "restore";
  prompt: string;
  reply: string;
  model: string;
  explanation?: string;
  parentVersionId?: string | null;
  restoredFrom: string | null;
  createdAt: string;
};
export type SpaceVersionInfo = Omit<SpaceVersion, "html" | "css" | "js">;
export type SpaceSnapshot = { page: SpacePage; version: SpaceVersion };
export const noSpacePermissions = (): SpacePermissions => ({
  tasks: false,
  events: false,
});
export const isSpaceId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function spaceText(
  value: unknown,
  max: number,
  label: string,
  empty = false,
) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    Array.from(value).length > max ||
    value.includes("\0")
  )
    throw new Error(`Invalid ${label}.`);
  return empty ? value : value.trim();
}
export function spaceSlug(value: unknown) {
  const slug = spaceText(value, 48, "page address");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(
      "Use lowercase letters, numbers and single hyphens for the page address.",
    );
  return slug;
}
export function spaceCode(value: any): SpaceCode {
  return {
    html: spaceText(value?.html, SPACE_LIMITS.html, "HTML", true),
    css: spaceText(value?.css, SPACE_LIMITS.css, "CSS", true),
    js: spaceText(value?.js, SPACE_LIMITS.js, "JavaScript", true),
  };
}
export function spacePermissions(value: any): SpacePermissions {
  if (
    !value ||
    typeof value.tasks !== "boolean" ||
    typeof value.events !== "boolean"
  )
    throw new Error("Invalid page permissions.");
  return { tasks: value.tasks, events: value.events };
}
export function spacePageFromRow(value: any): SpacePage {
  const id = value?.id,
    version = value?.current_version_id ?? value?.currentVersionId;
  const created = value?.created_at ?? value?.createdAt,
    updated = value?.updated_at ?? value?.updatedAt;
  if (
    !isSpaceId(id) ||
    !isSpaceId(version) ||
    !Number.isFinite(Date.parse(created)) ||
    !Number.isFinite(Date.parse(updated))
  )
    throw new Error("Invalid page.");
  return {
    id,
    slug: spaceSlug(value.slug),
    title: spaceText(value.title, 80, "page title"),
    dashboardSize: ["small", "medium"].includes(value.dashboard_size ?? value.dashboardSize) ? (value.dashboard_size ?? value.dashboardSize) : null,
    dashboardOrder: Number.isSafeInteger(value.dashboard_order ?? value.dashboardOrder) ? (value.dashboard_order ?? value.dashboardOrder) : 0,
    remixSource: remixCredit(value.remix_source ?? value.remixSource),
    currentVersionId: version,
    permissions: spacePermissions(value.permissions),
    createdAt: created,
    updatedAt: updated,
  };
}
export function spaceVersionFromRow(
  value: any,
  metadata = false,
): SpaceVersion {
  const id = value?.id,
    pageId = value?.page_id ?? value?.pageId,
    created = value?.created_at ?? value?.createdAt,
    restored = value?.restored_from ?? value?.restoredFrom ?? null;
  const parent = value?.parent_version_id ?? value?.parentVersionId ?? null;
  if (
    (parent !== null && !isSpaceId(parent)) ||
    !isSpaceId(id) ||
    !isSpaceId(pageId) ||
    !["initial", "ai", "restore"].includes(value.kind) ||
    !Number.isFinite(Date.parse(created)) ||
    (restored !== null && !isSpaceId(restored))
  )
    throw new Error("Invalid page version.");
  return {
    ...(metadata ? { html: "", css: "", js: "" } : spaceCode(value)),
    id,
    pageId,
    kind: value.kind,
    prompt: spaceText(
      value.prompt ?? "",
      SPACE_LIMITS.prompt,
      "edit prompt",
      true,
    ),
    reply: spaceText(value.reply ?? "", SPACE_LIMITS.reply, "edit reply", true),
    model: spaceText(value.model ?? "", 120, "model", true),
    explanation: spaceText(value.explanation ?? "", SPACE_LIMITS.explanation, "explanation", true),
    parentVersionId: parent,
    restoredFrom: restored,
    createdAt: created,
  };
}
export function spaceSnapshot(value: any): SpaceSnapshot {
  const page = spacePageFromRow(value?.page),
    version = spaceVersionFromRow(value?.version);
  if (version.pageId !== page.id || version.id !== page.currentVersionId)
    throw new Error("Invalid current page version.");
  return { page, version };
}
export const initialSpaceCode: SpaceCode = {
  html: "<main><h1>Your space</h1><p>Describe what you want to build in the chat.</p></main>",
  css: "main { max-width: 60rem; margin: auto; padding: 2rem; }",
  js: "",
};

export type SpaceWidgetAction = "small" | "medium" | "unpin" | "earlier" | "later";
export function arrangeSpaceWidgets(pages: SpacePage[], id: string, action: SpaceWidgetAction): SpacePage[] {
  if (!["small", "medium", "unpin", "earlier", "later"].includes(action)) throw new Error("Invalid widget action.");
  const target = pages.find(page => page.id === id);
  if (!target) throw new Error("Page not found.");
  const pinned = pages.filter(page => page.dashboardSize).sort((a,b) => (a.dashboardOrder ?? 0)-(b.dashboardOrder ?? 0) || a.id.localeCompare(b.id));
  if (action === "earlier" || action === "later") {
    const index = pinned.findIndex(page => page.id === id);
    if (index < 0) throw new Error("Page is not pinned.");
    const next = index + (action === "earlier" ? -1 : 1);
    if (next >= 0 && next < pinned.length) [pinned[index],pinned[next]] = [pinned[next],pinned[index]];
  } else if (action !== "unpin" && !target.dashboardSize) pinned.push(target);
  return pages.map(page => ({...page,
    dashboardSize: page.id === id ? action === "unpin" ? null : action === "small" || action === "medium" ? action : page.dashboardSize : page.dashboardSize,
    dashboardOrder: Math.max(0,pinned.findIndex(item => item.id === page.id)),
  }));
}

export function remixCredit(value:any):RemixCredit|null {
 if(value==null)return null;
 if(!isSpaceId(value.id))throw new Error('Invalid remix credit.');
 const credit:RemixCredit={id:value.id,title:spaceText(value.title,80,'original title'),author:spaceText(value.author,40,'original author')};
 if(value.original!=null){if(!isSpaceId(value.original.id))throw new Error('Invalid original credit.');credit.original={id:value.original.id,title:spaceText(value.original.title,80,'original title'),author:spaceText(value.original.author,40,'original author')};}
 return credit;
}
