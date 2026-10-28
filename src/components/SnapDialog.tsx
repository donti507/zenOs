import {tr,useUiLanguage,quantity} from '../i18n';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useZenos } from '../context/ZenosContext';
import { SNAP_TYPES, snapItemError } from '../../shared/snap';
import { createReviewedItems, extractSnap, type SnapRow } from '../lib/snap';
import { prepareSnapFile, SNAP_ACCEPT } from '../lib/snapFile';
import { Modal, Field, btn, input } from './ui/kit';

export default function SnapDialog({ onClose }: { onClose: () => void }) {
  useUiLanguage();
  const { user, getAuthToken, addTask, addMeeting, state } = useZenos();
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SnapRow[] | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'extract' | 'create' | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  const owner = useRef(user?.id); owner.current = user?.id;
  const running = useRef(false);
  const reading = useRef(false);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const prepare = async (next: File, number: number) => {
    if (running.current) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const id = ++operation.current;
    setFile(next); setPage(number); setRows(null); setImage(null); setError(''); setBusy('prepare');
    try {
      const result = await prepareSnapFile(next, number, abort.signal);
      if (active.current && id === operation.current) { setImage(result.image); setPages(result.pages); }
    } catch (err: any) { if (active.current && id === operation.current && err?.name !== 'AbortError') setError(err.message || 'Could not open this page. Try an unlocked PDF or a photo.'); }
    finally { if (active.current && id === operation.current) setBusy(null); }
  };
  const extract = async () => {
    if (!image || busy || running.current || reading.current) return;
    reading.current = true;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const id = ++operation.current; const userId = owner.current;
    setBusy('extract'); setError(''); setRows(null);
    try {
      const token = await getAuthToken();
      if (!active.current || owner.current !== userId) return;
      const items = await extractSnap(image, token, abort.signal);
      if (active.current && owner.current === userId && id === operation.current) setRows(items.map(item => ({ ...item, selected: true })));
    } catch (err: any) { if (active.current && err?.name !== 'AbortError' && id === operation.current) setError(err.message || 'Could not read this page.'); }
    finally { reading.current = false; if (active.current && id === operation.current) setBusy(null); }
  };
  const create = async () => {
    if (!rows || busy || running.current) return;
    running.current = true; setBusy('create'); setError('');
    const userId = owner.current;
    try {
      await createReviewedItems(rows, { addTask, addMeeting, category: state.categories.find(category => category.id === 'other' || category.label.toLowerCase() === 'other')?.id || state.categories[0]?.id || 'other',
        canContinue: () => active.current && owner.current === userId,
        onResult: (index, failure) => setRows(current => current?.map((row, i) => i !== index ? row : { ...row, saved: !failure, selected: !!failure, error: failure || undefined }) || null),
      });
    } finally { running.current = false; if (active.current) setBusy(null); }
  };
  const edit = (index: number, patch: Partial<SnapRow>) => setRows(current => current?.map((row, i) => i === index ? { ...row, ...patch, error: undefined } : row) || null);
  const selected = rows?.filter(row => row.selected && !row.saved) || [];
  const invalid = selected.some(row => snapItemError(row));
  const saved = rows?.filter(row => row.saved).length || 0;
  return createPortal(<Modal open onClose={() => { if (!running.current) onClose(); }} title={tr("Snap a syllabus")} width={720} footer={<div className="flex flex-wrap justify-end gap-2">
    <button className={btn.secondary} disabled={busy === 'create'} onClick={onClose}>{tr("Close")}</button>
    {rows ? <button className={btn.primary} disabled={!!busy || !selected.length || invalid} onClick={create}>{busy === 'create' ? tr("Creating…") : tr("Create {{0}} selected",selected.length)}</button> : <button className={btn.primary} disabled={!!busy || !image} onClick={extract}>{busy === 'extract' ? tr("Reading page…") : tr("Extract items")}</button>}
  </div>}>
    <p className="text-sm text-on-surface-variant">{tr("Choose a photo or one PDF page. The selected image is sent to the configured AI provider. Review and edit the results before creating anything.")}</p>
    <Field label={tr("Photo or PDF (up to 5 MB)")}><input className={`${input} !h-auto py-2 text-sm min-w-0`} type="file" accept={SNAP_ACCEPT} disabled={!!busy} onChange={event => { const next = event.target.files?.[0]; event.target.value = ''; if (next) { setPages(1); void prepare(next, 1); } }} /></Field>
    {file && <p className="text-xs text-on-surface-variant break-all">{file.name}</p>}
    {file?.type === 'application/pdf' && pages > 1 && <Field label={tr("PDF page (1–{{0}})",pages)}><select className={input} value={page} disabled={!!busy} onChange={event => void prepare(file, Number(event.target.value))}>{Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>{tr("Page ")}{i + 1}</option>)}</select></Field>}
    {busy === 'prepare' && <p role="status" className="text-sm text-on-surface-variant">{tr("Preparing this page…")}</p>}
    {preview && <img src={preview} alt={tr("Selected syllabus page")} className="max-h-48 w-full object-contain rounded-xl bg-surface-container-low" />}
    {error && <p role="alert" className="text-sm text-error break-words">{tr(error)}</p>}
    {rows && <>
      <p className="text-sm text-on-surface">{tr("Check the dates carefully. Exams become tasks labeled “Exam: …”; meetings are added without a set time.")}</p>
      {rows.length === 0 && <p role="status" className="text-sm text-on-surface-variant">{tr("No items found. Try a clearer photo or another PDF page.")}</p>}
      {rows.map((row, index) => <fieldset key={index} disabled={row.saved || busy === 'create'} className="border border-outline-variant rounded-xl p-4 min-w-0 bg-surface-container-lowest">
        <label className="flex items-center gap-2 text-sm font-medium text-on-surface mb-3"><input type="checkbox" checked={row.selected || !!row.saved} onChange={event => edit(index, { selected: event.target.checked })} aria-label={tr("Include item {{0}}",index + 1)} />{row.saved ? tr("Created") : tr("Item {{0}}",index + 1)}</label>
        <div className="flex flex-col gap-3"><Field label={tr("Title")}><input className={input} value={row.title} maxLength={200} aria-label={tr("Title {{0}}",index + 1)} onChange={event => edit(index, { title: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label={tr("Date")}><input type="date" className={`${input} min-w-0`} value={row.date} aria-label={tr("Date {{0}}",index + 1)} onChange={event => edit(index, { date: event.target.value })} /></Field><Field label={tr("Type")}><select className={`${input} min-w-0`} value={row.type} aria-label={tr("Type {{0}}",index + 1)} onChange={event => edit(index, { type: event.target.value as SnapRow['type'] })}>{SNAP_TYPES.map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></Field></div>
        </div>
        {row.error && <p role="alert" className="text-error text-sm mt-2">{tr(row.error)}</p>}
        {!row.saved && row.selected && snapItemError(row) && <p className="text-sm text-error mt-2">{snapItemError(row)}</p>}
      </fieldset>)}
      {!!saved && <p role="status" className="text-sm text-primary">{tr("Created ")}{quantity(saved,'item')}{tr(". Created rows won’t be added again.")}</p>}
    </>}
  </Modal>, document.body);
}
