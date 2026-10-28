import {tr,useUiLanguage,uiLocale,speechLocale,quantity} from '../i18n';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { supabase } from '../lib/supabase';
import { today, computeStreak } from '../lib/utils';
import DanteOrb from './DanteOrb';
import { Icon, btn } from './ui/kit';

const WEATHER: [number, number, string, string][] = [
  [0, 0, 'clear_day', 'Clear sky'],
  [1, 3, 'partly_cloudy_day', 'Partly cloudy'],
  [45, 48, 'foggy', 'Fog'],
  [51, 67, 'rainy', 'Rain'],
  [71, 77, 'weather_snowy', 'Snow'],
  [80, 82, 'rainy_heavy', 'Showers'],
  [95, 99, 'thunderstorm', 'Thunderstorms'],
];
const weatherOf = (code: number): [number, number, string, string] => WEATHER.find(([a, b]) => code >= a && code <= b) || [0, 0, 'cloud', 'Cloudy'];

export default function MorningBriefing() {
  useUiLanguage();
  const { state, user, showBriefing, setShowBriefing, isOffline, googleEvents } = useZenos();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [weather, setWeather] = useState<{ temperature: number; weathercode: number } | null>(null);
  const todayStr = today();
  const firstName = (user?.user_metadata?.full_name || user?.email?.split('@')[0] || '').split(/\s+/)[0];

  // Weather from the free Open-Meteo API (no key). Only uses location if the user allows it.
  useEffect(() => {
    if (!showBriefing || weather) return;
    const load = (lat: number, lon: number) =>
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
        .then(r => r.json())
        .then(d => d?.current_weather && setWeather(d.current_weather))
        .catch(() => {});
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => load(p.coords.latitude, p.coords.longitude), () => {}, { timeout: 5000 });
  }, [showBriefing]);

  const open = state.tasks.filter(t => t.status !== 'done');
  const dueToday = open.filter(t => t.date === todayStr);
  const overdue = open.filter(t => t.date && t.date < todayStr);
  const meetings = [
    ...(state.meetings || []).filter(m => m.date === todayStr && m.status !== 'completed').map(m => ({ key: m.id, time: m.time, title: m.subject })),
    ...googleEvents
      .filter((e: any) => (e.start?.dateTime || e.start?.date || '').startsWith(todayStr))
      .map((e: any) => ({ key: e.id, time: e.start?.dateTime ? new Date(e.start.dateTime).toTimeString().slice(0, 5) : 'All day', title: e.summary || 'Busy' })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const streak = computeStreak(state.completionLog);

  // Speak a short greeting only if the user turned on "read aloud" in Dante
  useEffect(() => {
    if (!showBriefing || !('speechSynthesis' in window)) return;
    let ttsOn = false;
    try { ttsOn = JSON.parse(localStorage.getItem('zenos_tts_on') || 'false'); } catch { /* ignore */ }
    if (!ttsOn) return;
    const t = setTimeout(() => {
      const u = new SpeechSynthesisUtterance(tr('Good morning{{0}}. You have {{1}} due today and {{2}}.',firstName?' '+firstName:'',quantity(dueToday.length,'task'),quantity(meetings.length,'meeting')));
      u.lang=speechLocale();
      window.speechSynthesis.speak(u);
    }, 500);
    return () => { clearTimeout(t); window.speechSynthesis.cancel(); };
  }, [showBriefing]);

  const close = async () => {
    setShowBriefing(false);
    try { localStorage.setItem(`zenos_briefing_seen_${todayStr}`, 'true'); } catch { /* ignore */ }
    if (user && !isOffline) {
      await supabase.from('dante_briefing_meta').upsert({ user_id: user.id, last_seen_date: todayStr });
    }
  };
  const planWithDante = () => {
    close();
    navigate('/dante', { state: { prompt: tr("Plan my day: look at my tasks and meetings for today and suggest an order with times. Mention anything overdue first.") } });
  };

  const [, , wIcon, wLabel] = weather ? weatherOf(weather.weathercode) : [0, 0, '', ''];
  const tasksToShow = [...overdue, ...dueToday].slice(0, 5);

  return (
    <AnimatePresence>
      {showBriefing && (
        <motion.div
          className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={e => e.target === e.currentTarget && close()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={tr("Morning briefing")}
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 16 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="w-full max-w-2xl max-h-[94dvh] overflow-y-auto bg-surface-container-lowest rounded-t-3xl sm:rounded-3xl shadow-2xl"
          >
            {/* Hero */}
            <div className="relative overflow-hidden px-6 sm:px-8 pt-8 pb-6 bg-gradient-to-br from-[#eef0ff] via-[#f4ecff] to-[#e6f7fb] dark:from-[#1a1b38] dark:via-[#1f1838] dark:to-[#10262e]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[13px] text-on-surface-variant font-medium">{new Date().toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                  <h2 className="text-[28px] sm:text-[32px] leading-10 font-semibold tracking-tight text-on-surface mt-1">{new Date().getHours() < 12 ? tr("Good morning") : new Date().getHours() < 18 ? tr("Good afternoon") : tr("Good evening")}{firstName ? `, ${firstName}` : ''}.</h2>
                  <p className="text-on-surface-variant mt-1">{tr("Here is your day at a glance.")}</p>
                </div>
                <DanteOrb size={64} state="speaking" />
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                {weather && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest/80 text-[13px] text-on-surface shadow-soft">
                    <Icon name={wIcon} className="text-[18px] text-warning" />{Math.round(weather.temperature)}{tr("°C · ")}{tr(wLabel)}
                  </span>
                )}
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest/80 text-[13px] text-on-surface shadow-soft">
                  <Icon name="local_fire_department" className="text-[18px] text-warning" />{streak}{tr("-day streak")}</span>
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest/80 text-[13px] text-on-surface shadow-soft">
                  <Icon name="task_alt" className="text-[18px] text-primary" />{open.length}{tr(" open tasks")}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6 sm:p-8">
              <section>
                <h3 className="text-[13px] font-semibold text-on-surface-variant mb-2">{tr("Tasks for today")}</h3>
                {tasksToShow.length === 0 ? (
                  <p className="text-[13px] text-on-surface-variant">{tr("Nothing due today. A good day to get ahead.")}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {tasksToShow.map(t => (
                      <li key={String(t.id)} className="flex items-center gap-2 text-[14px]">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.date < todayStr ? 'bg-error' : 'bg-warning'}`} />
                        <span className="truncate text-on-surface">{t.title}</span>
                        {t.date < todayStr && <span className="text-[11px] text-error font-medium shrink-0">{tr("overdue")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-[13px] font-semibold text-on-surface-variant mb-2">{tr("Meetings")}</h3>
                {meetings.length === 0 ? (
                  <p className="text-[13px] text-on-surface-variant">{tr("No meetings. Plenty of focus time.")}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {meetings.slice(0, 5).map(m => (
                      <li key={m.key} className="flex items-center gap-2 text-[14px]">
                        <span className="text-[12px] font-semibold text-primary w-12 shrink-0">{m.time}</span>
                        <span className="truncate text-on-surface">{m.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end px-6 sm:px-8 pb-6 sm:pb-8">
              <button className={btn.secondary} onClick={planWithDante}><Icon name="auto_awesome" className="text-[18px] text-primary" />{tr("Plan my day with Dante")}</button>
              <button className={`${btn.solid} px-6`} onClick={close} autoFocus>{tr("Start my day")}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
