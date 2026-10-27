import type { ZenosState } from "../types";
import { readSearchSource, type SearchSource } from "../../shared/search";
export function localSearchSources(state: ZenosState): SearchSource[] {
  const rows: SearchSource[] = [];
  const add = (
    sourceType: SearchSource["sourceType"],
    sourceId: string | number,
    title: string,
    content: string,
  ) => {
    try {
      rows.push(
        readSearchSource({
          sourceType,
          sourceId: String(sourceId),
          title: (title || "Untitled").slice(0, 200),
          content: content.slice(0, 500000),
        }),
      );
    } catch {}
  };
  for (const row of state.tasks)
    if (row.note?.trim())
      add("task", row.id, row.title, `Task: ${row.title}\nNotes: ${row.note}`);
  for (const row of state.meetings || [])
    if (row.notes?.trim())
      add(
        "meeting",
        row.id,
        `${row.personName}: ${row.subject}`,
        `Meeting with ${row.personName} on ${row.date}: ${row.subject}\nNotes: ${row.notes}`,
      );
  for (const row of state.vault)
    add(
      "vault",
      row.id,
      row.name,
      [row.name, row.detail, row.url].filter(Boolean).join("\n"),
    );
  for (const row of state.lectures || [])
    add(
      "lecture",
      row.id,
      row.title,
      `Lecture: ${row.title}\nSummary: ${row.summary}`,
    );
  return rows;
}
