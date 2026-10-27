import { notifyDanteUsage } from '../lib/usageEvents';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Records the microphone with MediaRecorder and sends the audio to /api/transcribe.
 * Same interface as useSpeechRecognition, so Dante can use either.
 * Stops automatically after ~1.5 s of silence once you have started talking.
 */
export function useRecorderTranscription({
  lang,
  onFinal,
  getToken,
}: {
  lang: string;
  onFinal: (text: string) => void;
  getToken: () => Promise<string | null>;
}) {
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const recRef = useRef<MediaRecorder | null>(null);
  const generationRef = useRef(0);
  const transcriptionRef = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const cancelledRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current = null;
    setLevel(0);
  };

  const stop = useCallback(() => {
    if (recRef.current?.state === 'recording') recRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    ++generationRef.current;
    transcriptionRef.current?.abort();
    stop();
    cleanup();
    setListening(false);
    setInterim('');
  }, [stop]);

  const start = useCallback(async () => {
    if (!supported) return setError('Recording is not supported in this browser.');
    if (!window.isSecureContext) return setError('Voice input only works over HTTPS (or on localhost).');
    if (recRef.current?.state === 'recording') return;
    const generation = ++generationRef.current;
    transcriptionRef.current?.abort();
    setError(null);
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err: any) {
      if (generation !== generationRef.current) return;
      return setError(err?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser’s site settings.' : 'No microphone was found.');
    }
    if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
    streamRef.current = stream;

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);

    // Silence detection with a small level meter
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();
    let heardSpeech = false;
    let lastLoud = Date.now();
    const tick = () => {
      if (generation !== generationRef.current) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));
      if (rms > 0.03) { heardSpeech = true; lastLoud = Date.now(); }
      const now = Date.now();
      if ((heardSpeech && now - lastLoud > 1500) || now - startedAt > 30000 || (!heardSpeech && now - startedAt > 8000)) {
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rec.onstart = () => { if (generation !== generationRef.current) return; setListening(true); setInterim('Listening…'); tick(); };
    rec.onstop = async () => {
      if (generation !== generationRef.current) return;
      cleanup();
      setListening(false);
      if (cancelledRef.current || !heardSpeech) { setInterim(''); if (!heardSpeech && !cancelledRef.current) setError('I didn’t hear anything. Try again a little closer to the mic.'); return; }
      setInterim('Transcribing…');
      const abort = new AbortController();
      transcriptionRef.current = abort;
      try {
        const token = await getToken();
        if (generation !== generationRef.current) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const res = await fetch(`/api/transcribe?lang=${encodeURIComponent(lang)}`, {
          method: 'POST',
          signal: abort.signal,
          headers: { 'Content-Type': blob.type.split(';')[0], ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: blob,
        });
        const data = await res.json().catch(() => ({}));
        if (generation !== generationRef.current) return;
        if (!res.ok) throw new Error(data.error || `Transcription failed (${res.status}).`);
        if (data.text) onFinalRef.current(data.text);
        else setError('I couldn’t make out any words. Try again.');
      } catch (err: any) {
        if (generation === generationRef.current && !abort.signal.aborted) setError(err?.message || 'Transcription failed.');
      } finally {
        notifyDanteUsage();
        if (generation === generationRef.current) setInterim('');
      }
    };

    recRef.current = rec;
    rec.start(250);
  }, [supported, lang, stop, getToken]);

  useEffect(() => () => { ++generationRef.current; transcriptionRef.current?.abort(); cancelledRef.current = true; recRef.current?.state === 'recording' && recRef.current.stop(); cleanup(); }, []);

  return { supported, listening, interim, error, setError, start, stop, cancel, level };
}
