import { useCallback, useEffect, useRef, useState } from 'react';

/** Splits text into sentence-sized chunks (Chrome cuts off utterances longer than ~15s). */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [text];
  return parts.map(s => s.trim()).filter(Boolean);
}

export function useSpeechSynthesis(lang: string) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [sentenceIndex, setSentenceIndex] = useState<number | null>(null);
  const runRef = useRef(0);

  // Voices load asynchronously in most browsers
  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [supported]);

  const pickVoice = useCallback(() => {
    const base = lang.split('-')[0];
    return (
      voices.find(v => v.lang === lang && /natural|neural|google|premium|enhanced/i.test(v.name)) ||
      voices.find(v => v.lang === lang) ||
      voices.find(v => v.lang.startsWith(base)) ||
      null
    );
  }, [voices, lang]);

  const stop = useCallback(() => {
    runRef.current++;
    if (supported) window.speechSynthesis.cancel();
    setSpeakingId(null);
    setSentenceIndex(null);
  }, [supported]);

  /** Speaks text; resolves when finished or stopped. */
  const speak = useCallback(
    (text: string, id: number, rate = 1) =>
      new Promise<void>(resolve => {
        if (!supported || !text.trim()) return resolve();
        window.speechSynthesis.cancel();
        const run = ++runRef.current;
        const sentences = splitSentences(text);
        const voice = pickVoice();
        setSpeakingId(id);

        const next = (i: number) => {
          if (run !== runRef.current) return resolve();
          if (i >= sentences.length) {
            setSpeakingId(null);
            setSentenceIndex(null);
            return resolve();
          }
          const u = new SpeechSynthesisUtterance(sentences[i]);
          u.lang = lang;
          if (voice) u.voice = voice;
          u.rate = rate;
          u.onstart = () => run === runRef.current && setSentenceIndex(i);
          u.onend = () => next(i + 1);
          u.onerror = () => next(i + 1);
          window.speechSynthesis.speak(u);
        };
        next(0);
      }),
    [supported, pickVoice, lang]
  );

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return { supported, voices, speak, stop, speakingId, sentenceIndex };
}
