import { useCallback, useEffect, useRef, useState } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser’s site settings.',
  'service-not-allowed': 'Speech recognition is disabled in this browser.',
  'no-speech': 'I didn’t hear anything. Try again a little closer to the mic.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection (the browser sends audio to its speech service).',
  'language-not-supported': 'This language isn’t supported for voice input in this browser.',
};

export function getSpeechRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

/**
 * Wraps the Web Speech API.
 * - interim results are exposed live so the user sees what is being heard
 * - onFinal fires once with the full transcript when the user stops talking (or presses stop)
 */
export function useSpeechRecognition({ lang, onFinal }: { lang: string; onFinal: (text: string) => void }) {
  const [supported] = useState(() => !!getSpeechRecognitionCtor());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<any>(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const cancelledRef = useRef(false);

  const stop = useCallback(() => recRef.current?.stop(), []);

  /** Stops without delivering the transcript. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError('Voice input isn’t supported here. Use Chrome, Edge or Safari.');
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('Voice input only works over HTTPS (or on localhost).');
      return;
    }
    recRef.current?.abort();

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;      // keep listening through short pauses
    rec.interimResults = true;  // live transcript
    rec.maxAlternatives = 1;

    finalRef.current = '';
    cancelledRef.current = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    const armSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      // auto-stop after ~1.8s of silence once something was said
      silenceTimer = setTimeout(() => rec.stop(), 1800);
    };

    rec.onstart = () => {
      setListening(true);
      setError(null);
      setInterim('');
    };
    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript + ' ';
        else interimText += r[0].transcript;
      }
      setInterim((finalRef.current + interimText).trim());
      armSilence();
    };
    rec.onerror = (e: any) => {
      if (e.error === 'aborted') return;
      setError(ERROR_MESSAGES[e.error] || `Voice input error: ${e.error}`);
    };
    rec.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setListening(false);
      setInterim('');
      const text = finalRef.current.trim();
      finalRef.current = '';
      if (text && !cancelledRef.current) onFinalRef.current(text);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err: any) {
      setError(`Could not start the microphone: ${err?.message || err}`);
    }
  }, [lang]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, setError, start, stop, cancel };
}
