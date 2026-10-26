export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Dante's signature orb. The animation for each state lives in index.css (.orb[data-state=…]). */
/** level (0–1) makes the orb react to your voice in real time. */
export default function DanteOrb({ state = 'idle', size = 64, className = '', level = 0 }: { state?: OrbState; size?: number; className?: string; level?: number }) {
  return (
    <span className={`orb shrink-0 ${className}`} data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <span className="orb__glow" style={level ? { opacity: 0.35 + Math.min(level, 1) * 0.5, transform: `scale(${1 + Math.min(level, 1) * 0.5})` } : undefined} />
      <span className="orb__ring" />
      <span className="orb__ring" />
      <span className="orb__core" style={level ? { transform: `scale(${1 + Math.min(level, 1) * 0.28})`, transition: 'transform 80ms linear', animation: 'none' } : undefined} />
    </span>
  );
}
