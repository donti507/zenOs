import {tr,useUiLanguage} from '../i18n';
import { useZenos } from '../context/ZenosContext';
import { Modal, btn } from './ui/kit';

export default function LocalImportDialog() {
  useUiLanguage();
  const { localImportOpen, localImportBusy, localImportError, importLocalWorkspace, declineLocalWorkspace } = useZenos();
  return <Modal open={localImportOpen} title={tr("Import your local data into your account?")} onClose={declineLocalWorkspace}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button className={btn.secondary} disabled={localImportBusy} onClick={declineLocalWorkspace}>{tr("No, thanks")}</button>
      <button className={btn.primary} disabled={localImportBusy} onClick={importLocalWorkspace}>{localImportBusy ? tr("Importing…") : tr("Import local data")}</button>
    </div>}>
    <p className="text-on-surface">{tr("Bring this browser’s local tasks, categories, meetings and vault items into your signed-in account. Categories with matching names will be combined.")}</p>
    <p className="text-on-surface-variant">{tr("After import, these local copies will be removed. Your theme and local Dante history will stay on this browser. If you decline, we won’t ask again for this account on this browser.")}</p>
    {localImportError && <p role="alert" className="text-error break-words">{tr(localImportError)}</p>}
  </Modal>;
}
