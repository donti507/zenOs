import {tr,useUiLanguage} from '../i18n';
import { lazy, Suspense, useState } from 'react';
import { useZenos } from '../context/ZenosContext';
import { btn } from './ui/kit';
const SnapDialog = lazy(() => import('./SnapDialog'));
export default function SnapSyllabus() {
  useUiLanguage();
  const [open, setOpen] = useState(false);
  const { user } = useZenos();
  return <>
    <button type="button" className={btn.secondary} onClick={() => setOpen(true)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4V7Z"/><circle cx="12" cy="13" r="4"/></svg>{tr("Snap a syllabus")}</button>
    {open && <Suspense fallback={<p role="status" className="text-sm text-on-surface-variant">{tr("Opening Snap…")}</p>}><SnapDialog key={user?.id} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
