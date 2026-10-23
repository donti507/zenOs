import { FormEvent, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useZenos } from '../context/ZenosContext';
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase';
import DanteOrb from '../components/DanteOrb';
import { Icon, Field, btn, input } from '../components/ui/kit';

export type AuthView = 'login' | 'signup' | 'verify' | 'forgot-password' | 'reset-password';

const RULES = [
  { key: 'length', label: '8+ characters', test: (p: string) => p.length >= 8 },
  { key: 'upper', label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'Lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { key: 'number', label: 'Number', test: (p: string) => /[0-9]/.test(p) },
  { key: 'special', label: 'Symbol', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const TITLES: Record<AuthView, { title: string; sub: string }> = {
  login: { title: 'Welcome back', sub: 'Sign in to your workspace.' },
  signup: { title: 'Create your account', sub: 'Your tasks, meetings and AI assistant in one place.' },
  verify: { title: 'Check your email', sub: 'We sent you a confirmation link.' },
  'forgot-password': { title: 'Reset your password', sub: 'We will email you a reset link.' },
  'reset-password': { title: 'Choose a new password', sub: 'Make it strong and memorable.' },
};

export default function Login({ initialView = 'login', onRecovered }: { initialView?: AuthView; onRecovered?: () => void }) {
  const { loginWithGoogle, loginOffline } = useZenos();
  const reduce = useReducedMotion();
  const [view, setView] = useState<AuthView>(initialView);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const passed = useMemo(() => RULES.map(r => r.test(password)), [password]);
  const strong = passed.every(Boolean);

  const go = (v: AuthView) => { setView(v); setError(''); setSuccess(''); setPassword(''); setConfirm(''); };
  const run = async (fn: () => Promise<void>) => {
    setLoading(true); setError(''); setSuccess('');
    try { await fn(); } catch (err: any) { setError(err?.message || 'Something went wrong. Try again.'); } finally { setLoading(false); }
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return setError('Enter your email and password.');
    run(async () => {
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } catch (err: any) {
        // Fall back to local mode only if the server is missing/unreachable — never on a wrong password
        const msg = String(err?.message || '').toLowerCase();
        if (!SUPABASE_CONFIGURED || err?.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch') || msg.includes('network')) {
          loginOffline(email, email.split('@')[0]);
          return;
        }
        throw new Error(msg.includes('invalid login') ? 'Email or password is incorrect.' : err.message);
      }
    });
  };

  const signUp = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return setError('Fill in your email and a password.');
    if (password !== confirm) return setError('The passwords don’t match.');
    if (!strong) return setError('Your password doesn’t meet all the requirements yet.');
    run(async () => {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: `${location.origin}/` } });
      if (error) throw error;
      setView('verify');
    });
  };

  const resend = () =>
    run(async () => {
      const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${location.origin}/` } });
      if (error) throw error;
      setSuccess('Sent again. Check your inbox and spam folder.');
    });

  const forgot = (e: FormEvent) => {
    e.preventDefault();
    if (!email) return setError('Enter the email you signed up with.');
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
      if (error) throw error;
      setSuccess('If that email has an account, a reset link is on its way.');
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords don’t match.');
    if (!strong) return setError('Your password doesn’t meet all the requirements yet.');
    run(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess('Password updated. Taking you to your workspace…');
      history.replaceState(null, '', '/');
      setTimeout(() => onRecovered?.(), 1200);
    });
  };

  const google = () => run(async () => { await loginWithGoogle(); });

  const pwField = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <Field label={label}>
      <div className="relative">
        <input type={showPw ? 'text' : 'password'} className={`${input} pr-10`} value={value} onChange={e => set(e.target.value)} autoComplete={auto} />
        <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface cursor-pointer" aria-label={showPw ? 'Hide password' : 'Show password'}>
          <Icon name={showPw ? 'visibility_off' : 'visibility'} className="text-[18px]" />
        </button>
      </div>
    </Field>
  );

  const rules = (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]" aria-label="Password requirements">
      {RULES.map((r, i) => (
        <li key={r.key} className={`flex items-center gap-1 transition-colors ${passed[i] ? 'text-success' : 'text-on-surface-variant'}`}>
          <Icon name={passed[i] ? 'check_circle' : 'radio_button_unchecked'} className="text-[14px]" />{r.label}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(420px,1fr)_1.1fr] bg-surface">
      {/* Form side */}
      <div className="flex flex-col px-6 sm:px-12 py-8">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-[conic-gradient(from_200deg,#5b5fef,#8b5cf6,#06b6d4,#5b5fef)]" aria-hidden="true" />
          <span className="text-[16px] font-semibold tracking-tight text-on-surface">ZEN OS</span>
        </div>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto py-10">
            <AnimatePresence mode="wait">
              <motion.div key={view} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-on-surface">{TITLES[view].title}</h1>
                <p className="text-on-surface-variant mt-1 mb-6">{TITLES[view].sub}</p>

                {error && <div className="mb-4 p-3 rounded-lg bg-error-container text-error text-[13px] flex gap-2" role="alert"><Icon name="error" className="text-[18px]" />{error}</div>}
                {success && <div className="mb-4 p-3 rounded-lg bg-success-container text-success text-[13px] flex gap-2" role="status"><Icon name="check_circle" className="text-[18px]" />{success}</div>}

                {view === 'login' && (
                  <form onSubmit={signIn} className="flex flex-col gap-4">
                    <Field label="Email"><input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></Field>
                    {pwField('Password', password, setPassword, 'current-password')}
                    <button type="button" onClick={() => go('forgot-password')} className="self-end -mt-2 text-[13px] text-primary hover:underline cursor-pointer">Forgot password?</button>
                    <button className={`${btn.solid} h-11`} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
                  </form>
                )}

                {view === 'signup' && (
                  <form onSubmit={signUp} className="flex flex-col gap-4">
                    <Field label="Full name"><input className={input} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" placeholder="Anna Kowalska" /></Field>
                    <Field label="Email"><input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></Field>
                    {pwField('Password', password, setPassword, 'new-password')}
                    {password && rules}
                    {pwField('Confirm password', confirm, setConfirm, 'new-password')}
                    <button className={`${btn.solid} h-11`} disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
                  </form>
                )}

                {view === 'verify' && (
                  <div className="flex flex-col gap-4">
                    <div className="p-4 rounded-xl bg-surface-container-low flex gap-3">
                      <Icon name="mark_email_unread" className="text-[24px] text-primary" />
                      <p className="text-[14px] text-on-surface">Open the link we sent to <strong>{email}</strong> to activate your account, then come back and sign in.</p>
                    </div>
                    <button className={btn.secondary} onClick={resend} disabled={loading}>{loading ? 'Sending…' : 'Resend email'}</button>
                    <button className={btn.ghost} onClick={() => go('login')}>Back to sign in</button>
                  </div>
                )}

                {view === 'forgot-password' && (
                  <form onSubmit={forgot} className="flex flex-col gap-4">
                    <Field label="Email"><input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
                    <button className={`${btn.solid} h-11`} disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
                    <button type="button" className={btn.ghost} onClick={() => go('login')}>Back to sign in</button>
                  </form>
                )}

                {view === 'reset-password' && (
                  <form onSubmit={reset} className="flex flex-col gap-4">
                    {pwField('New password', password, setPassword, 'new-password')}
                    {rules}
                    {pwField('Confirm new password', confirm, setConfirm, 'new-password')}
                    <button className={`${btn.solid} h-11`} disabled={loading}>{loading ? 'Saving…' : 'Update password'}</button>
                  </form>
                )}

                {(view === 'login' || view === 'signup') && (
                  <>
                    <div className="flex items-center gap-3 my-5 text-[12px] text-on-surface-variant"><span className="h-px flex-1 bg-outline-variant" />or<span className="h-px flex-1 bg-outline-variant" /></div>
                    <div className="flex flex-col gap-2">
                      {SUPABASE_CONFIGURED && (
                        <button className={`${btn.secondary} h-11 ring-1 ring-outline-variant bg-surface-container-lowest`} onClick={google} disabled={loading}>
                          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                          Continue with Google
                        </button>
                      )}
                      <button className={`${btn.ghost} h-11`} onClick={() => loginOffline('demo@zenos.local', 'Demo')}>
                        <Icon name="science" className="text-[18px]" />Try the demo without an account
                      </button>
                    </div>
                    <p className="text-center text-[13px] text-on-surface-variant mt-6">
                      {view === 'login' ? 'New here? ' : 'Already have an account? '}
                      <button className="text-primary font-medium hover:underline cursor-pointer" onClick={() => go(view === 'login' ? 'signup' : 'login')}>
                        {view === 'login' ? 'Create an account' : 'Sign in'}
                      </button>
                    </p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <p className="text-[12px] text-on-surface-variant">{SUPABASE_CONFIGURED ? 'Your data syncs securely with your account.' : 'Running without a server: data stays in this browser.'}</p>
      </div>

      {/* Visual side */}
      <div className="hidden lg:flex relative overflow-hidden items-center justify-center bg-gradient-to-br from-[#eef0ff] via-[#f4ecff] to-[#e6f7fb] dark:from-[#16172e] dark:via-[#1b1530] dark:to-[#0f2229]">
        <div className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full bg-primary-container/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 w-[380px] h-[380px] rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex flex-col items-center text-center gap-14 px-12 max-w-lg">
          <DanteOrb size={160} state="speaking" />
          <div>
            <h2 className="text-[32px] leading-10 font-semibold tracking-tight text-on-surface">Your day, organised by AI</h2>
            <p className="text-on-surface-variant mt-3 text-[15px] leading-6">Dante knows your tasks, meetings and calendar. Ask by text or voice, and it plans, reminds and updates things for you.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {['“What should I focus on today?”', '“Move my report to Friday”', '“Prep me for the 4pm sync”'].map(s => (
              <span key={s} className="px-3 py-1.5 rounded-full bg-surface-container-lowest/80 shadow-soft text-[13px] text-on-surface">{s}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
