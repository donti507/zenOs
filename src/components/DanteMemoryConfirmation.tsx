import {tr,useUiLanguage} from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DanteMemory } from '../../shared/danteMemory';
import { Modal, btn } from './ui/kit';

export function useDanteMemoryConfirmation(ownerId: string | null) {
  const owner = useRef(ownerId); owner.current = ownerId;
  const pending = useRef<{ owner: string; resolve: (yes: boolean) => void } | null>(null);
  const [fact, setFact] = useState<DanteMemory | null>(null);
  const finish = useCallback((yes: boolean) => {
    const request = pending.current; pending.current = null; setFact(null);
    request?.resolve(yes && request.owner === owner.current);
  }, []);
  useEffect(() => { finish(false); return () => { const request = pending.current; pending.current = null; request?.resolve(false); }; }, [ownerId, finish]);
  const confirmForgetFact = useCallback((memory: DanteMemory): Promise<boolean> => {
    if (!owner.current || pending.current) return Promise.resolve(false);
    return new Promise(resolve => { pending.current = { owner: owner.current!, resolve }; setFact(memory); });
  }, []);
  const visible = pending.current?.owner === ownerId ? fact : null;
  const dialog = <div key={ownerId ?? 'signed-out'} className="relative z-[100]"><Modal open={!!visible} onClose={() => finish(false)} title={tr("Forget this fact?")} footer={<>
    <button className={btn.secondary} onClick={() => finish(false)}>{tr("Cancel")}</button>
    <button className={btn.danger} onClick={() => finish(true)}>{tr("Forget fact")}</button>
  </>}>
    <p className="text-on-surface break-words [overflow-wrap:anywhere]">{visible?.fact}</p>
    <p className="text-on-surface-variant">{tr("Dante will stop using this saved fact in future conversations. Existing chat messages stay in your history.")}</p>
  </Modal></div>;
  return { confirmForgetFact, dialog };
}
