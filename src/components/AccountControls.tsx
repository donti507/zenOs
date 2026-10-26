import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useZenos } from '../context/ZenosContext';
import { Modal, btn } from './ui/kit';

export default function AccountControls() {
  const { user, isOffline, exportMyData, deleteMyAccount } = useZenos();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const running = useRef(false);
  if (!user || isOffline) return null;

  const run = async (action: 'export' | 'delete') => {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'export') await exportMyData();
      else { await deleteMyAccount(); setConfirm(false); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the request. Please try again.');
    } finally { running.current = false; setBusy(null); }
  };
  const close = () => { if (!running.current) { setConfirm(false); setError(''); } };
  return <>
    <button role="menuitem" disabled={!!busy} className="w-full px-3 py-2 text-left text-on-surface hover:bg-surface-container disabled:opacity-50 cursor-pointer" onClick={() => run('export')}>
      {busy === 'export' ? 'Exporting…' : 'Export my data (JSON)'}
    </button>
    <button role="menuitem" disabled={!!busy} className="w-full px-3 py-2 text-left text-error hover:bg-surface-container disabled:opacity-50 cursor-pointer" onClick={() => { setError(''); setConfirm(true); }}>Delete my account</button>
    {error && !confirm && <p role="alert" className="px-3 py-2 text-error text-sm break-words">{error}</p>}
    {createPortal(<Modal open={confirm} onClose={close} title="Delete my account?" footer={<>
      <button className={btn.secondary} disabled={!!busy} onClick={close}>Cancel</button>
      <button className={`${btn.danger} disabled:opacity-50`} disabled={!!busy} onClick={() => run('delete')}>{busy === 'delete' ? 'Deleting…' : 'Permanently delete account'}</button>
    </>}>
      <p className="text-on-surface">This permanently deletes your account, tasks, categories, meetings, vault items, and all Dante messages, then signs you out. This cannot be undone.</p>
      <p className="text-on-surface-variant">Export your data first if you want to keep a copy. Events in Google Calendar and data saved separately in local mode are not deleted.</p>
      {error && <p role="alert" className="text-error break-words">{error}</p>}
    </Modal>, document.body)}
  </>;
}
