import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from './icons';
import { NoData, SuccessFlash } from './animations';

/* =============================== Toasts =================================== */

type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
const CelebrateCtx = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [celebration, setCelebration] = useState<{ id: number; text: string } | null>(null);
  const next = useRef(1);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = next.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  /** Success animation for meaningful completions (gates, creates, saves). */
  const celebrate = useCallback((text: string) => {
    const id = next.current++;
    setCelebration({ id, text });
    setTimeout(() => setCelebration((c) => (c?.id === id ? null : c)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      <CelebrateCtx.Provider value={celebrate}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>
              {t.kind === 'err' ? <X width={14} height={14} /> : <Check width={14} height={14} />}
              {t.text}
            </div>
          ))}
        </div>
        {celebration ? (
          <div className="celebration" key={celebration.id}>
            <SuccessFlash message={celebration.text} />
          </div>
        ) : null}
      </CelebrateCtx.Provider>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
export const useCelebrate = () => useContext(CelebrateCtx);

/* ================================ Modal =================================== */

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(720px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3 className="serif-h">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ================================ Card ==================================== */

export function Card({
  children, pad, kpi, className, style,
}: { children: ReactNode; pad?: boolean; kpi?: boolean; className?: string; style?: React.CSSProperties }) {
  const cls = ['card', pad ? 'pad' : '', kpi ? 'kpi' : '', className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>{children}</div>
  );
}

/* ================================ Forms =================================== */

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && !error ? <span className="hint">{hint}</span> : null}
      {error ? <span className="hint" style={{ color: 'var(--clay)' }}>{error}</span> : null}
    </div>
  );
}

export function FormRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>{children}</div>;
}

/* ================================ Buttons ================================= */

type BtnProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = 'primary', size = 'md', icon, block, children, className, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'primary' ? variant : '', size !== 'md' ? size : '', block ? 'block' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/* =============================== Data bits ================================ */

export function Badge({ tone, dot, children }: { tone?: 'terracotta' | 'gold' | 'sage' | 'clay'; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge ${tone ?? ''}`}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

export function Avatar({ name, lg, stack }: { name: string; lg?: boolean; stack?: boolean }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className={`avatar ${lg ? 'lg' : ''} ${stack ? 'stack' : ''}`} title={name}>
      {initials}
    </span>
  );
}

const zar0 = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });
const zar2 = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 });

export function Money({ v, cents = false, dash }: { v: string | number | null | undefined; cents?: boolean; dash?: string }) {
  if (v === null || v === undefined || v === '') return <span className="mono muted">{dash ?? 'none'}</span>;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return <span className="mono">{(cents ? zar2 : zar0).format(n)}</span>;
}

export function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="muted">none</span>;
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86400_000;
  const fmt = days < 1 ? 'today' : days < 2 ? 'yesterday' : days < 30 ? `${Math.round(days)}d ago` : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  return <span title={d.toLocaleString('en-ZA')}>{fmt}</span>;
}

export function Empty({ title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <NoData size={210} />
      <h3>{title}</h3>
      {sub ? <p className="fine" style={{ margin: 0, maxWidth: '42ch' }}>{sub}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ h = 60 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* =============================== Confirm ================================== */

export function Confirm({
  title, body, confirmLabel, danger, onConfirm, onClose,
}: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="grid" style={{ gap: 'var(--s4)' }}>
        <p className="fine" style={{ margin: 0 }}>{body}</p>
        <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} type="submit" disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
