import LanguageSwitcher from '../components/LanguageSwitcher';
import {tr,useUiLanguage} from '../i18n';
import { useEffect } from 'react';
import { BILLING_ROUTES } from '../lib/routes';
import { Link } from 'react-router-dom';
import DanteOrb from '../components/DanteOrb';
import { btn, card } from '../components/ui/kit';
import { useZenos } from '../context/ZenosContext';

const FEATURES = [
  { get name(){return tr("Dante chat");}, get text(){return tr("Turn “I need to…” into a plan. Ask Dante to find your focus, organise tasks and make the next move.");}, path: 'M5 5h14v10H9l-4 4V5Zm4 4h6m-6 3h4' },
  { get name(){return tr("Dante Live voice");}, get text(){return tr("Think out loud. Talk to your assistant hands-free and keep your attention on what matters.");}, path: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5Zm-3 5v1a6 6 0 0 0 12 0v-1M12 17v4m-3 0h6' },
  { get name(){return tr("Board");}, get text(){return tr("From to-do to done, at a glance. Give every project a clear next step with a simple kanban board.");}, path: 'M3 4h18v16H3V4Zm6 0v16m6-16v16M5 8h2m4 0h2m4 0h2M5 12h2m6 0h-2' },
  { get name(){return tr("Calendar");}, get text(){return tr("Make room for real life. See tasks and events together, with optional Google Calendar sync.");}, path: 'M5 5h14v16H5V5Zm3-3v6m8-6v6M5 10h14m-10 4h2m2 0h2m-6 3h2' },
  { get name(){return tr("Meetings");}, get text(){return tr("Arrive with a plan. Keep your meeting schedule, live notes and a handy stopwatch in one place.");}, path: 'M4 6h11v12H4V6Zm11 4 5-3v10l-5-3M7 10h5m-5 4h3' },
  { get name(){return tr("Analytics");}, get text(){return tr("See the progress you’re making. Follow your streaks and build a rhythm that works for you.");}, path: 'M4 3v17h17M8 16v-4m5 4V8m5 8V5' },
];
const STEPS = [
  { get title(){return tr("Make a little space");}, get text(){return tr("Create your account, or explore the demo. Put your tasks and meetings in one place.");} },
  { get title(){return tr("Tell Dante what’s on your mind");}, get text(){return tr("Type a message or start a conversation. Let your assistant help turn the busy into the doable.");} },
  { get title(){return tr("Find your daily rhythm");}, get text(){return tr("Move through your board, make time in your calendar and watch your progress grow.");} },
];
const FAQ = [
  { get q(){return tr("Can I try ZEN OS without an account?");}, get a(){return tr("Yes. Choose Get started, then “Try the demo without an account” on the sign-in screen. Demo data stays in this browser. Create an account when you’re ready to sync your workspace.");} },
  { get q(){return tr("What can Dante help me with?");}, get a(){return tr("Dante can help you plan, create and update tasks, schedule meetings and navigate your workspace by text or voice. AI features need a connected provider, and answers can be wrong, so check important details.");} },
  { get q(){return tr("Can I connect Google Calendar?");}, get a(){return tr("Yes. Google Calendar is optional. Connect it from your workspace to see events alongside your plans and create meetings.");} },
  { get q(){return tr("What happens to my data?");}, get a(){return tr("Local demo data stays in your browser. With an account, your workspace syncs through Supabase. When you use Dante, relevant context is sent to the configured AI provider. Read our Privacy Policy for details.");} },
  { get q(){return tr("How does Pro work?");}, get a(){return tr("When subscriptions are available, choose Upgrade to Pro and review the current price at Stripe checkout. Pro removes the daily Dante message and transcription limit; per-minute limits still apply. Manage or cancel from your account menu.");} },
];

function Glyph({ path, className = '' }: { path: string; className?: string }) {
  useUiLanguage();
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={path} /></svg>;
}

export default function Landing() {
  const uiLanguage=useUiLanguage();
  const { state, toggleTheme, billing } = useZenos();
  useEffect(() => { document.title = 'ZEN OS · '+tr('Your day, organised by AI'); }, [uiLanguage]);
  const start = `${btn.solid} min-h-11 !px-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary`;
  return <div className="landing min-h-dvh bg-surface text-on-surface overflow-x-clip">
    <a href="#landing-main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 bg-primary text-on-primary px-4 py-2 rounded-lg">{tr("Skip to content")}</a>
    <header className="max-w-6xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between gap-3">
      <Link to="/" aria-label={tr("ZEN OS home")} className="flex items-center gap-2 font-semibold tracking-tight text-lg shrink-0"><span className="w-8 h-8 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center"><Glyph path="m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3 2-6Z" /></span>ZEN OS</Link>
      <nav aria-label={tr("Landing navigation")} className="hidden md:flex gap-7 text-sm text-on-surface-variant">
        <a href="#features" className="hover:text-primary">{tr("Features")}</a><a href="#how-it-works" className="hover:text-primary">{tr("How it works")}</a><a href="#pricing" className="hover:text-primary">{tr("Pricing")}</a><a href="#faq" className="hover:text-primary">{tr("FAQ")}</a>
      </nav>
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <button type="button" className={btn.icon} onClick={toggleTheme} aria-label={state.theme === 'dark' ? tr("Switch to light mode") : tr("Switch to dark mode")}><Glyph path={state.theme === 'dark' ? 'M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z' : 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'} /></button>
        <Link to="/login" className={start}>{tr("Get started")}</Link>
      </div>
    </header>

    <main id="landing-main">
      <section aria-labelledby="hero-title" className="max-w-6xl mx-auto px-6 sm:px-8 pt-12 pb-20 md:pt-20 md:pb-28 grid lg:grid-cols-2 gap-14 lg:gap-16 items-center">
        <div className="landing-enter">
          <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary text-xs font-semibold px-3 py-2 mb-6"><span className="w-1.5 h-1.5 bg-primary rounded-full" />{tr("A calmer kind of productivity")}</p>
          <h1 id="hero-title" className="text-[48px] sm:text-[68px] leading-[1.06] font-semibold tracking-[-0.055em]">{tr("Your day,")}<br /><span className="text-primary">{tr("organised by AI")}</span></h1>
          <p className="mt-6 text-lg leading-8 text-on-surface-variant max-w-md">{tr("Less juggling. More headspace. Bring your tasks, meetings and plans together with Dante, your personal AI assistant.")}</p>
          <div className="mt-8 flex flex-wrap gap-3 items-center"><Link to="/login" className={`${start} gap-3`}>{tr("Get started ")}<Glyph path="M7 17 17 7M7 7h10v10" className="w-4 h-4" /></Link><a href="#features" className={`${btn.ghost} min-h-11`}>{tr("Take a look ")}<Glyph path="M12 4v16m-6-6 6 6 6-6" className="w-4 h-4" /></a></div>
          <p className="mt-4 text-xs text-on-surface-variant">{tr("Start free. No credit card. Your next step, made simpler.")}</p>
        </div>
        <div className="landing-enter landing-enter-late relative rounded-[2rem] bg-gradient-to-br from-primary/10 via-surface-container-low to-tertiary/10 p-6 sm:p-9 border border-outline-variant" role="img" aria-label={tr("Dante illustration: a glowing orb above a sample daily plan")}>
          <div className="flex items-center justify-between text-xs text-on-surface-variant"><span className="font-semibold tracking-widest uppercase">{tr("A little clarity")}</span><span className="px-2 py-1 bg-surface-container-lowest rounded-full">{tr("Made for your day")}</span></div>
          <div className="relative h-64 flex items-center justify-center"><span className="absolute w-56 h-56 border border-primary/15 rounded-full" /><span className="absolute w-44 h-44 border border-primary/15 rounded-full" /><DanteOrb size={140} /><span className="absolute bottom-2 right-0 rounded-full px-3 py-2 bg-surface-container-lowest text-xs shadow-soft text-primary">{tr("Meet Dante. Your thinking partner.")}</span></div>
          <div className={`${card} p-4 relative`}><div className="flex items-center justify-between mb-4"><span className="text-sm font-semibold">{tr("One thing at a time.")}</span><span className="text-xs text-on-surface-variant">{tr("Your daily flow")}</span></div>
            <div className="flex items-center gap-3 text-sm py-2"><span className="w-5 h-5 rounded-full bg-success-container text-success flex items-center justify-center" aria-hidden="true">✓</span><span className="line-through text-on-surface-variant">{tr("Make room for a good idea")}</span></div>
            <div className="flex items-center gap-3 text-sm py-2"><span className="w-5 h-5 rounded-full border border-primary/40" /><span>{tr("Focus on what matters next")}</span><span className="ml-auto text-primary text-xs">{tr("Up next")}</span></div>
          </div>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className="scroll-mt-8 bg-surface-container-low py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-6 sm:px-8"><p className="text-primary text-xs font-semibold tracking-widest uppercase mb-3">{tr("One workspace. A clearer mind.")}</p><h2 id="features-title" className="text-3xl sm:text-4xl tracking-tight font-semibold max-w-xl">{tr("Everything your day needs.")}<br />{tr("Finally, together.")}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">{FEATURES.map(feature => <article key={feature.name} className={`${card} landing-feature p-6 border border-outline-variant/60`}><span className="inline-flex p-3 rounded-xl bg-primary/10 text-primary mb-5"><Glyph path={feature.path} /></span><h3 className="text-lg font-semibold">{feature.name}</h3><p className="text-on-surface-variant leading-7 mt-2 text-sm">{feature.text}</p></article>)}</div>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="steps-title" className="scroll-mt-8 max-w-6xl mx-auto px-6 sm:px-8 py-20 md:py-24"><p className="text-primary text-xs font-semibold tracking-widest uppercase mb-3">{tr("How it works")}</p><h2 id="steps-title" className="text-3xl sm:text-4xl tracking-tight font-semibold">{tr("A fresh start, in three small steps.")}</h2><ol className="grid md:grid-cols-3 gap-8 md:gap-12 mt-12">{STEPS.map((step, index) => <li key={step.title}><span className="text-5xl font-light tracking-tight text-primary/50" aria-hidden="true">0{index + 1}</span><h3 className="font-semibold text-lg mt-5">{step.title}</h3><p className="text-on-surface-variant text-sm leading-7 mt-2">{step.text}</p></li>)}</ol></section>

      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-8 bg-surface-container-low py-20 md:py-24"><div className="max-w-4xl mx-auto px-6 sm:px-8"><div className="text-center"><p className="text-primary text-xs font-semibold tracking-widest uppercase mb-3">{tr("Simple pricing")}</p><h2 id="pricing-title" className="text-3xl sm:text-4xl tracking-tight font-semibold">{tr("Room to start. Space to grow.")}</h2><p className="mt-4 text-on-surface-variant">{tr("Build your rhythm for free. Go further with Pro.")}</p></div>
        <div className="grid sm:grid-cols-2 gap-5 mt-10">
          <article className={`${card} p-7 border border-outline-variant flex flex-col`}><h3 className="text-xl font-semibold">{tr("Free")}</h3><p className="text-sm text-on-surface-variant mt-2">{tr("A little help, every day.")}</p><p className="mt-6 mb-7"><span className="text-5xl font-semibold tracking-tight">€0</span><span className="text-on-surface-variant">{tr(" / month")}</span></p><ul className="space-y-3 text-sm mb-8"><li>{tr("✓ 20 Dante messages/day")}</li><li>{tr("✓ Tasks, Board and Calendar")}</li><li>{tr("✓ Meetings and Analytics")}</li></ul><Link to="/login" className={`${start} mt-auto`}>{tr("Get started")}</Link></article>
          <article className={`${card} p-7 border-2 border-primary/40 flex flex-col`}><div className="flex items-center justify-between gap-3"><h3 className="text-xl font-semibold">Pro</h3><span className="bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1 rounded-full">{billing?.enabled ? tr("Available now") : tr("On the horizon")}</span></div><p className="text-sm text-on-surface-variant mt-2">{tr("For your bigger days and ideas.")}</p><p className="mt-6 mb-7"><span className="text-5xl font-semibold tracking-tight">€5</span><span className="text-on-surface-variant">{tr(" / month")}</span></p><ul className="space-y-3 text-sm mb-8"><li>{tr("✓ Everything in Free")}</li><li>{tr("✓ Unlimited Dante messages")}</li><li>{tr("✓ Manage or cancel your subscription")}</li></ul>{billing?.enabled ? <Link to={BILLING_ROUTES.upgrade} className={`${btn.solid} min-h-11 mt-auto`}>{tr("Upgrade to Pro")}</Link> : <button type="button" disabled className={`${btn.secondary} min-h-11 mt-auto`}>{tr("Coming soon")}</button>}</article>
        </div>
      </div></section>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-8 max-w-3xl mx-auto px-6 sm:px-8 py-20 md:py-24"><p className="text-primary text-xs font-semibold tracking-widest uppercase mb-3">{tr("A few good questions")}</p><h2 id="faq-title" className="text-3xl sm:text-4xl font-semibold tracking-tight mb-8">{tr("Before you settle in.")}</h2>{FAQ.map(item => <details key={item.q} className="group border-b border-outline-variant py-5"><summary className="font-medium cursor-pointer flex items-center justify-between gap-4 list-none focus-visible:outline-2 focus-visible:outline-primary"><span>{item.q}</span><span className="text-primary text-xl group-open:rotate-45 motion-reduce:transition-none transition-transform shrink-0" aria-hidden="true">+</span></summary><p className="text-sm text-on-surface-variant leading-7 pt-4 pr-6">{item.a}</p></details>)}</section>

      <section aria-labelledby="closing-title" className="max-w-6xl mx-auto px-6 sm:px-8 pb-20"><div className="rounded-3xl bg-primary/10 border border-primary/15 py-12 px-6 sm:p-14 text-center"><h2 id="closing-title" className="text-3xl sm:text-4xl font-semibold tracking-tight">{tr("Make space for a better day.")}</h2><p className="mt-3 mb-7 text-on-surface-variant">{tr("Your plans. Your pace. A little help from Dante.")}</p><Link to="/login" className={start}>{tr("Get started")}</Link></div></section>
    </main>
    <footer className="border-t border-outline-variant"><div className="max-w-6xl mx-auto px-6 sm:px-8 py-8 flex flex-col sm:flex-row gap-5 justify-between text-sm"><p className="text-on-surface-variant"><span className="font-semibold text-on-surface">ZEN OS</span><span className="mx-3" aria-hidden="true">·</span>{tr("A little more headspace.")}</p><nav aria-label={tr("Legal")} className="flex gap-6 text-on-surface-variant"><Link to="/privacy" className="hover:text-primary">{tr("Privacy")}</Link><Link to="/terms" className="hover:text-primary">{tr("Terms")}</Link></nav></div></footer>
  </div>;
}
