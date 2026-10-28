import {tr,useUiLanguage} from '../i18n';
import { useRef, useState } from 'react';
import { useZenos } from '../context/ZenosContext';
import { btn } from './ui/kit';

export default function DanteMemoryPanel() {
  useUiLanguage();
  const { state, isOffline, memoryLoading, memoryError, refreshDanteMemory, forgetFact, confirmForgetFact } = useZenos();
  const memories = state.danteMemory || [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const running = useRef(false);
  return <details className="shrink-0 border-b border-outline-variant text-on-surface bg-surface-container-lowest">
    <summary className="px-4 py-3 cursor-pointer text-sm font-medium focus-visible:outline-primary">{tr("What Dante remembers ")}<span className="text-on-surface-variant font-normal">({memories.length}/100)</span></summary>
    <div className="px-4 pb-4 max-h-64 overflow-y-auto space-y-3">
      <p className="text-xs text-on-surface-variant">{tr("Ask Dante to remember a fact or preference. The 30 most recent facts help with future replies. ")}{isOffline ? tr("Facts are stored in this browser and sent to the configured AI provider when you chat.") : tr("Facts are saved to your account and sent to your configured AI provider when you chat.")}</p>
      {!isOffline && <button className={`${btn.secondary} text-xs`} disabled={memoryLoading} onClick={() => void refreshDanteMemory()}>{memoryLoading ? tr("Loading memory…") : tr("Refresh memory")}</button>}
      {!memories.length && !memoryLoading && !memoryError && <p className="text-sm text-on-surface-variant">{tr("No saved facts yet.")}</p>}
      <ul className="space-y-2">
        {memories.map(memory => <li key={memory.id} className="flex items-start gap-2 rounded-lg bg-surface-container-low p-3">
          <p className="flex-1 min-w-0 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{memory.fact}</p>
          <button className={`${btn.ghost} shrink-0 text-xs min-h-10`} disabled={!!busy} aria-label={tr("Forget fact: {{0}}",memory.fact)} onClick={async () => {
            if (running.current) return;
            running.current = true; setBusy(memory.id); setError('');
            try { if (await confirmForgetFact(memory)) await forgetFact(memory.id); }
            catch { setError('Could not forget this fact. Please try again.'); }
            finally { running.current = false; setBusy(null); }
          }}>{busy === memory.id ? tr("Please wait…") : tr("Forget")}</button>
        </li>)}
      </ul>
      {(error || memoryError) && <p role="alert" className="text-error text-sm">{tr(error || memoryError)}</p>}
    </div>
  </details>;
}
