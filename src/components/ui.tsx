import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AppWindow,
  Archive,
  CheckCircle2,
  File,
  FileText,
  Film,
  Image,
  Info,
  Magnet,
  Music,
  X,
} from 'lucide-react';
import { DownloadCategory, DownloadSegment, DownloadTask } from '../types';
import { STATUS_LABEL } from '../lib/format';

/* ───────────── Brand mark: three lanes converging into one arrow ───────────── */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
    <rect x="6" y="5.5" width="2.4" height="8" rx="1.2" fill="#fff" opacity="0.55" />
    <rect x="10.8" y="5.5" width="2.4" height="9.5" rx="1.2" fill="#fff" />
    <rect x="15.6" y="5.5" width="2.4" height="8" rx="1.2" fill="#fff" opacity="0.55" />
    <path d="M7.5 15.2 12 19l4.5-3.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ───────────── File icon by category ───────────── */
const CAT_ICON: Record<DownloadCategory, React.FC<any>> = {
  video: Film,
  audio: Music,
  compressed: Archive,
  document: FileText,
  program: AppWindow,
  torrent: Magnet,
  image: Image,
  other: File,
};
export const FileIcon: React.FC<{ category: DownloadCategory }> = ({ category }) => {
  const Icon = CAT_ICON[category] || File;
  return (
    <span className="file-icon" data-cat={category}>
      <Icon />
    </span>
  );
};

export const StatusText: React.FC<{ status: DownloadTask['status'] }> = ({ status }) => (
  <span className="status" data-s={status}>
    {STATUS_LABEL[status]}
  </span>
);

/* ───────────── Lanes: one bar per connection ───────────── */
function toLanes(segments: DownloadSegment[], max: number): { fill: number; status: DownloadSegment['status'] }[] {
  const segs = [...segments].sort((a, b) => a.startByte - b.startByte);
  if (segs.length <= max) {
    return segs.map((s) => ({
      fill: s.total > 0 ? Math.min(1, Math.max(0, s.downloaded / s.total)) : s.status === 'completed' ? 1 : 0,
      status: s.status,
    }));
  }
  const per = segs.length / max;
  return Array.from({ length: max }, (_, i) => {
    const group = segs.slice(Math.floor(i * per), Math.floor((i + 1) * per));
    const total = group.reduce((a, s) => a + s.total, 0);
    const done = group.reduce((a, s) => a + Math.min(s.downloaded, s.total), 0);
    const status = group.some((s) => s.status === 'downloading')
      ? 'downloading'
      : group.every((s) => s.status === 'completed')
        ? 'completed'
        : group.some((s) => s.status === 'error')
          ? 'error'
          : 'pending';
    return { fill: total ? done / total : 0, status };
  });
}

export const Lanes: React.FC<{ task: DownloadTask; max?: number; big?: boolean }> = ({ task, max = 16, big }) => {
  const indeterminate = task.status === 'downloading' && (!task.segments.length || !task.totalBytes);
  const lanes = indeterminate
    ? Array.from({ length: Math.min(max, 8) }, () => ({ fill: 0, status: 'downloading' as const }))
    : task.segments.length
      ? toLanes(task.segments, max)
      : [{ fill: task.status === 'completed' ? 1 : 0, status: 'pending' as const }];
  return (
    <div
      className={`lanes${big ? ' lanes-big' : ''}${indeterminate ? ' indeterminate' : ''}`}
      data-task={task.status}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={task.totalBytes ? Math.round((task.downloadedBytes / task.totalBytes) * 100) : undefined}
    >
      {lanes.map((l, i) => (
        <span key={i} className="lane" data-s={l.status}>
          <i style={{ width: `${(l.fill * 100).toFixed(2)}%` }} />
        </span>
      ))}
    </div>
  );
};

/* ───────────── Controls ───────────── */
export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
);

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Modal ───────────── */
export const Modal: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: 'narrow' | 'wide';
  footer?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  /** Children provide their own body/footer markup */
  raw?: boolean;
}> = ({ title, subtitle, onClose, size, footer, children, bodyClassName, raw }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Respect an element React already focused (autoFocus), else the first field, else the main action
    if (el && !el.contains(document.activeElement)) {
      const target =
        el.querySelector<HTMLElement>('.dialog-body input:not([readonly]), .dialog-body textarea, .dialog-body select') ||
        el.querySelector<HTMLElement>('.btn-primary, .btn-danger') ||
        el.querySelector<HTMLElement>('button');
      target?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex="0"]')).filter(
          (n) => !n.hasAttribute('disabled')
        );
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${size || ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {raw ? children : <div className={`dialog-body ${bodyClassName || ''}`}>{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
};

/* ───────────── Toasts ───────────── */
type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const Icon = { info: Info, success: CheckCircle2, error: AlertCircle };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className="toast" data-kind={t.kind}>
              <I />
              <p>{t.text}</p>
              <button className="icon-btn" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
                <X />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
};

/* ───────────── Context menu ───────────── */
export interface MenuItem {
  label: string;
  icon?: React.FC<any>;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}
export const ContextMenu: React.FC<{ x: number; y: number; items: MenuItem[]; onClose: () => void }> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    el.querySelector('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll('button') || []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[n]?.focus();
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {it.separatorBefore && <hr />}
          <button
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon && <it.icon />}
            {it.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};
