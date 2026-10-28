import {tr,useUiLanguage} from '../../i18n';
import { ReactNode, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { categoryTone } from '../../lib/utils';

// ---- shared class names (ZEN OS v2 design system) ----
export const card = 'rounded-xl bg-surface-container-lowest shadow-soft';
export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary font-medium transition-colors shadow-soft cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
  solid: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-on-primary hover:opacity-90 font-medium transition cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
  secondary: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-medium transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer',
  danger: 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-error-container text-error hover:opacity-90 font-medium transition cursor-pointer active:scale-[0.98]',
  icon: 'w-9 h-9 inline-flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer',
};
export const input =
  'w-full h-10 px-3 rounded-lg bg-surface-container-low text-on-surface placeholder:text-on-surface-variant outline-none border border-transparent focus:border-primary/40 focus:ring-2 focus:ring-primary/15 transition';
export const textarea =
  'w-full px-3 py-2 rounded-lg bg-surface-container-low text-on-surface placeholder:text-on-surface-variant outline-none border border-transparent focus:border-primary/40 focus:ring-2 focus:ring-primary/15 transition resize-y min-h-[80px]';

export function Icon({ name, className = '', fill = false }: { name: string; className?: string; fill?: boolean }) {
  useUiLanguage();
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true" style={fill ? { fontVariationSettings: "'FILL' 1" } : undefined}>
      {name}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  useUiLanguage();
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[24px] leading-8 font-semibold tracking-tight text-on-surface">{title}</h1>
        {subtitle && <p className="text-on-surface-variant mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  useUiLanguage();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-on-surface-variant">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-on-surface-variant">{hint}</span>}
    </label>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  useUiLanguage();
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-6">
      <div className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center">
        <Icon name={icon} className="text-[24px] text-primary" />
      </div>
      <div className="font-medium text-on-surface">{title}</div>
      {text && <p className="text-[12px] text-on-surface-variant max-w-xs">{text}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function CategoryChip({ cat }: { cat?: { id: string; label: string; color?: string } | null }) {
  useUiLanguage();
  if (!cat) return null;
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${categoryTone(cat).chip}`}>{cat.label}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; label: string }) {
  useUiLanguage();
  return (
    <div className="inline-flex p-1 rounded-lg bg-surface-container-low" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all cursor-pointer ${value === o.value ? 'bg-surface-container-lowest text-on-surface shadow-soft' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          {o.icon && <Icon name={o.icon} className="text-[16px]" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Accessible modal: Escape closes, focus moves inside, backdrop click closes. */
export function Modal({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  useUiLanguage();
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={e => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col"
            style={{ maxWidth: width }}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-[18px] font-semibold text-on-surface">{title}</h2>
              <button className={btn.icon} onClick={onClose} aria-label={tr("Close")}>
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>
            <div className="px-5 pb-5 overflow-y-auto flex flex-col gap-4">{children}</div>
            {footer && <div className="px-5 py-4 border-t border-outline-variant flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
