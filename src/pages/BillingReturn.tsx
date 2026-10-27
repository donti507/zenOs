import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { btn, card } from '../components/ui/kit';

export default function BillingReturn({ result }: { result: 'success' | 'cancel' | 'upgrade' }) {
  const { billing, refreshBilling, startBilling, isOffline } = useZenos();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  useEffect(() => {
    if (result !== 'success') return;
    // Checkout return is not proof of payment. Wait for the verified webhook/server plan.
    let attempts = 0;
    void refreshBilling();
    const timer = window.setInterval(() => { if (++attempts >= 10) window.clearInterval(timer); void refreshBilling(); }, 2000);
    return () => window.clearInterval(timer);
  }, [result, refreshBilling]);
  const pro = billing?.plan === 'pro';
  return <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center p-5">
    <section className={`${card} p-6 sm:p-8 w-full max-w-lg min-w-0`}>
      <h1 className="text-2xl font-semibold">{result === 'cancel' ? 'Checkout canceled' : pro ? 'Your Pro subscription is active' : result === 'success' ? 'Thanks — checking your subscription' : 'Upgrade to Pro'}</h1>
      <p className="mt-4 text-on-surface-variant">{result === 'cancel' ? 'No upgrade was completed. You can keep using your current plan.' : pro ? 'Your account can use Dante without the daily message or transcription limit. Per-minute limits still apply.' : result === 'success' ? 'Activation is confirmed securely by Stripe. If it takes a moment, check again here or in your account menu.' : isOffline ? 'Sign in with a synced account to subscribe. Your local data stays in this browser.' : !billing?.enabled ? 'Subscriptions are currently unavailable. You can keep using ZEN OS for free.' : 'Continue to Stripe to review the subscription price and payment details before subscribing.'}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {billing?.enabled && !isOffline && <button className={btn.solid} disabled={busy} onClick={async () => {
          if (running.current) return;
          running.current = true; setBusy(true); setError('');
          try { if (result === 'success' && !pro) await refreshBilling(); else await startBilling(pro ? 'portal' : 'checkout'); }
          catch { setError('Could not open billing. Please try again.'); }
          finally { running.current = false; setBusy(false); }
        }}>{busy ? 'Please wait…' : result === 'success' && !pro ? 'Check activation' : pro ? 'Manage subscription' : 'Upgrade to Pro'}</button>}
        <Link className={btn.secondary} to="/">Back to ZEN OS</Link>
      </div>
      {error && <p role="alert" className="mt-4 text-error">{error}</p>}
    </section>
  </main>;
}
