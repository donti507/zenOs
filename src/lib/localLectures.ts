import { lectureFromRow, type Lecture } from '../../shared/lectures';
const DATABASE = 'zenos-lectures';
async function open() {
  if (typeof indexedDB === 'undefined') throw new Error('Lecture storage is unavailable in this browser.');
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('lectures', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open local lecture storage.'));
    request.onblocked = () => reject(new Error('Close other ZEN OS tabs to update lecture storage.'));
  });
}
export async function localLectures(): Promise<Lecture[]> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readonly'); const request = tx.objectStore('lectures').getAll();
    tx.oncomplete = () => { try { resolve(request.result.map(row => lectureFromRow(row)).sort((a,b) => b.createdAt.localeCompare(a.createdAt))); } catch { reject(new Error('Could not read local lectures.')); } };
    tx.onerror = () => reject(new Error('Could not read local lectures.')); tx.onabort = tx.onerror;
  }); } finally { db.close(); }
}
export async function changeLocalLecture(id: string, change: (existing: Lecture | null) => Lecture): Promise<Lecture> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('lectures','readwrite'); const store = tx.objectStore('lectures'); const request = store.get(id); let saved: Lecture;
    request.onsuccess = () => { try { saved = lectureFromRow(change(request.result ? lectureFromRow(request.result) : null)); store.put(saved); } catch { tx.abort(); } };
    tx.oncomplete = () => resolve(saved);
    tx.onabort = tx.onerror = () => reject(new Error('Could not save this lecture. Check browser storage and try again.'));
  }); } finally { db.close(); }
}
