export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Dante's signature orb. The animation for each state lives in index.css (.orb[data-state=…]). */
export default function DanteOrb({ state = 'idle', size = 64, className = '' }: { state?: OrbState; size?: number; className?: string }) {
  return (
    <span className={`orb shrink-0 ${className}`} data-state={state} style={{ width: size, height: size }} aria-hidden="true">
      <span className="orb__glow" />
      <span className="orb__ring" />
      <span className="orb__ring" />
      <span className="orb__core" />
    </span>
  );
}
