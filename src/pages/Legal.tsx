import LanguageSwitcher from '../components/LanguageSwitcher';
import {tr,useUiLanguage} from '../i18n';
import { useEffect } from 'react';

const CONTACT = 'rtxtr92@gmail.com';
const UPDATED = '26 October 2026';

/** Public privacy policy and terms pages (no login needed). Required for Google sign-in. */
export default function Legal({ page }: { page: 'privacy' | 'terms' }) {
  const uiLanguage=useUiLanguage();
  useEffect(() => { document.title = `${tr(page === 'privacy' ? 'Privacy Policy' : 'Terms of Service')} · ZEN OS`; }, [page,uiLanguage]);
  const h2 = 'text-[18px] font-semibold text-on-surface mt-8 mb-2';
  const p = 'text-on-surface-variant leading-7';

  return (
    <div className="min-h-dvh bg-surface">
      <header className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-[conic-gradient(from_200deg,#5b5fef,#8b5cf6,#06b6d4,#5b5fef)]" aria-hidden="true" />
          <span className="text-[16px] font-semibold text-on-surface">ZEN OS</span>
        </a>
        <nav className="flex items-center gap-3 text-[14px]"><LanguageSwitcher />
          <a href="/privacy" className={page === 'privacy' ? 'text-primary font-medium' : 'text-on-surface-variant'}>{tr("Privacy")}</a>
          <a href="/terms" className={page === 'terms' ? 'text-primary font-medium' : 'text-on-surface-variant'}>{tr("Terms")}</a>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-6 pb-16">
        <div className="rounded-2xl bg-surface-container-lowest shadow-soft p-6 md:p-10">
          {page === 'privacy' ? (
            <>
              <h1 className="text-[28px] font-semibold text-on-surface">{tr("Privacy Policy")}</h1>
              <p className="text-[13px] text-on-surface-variant mt-1">{tr("Last updated: ")}{uiLanguage==='pl'?'26 października 2026':UPDATED}</p>
              <h2 className={h2}>{tr("What we collect")}</h2>
              <p className={p}>{tr("When you create an account we store your name and email address. If you sign in with Google we receive only your name, email address and profile picture. We store the content you create in ZEN OS: tasks, categories, meetings, notes, saved links and your conversations with Dante.")}</p>
              <h2 className={h2}>{tr("Google Calendar (optional)")}</h2>
              <p className={p}>{tr("Only if you click “Connect Google Calendar”, ZEN OS asks for permission to read and create events in your calendar so they can be shown in the app and created on your request. Calendar data is used only to display and manage your own events and is not stored permanently on our servers. You can revoke access at any time in your Google Account settings. Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.")}</p>
              <h2 className={h2}>{tr("AI assistant and voice")}</h2>
              <p className={p}>{tr("When you use Dante, your message and a summary of your tasks and meetings are sent to our AI provider to generate an answer. When you use voice input, the audio recording is sent for transcription and is not kept after the text is produced. We do not use your data to train AI models.")}</p>
              <h2 className={h2}>{tr("Where data is stored")}</h2>
              <p className={p}>{tr("Account data is stored with Supabase in the European Union. The app is hosted by Render. These providers process data only on our behalf.")}</p>
              <h2 className={h2}>{tr("What we don’t do")}</h2>
              <p className={p}>{tr("We do not sell your data, show ads, or share your data with third parties except the service providers needed to run ZEN OS.")}</p>
              <h2 className={h2}>{tr("Your rights")}</h2>
              <p className={p}>{tr("You can view and edit your data in the app at any time. To export or permanently delete your account and data, email us at ")}<a className="text-primary" href={`mailto:${CONTACT}`}>{CONTACT}</a>{tr(". If you are in the EU, you have rights under the GDPR, including access, correction, deletion and complaint to your data protection authority.")}</p>
              <h2 className={h2}>{tr("Contact")}</h2>
              <p className={p}>{tr("Questions about privacy: ")}<a className="text-primary" href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
            </>
          ) : (
            <>
              <h1 className="text-[28px] font-semibold text-on-surface">{tr("Terms of Service")}</h1>
              <p className="text-[13px] text-on-surface-variant mt-1">{tr("Last updated: ")}{uiLanguage==='pl'?'26 października 2026':UPDATED}</p>
              <h2 className={h2}>{tr("Using ZEN OS")}</h2>
              <p className={p}>{tr("ZEN OS is a productivity app with an AI assistant. By creating an account you agree to these terms. You must provide accurate information and keep your login secure.")}</p>
              <h2 className={h2}>{tr("Your content")}</h2>
              <p className={p}>{tr("You own the content you add. You give us permission to store and process it only to provide the service to you.")}</p>
              <h2 className={h2}>{tr("Acceptable use")}</h2>
              <p className={p}>{tr("Don’t use ZEN OS for anything illegal, to harm others, to attack or overload the service, or to try to access other users’ data.")}</p>
              <h2 className={h2}>{tr("AI answers")}</h2>
              <p className={p}>{tr("Dante’s answers are generated by AI and can be wrong. Check important information yourself. Dante only changes your data when you ask it to, and every change is shown to you.")}</p>
              <h2 className={h2}>{tr("Availability")}</h2>
              <p className={p}>{tr("We work to keep ZEN OS available and your data safe, but the service is provided “as is”, without guarantees. We may change or discontinue features and will try to give notice of major changes.")}</p>
              <h2 className={h2}>{tr("Ending your account")}</h2>
              <p className={p}>{tr("You can stop using ZEN OS and ask us to delete your account at any time. We may suspend accounts that break these terms.")}</p>
              <h2 className={h2}>{tr("Contact")}</h2>
              <p className={p}><a className="text-primary" href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
