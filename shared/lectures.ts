export const MAX_LECTURE_SECONDS = 3600;
export const MAX_LECTURE_BYTES = 1_000_000_000;
export const MAX_LECTURE_CHUNK_BYTES = 10_000_000;
export const MAX_TRANSCRIPT_CHARS = 200_000;
export type LectureCard = { question: string; answer: string; known: boolean | null };
export type LectureAction = { title: string; taskId: string | null };
export type LectureNotes = { summary: string; keyPoints: string[]; flashcards: LectureCard[]; actionItems: LectureAction[] };
export type Lecture = LectureNotes & { id: string; title: string; durationSeconds: number; transcript: string; createdAt: string };
export type LectureProgress = { stage: 'uploading' | 'transcribing' | 'analyzing' | 'saving'; completed?: number; total?: number; message: string };
export function lectureText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw new Error(`Invalid ${label}.`);
  return value.trim();
}
export function parseLectureNotes(raw: any): LectureNotes {
  const points = raw?.key_points ?? raw?.keyPoints;
  const actions = raw?.action_items ?? raw?.actionItems;
  if (!Array.isArray(points) || points.length < 1 || points.length > 20 || !Array.isArray(raw?.flashcards) || raw.flashcards.length !== 10 || !Array.isArray(actions) || actions.length > 20) throw new Error('Expected key points, exactly 10 flashcards and action items.');
  return { summary: lectureText(raw.summary, 4000, 'summary'), keyPoints: points.map(p => lectureText(p, 500, 'key point')),
    flashcards: raw.flashcards.map((c: any) => {
      if (c.known !== undefined && c.known !== null && typeof c.known !== 'boolean') throw new Error('Invalid card review state.');
      return { question: lectureText(c.question, 300, 'question'), answer: lectureText(c.answer, 1000, 'answer'), known: c.known ?? null };
    }),
    actionItems: actions.map((a: any) => ({ title: lectureText(typeof a === 'string' ? a : a?.title, 200, 'action item'), taskId: typeof (a?.task_id ?? a?.taskId) === 'string' ? lectureText(a.task_id ?? a.taskId, 64, 'task ID') : null })),
  };
}
export function lectureFromRow(row: any, metadataOnly = false): Lecture {
  const duration = Number(row?.duration_seconds ?? row?.durationSeconds);
  const createdAt = row?.created_at ?? row?.createdAt;
  if (typeof row?.id !== 'string' || !row.id || !Number.isFinite(duration) || duration <= 0 || duration > MAX_LECTURE_SECONDS || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid lecture metadata.');
  return { ...parseLectureNotes(row), id: row.id, title: lectureText(row.title, 200, 'title'), durationSeconds: duration, createdAt,
    transcript: metadataOnly && !row.transcript ? '' : lectureText(row.transcript, MAX_TRANSCRIPT_CHARS, 'transcript') };
}
export function lectureToRow(lecture: Lecture) {
  return { id: lecture.id, title: lecture.title, duration_seconds: lecture.durationSeconds, transcript: lecture.transcript, summary: lecture.summary, key_points: lecture.keyPoints,
    flashcards: lecture.flashcards, action_items: lecture.actionItems.map(a => ({ title: a.title, task_id: a.taskId })), created_at: lecture.createdAt };
}
