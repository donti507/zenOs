import { useZenos } from '../context/ZenosContext';

export default function DanteUsageNotice() {
  const { danteUsage: usage, danteUsageError: error, billing } = useZenos();
  return <div role="status" aria-live="polite" className="px-4 py-2 bg-surface-container-low border-b border-outline-variant text-sm text-on-surface shrink-0">
    {error ? <span className="text-on-surface-variant">{error}</span> : !usage ? 'Checking today’s usage…' : !usage.enabled ? <span className="text-on-surface-variant">{billing?.plan === 'pro' ? 'Pro · No daily Dante limit. Per-minute limits still apply.' : 'Daily limits are not enabled for this session.'}</span> : <>
      <p className="font-medium">{usage.messagesRemaining} of {usage.limit} messages left today</p>
      <p className="text-xs text-on-surface-variant mt-0.5">{usage.transcriptionsRemaining} transcriptions left. Resets at midnight UTC.</p>
    </>}
  </div>;
}
