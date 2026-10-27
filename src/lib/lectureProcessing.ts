import { lectureFromRow, lectureText, MAX_LECTURE_BYTES, type Lecture, type LectureProgress } from '../../shared/lectures';
export type LectureSession = { job?: { id: string; chunks: number; durationSeconds: number }; authorization?: string };
export async function disposeLectureSession(session: LectureSession) {
  if (!session.job) return;
  const id = session.job.id; session.job = undefined;
  await fetch(`/api/lectures/${encodeURIComponent(id)}`, { method: 'DELETE', headers: session.authorization ? { Authorization: session.authorization } : {}, keepalive: true }).catch(() => {});
}
export async function processLectureAudio(options: { file: Blob; title: string; language?: string; session: LectureSession; getToken: () => Promise<string | null>; signal: AbortSignal; progress: (value: LectureProgress) => void }): Promise<Lecture> {
  const { file, session, signal, progress } = options;
  const title = lectureText(options.title, 200, 'title');
  if (!file.size || file.size > MAX_LECTURE_BYTES) throw new Error('Choose audio up to 60 minutes and under 1 GB.');
  const headers = async () => {
    const token = await options.getToken(); if (signal.aborted) throw new DOMException('Canceled','AbortError');
    session.authorization = token ? `Bearer ${token}` : undefined;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const json = async (response: Response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Lecture processing is unavailable. Please try again.'); return data; };
  if (!session.job) {
    progress({ stage:'uploading',message:'Uploading and preparing audio…' });
    const response = await fetch('/api/lectures/prepare', { method:'POST',headers:{...await headers(),'Content-Type':file.type?.split(';')[0] || 'application/octet-stream'},body:file,signal });
    const data = await json(response);
    if (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.id) || !Number.isInteger(data.chunks) || data.chunks < 1 || data.chunks > 16 || !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0 || data.durationSeconds > 3600) throw new Error('Invalid audio preparation response.');
    session.job = data;
  }
  const job = session.job;
  for (let index=0;index<job.chunks;index++) {
    progress({stage:'transcribing',completed:index,total:job.chunks,message:`Transcribing section ${index+1} of ${job.chunks}…`});
    await json(await fetch(`/api/lectures/${job.id}/transcribe/${index}?lang=${encodeURIComponent(options.language || '')}`,{method:'POST',headers:await headers(),signal}));
  }
  progress({stage:'analyzing',message:'Creating study notes…'});
  const response = await fetch(`/api/lectures/${job.id}/analyze`,{method:'POST',headers:await headers(),signal});
  if (!response.ok) await json(response);
  if (!response.body) throw new Error('Empty lecture analysis response.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending=''; let lecture: Lecture | null=null;
  try {
    while (true) {
      const {done,value}=await reader.read(); pending+=decoder.decode(value || new Uint8Array(),{stream:!done});
      if (pending.length>2_000_000) throw new Error('Lecture response is too large.');
      const lines=pending.split('\n');pending=lines.pop() || '';if(done&&pending){lines.push(pending);pending='';}
      for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);
        if(event.type==='error')throw new Error(typeof event.error==='string'?event.error:'Could not analyze this lecture.');
        if(event.type==='progress')progress({stage:'analyzing',completed:event.completed,total:event.total,message:typeof event.message==='string'?event.message:'Creating study notes…'});
        if(event.type==='result')lecture=lectureFromRow({...event.lecture,title});
      }
      if(done)break;
    }
  } finally { reader.releaseLock(); }
  if(signal.aborted)throw new DOMException('Canceled','AbortError');
  if(!lecture)throw new Error('Lecture processing did not finish. Retry to continue.');
  return lecture;
}
