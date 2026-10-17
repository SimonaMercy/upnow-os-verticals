'use client';

/**
 * Genspark OS component kit (React). Styles: ./gx.css (scoped under .gx).
 * Every screen of the rebuilt OS composes these — do not restyle pages ad hoc.
 *
 * Conventions:
 *  - Row actions are always LABELLED buttons ("Open", "Review"), never icon-only.
 *  - Preview (no-backend) data is always wrapped in <PreviewBanner/> or carries <PreviewPill/>.
 *  - Money: use fmtFils() for integer-fils fields, fmtAed() for AED decimals the API returns as strings.
 */
import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Lock, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import './gx.css';

// ---------------------------------------------------------------------------- formatting

const aedFmt = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });
const aedFmt2 = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer fils → "AED 1,234". */
export function fmtFils(fils: number | string | null | undefined, cents = false): string {
  if (fils == null || fils === '') return '—';
  const n = Number(fils);
  if (!Number.isFinite(n)) return '—';
  return (cents ? aedFmt2 : aedFmt).format(n / 100);
}
/** AED amount (number or decimal string like "60000.00") → "AED 60,000". */
export function fmtAed(aed: number | string | null | undefined, cents = false): string {
  if (aed == null || aed === '') return '—';
  const n = Number(aed);
  if (!Number.isFinite(n)) return '—';
  return (cents ? aedFmt2 : aedFmt).format(n);
}
/** Compact AED: 694300 → "AED 694K", 4890000 → "AED 4.89M". */
export function fmtAedK(aed: number | string | null | undefined): string {
  const n = Number(aed ?? 0);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `AED ${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `AED ${Math.round(n / 1e3)}K`;
  return aedFmt.format(n);
}
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
}
export const initials = (s: string | null | undefined) =>
  (s ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '·';

// ---------------------------------------------------------------------------- layout

export function OsPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('gx gx-body', className)}>{children}</div>;
}

export function PageHead({ eyebrow, title, lede, actions }: { eyebrow: string; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="gx-ph">
      <div className="gx-ph-t">
        <div className="gx-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {lede && <p>{lede}</p>}
      </div>
      {actions && <div className="gx-btn-row">{actions}</div>}
    </div>
  );
}

/** "Workspace · Vertical · Authorisation · Data" strip under the page head. */
export function ScopeStrip({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="gx-scope">
      {items.map((it, i) => (
        <span key={it.label} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep" />}
          <span className="sl">{it.label}</span>
          <span>{it.value}</span>
        </span>
      ))}
    </div>
  );
}

export function Card({ title, sub, right, children, pad = false, className }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; pad?: boolean; className?: string;
}) {
  return (
    <section className={cn('gx-card', className)}>
      {(title || right) && (
        <div className="gx-card-hd">
          <div>{title && <h3>{title}</h3>}{sub && <div className="sub">{sub}</div>}</div>
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {pad ? <div className="gx-pad">{children}</div> : children}
    </section>
  );
}

export function Cols({ kind = '2', children }: { kind?: '2' | '2e' | '3'; children: ReactNode }) {
  return <div className={`gx-cols gx-cols-${kind}`} style={{ marginBottom: 14 }}>{children}</div>;
}

// ---------------------------------------------------------------------------- KPIs & attention

export function Kpis({ children }: { children: ReactNode }) { return <div className="gx-kpis">{children}</div>; }
export function Kpi({ k, v, d, dark, href }: { k: string; v: ReactNode; d?: ReactNode; dark?: boolean; href?: string }) {
  const body = <><div className="k">{k}</div><div className="v">{v}</div>{d && <div className="d">{d}</div>}</>;
  return href
    ? <Link href={href} className={cn('gx-kpi', dark && 'dark')}>{body}</Link>
    : <div className={cn('gx-kpi', dark && 'dark')}>{body}</div>;
}
export function Attn({ children }: { children: ReactNode }) { return <div className="gx-attn">{children}</div>; }
export function AttnCard({ tone, n, t, s, href }: { tone: 'warn' | 'bad' | 'ok'; n: ReactNode; t: string; s?: string; href: string }) {
  return (
    <Link href={href} className={`gx-attn-c ${tone}`}>
      <span className="n">{n}</span>
      <span><span className="t">{t}</span>{s && <span className="s">{s}</span>}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------- pills

export type Tone = 'neutral' | 'primary' | 'amber' | 'danger' | 'info' | 'dark' | 'outline' | 'preview';

/** Status → tone, using the existing StatusPill vocabulary plus OS/compliance states. */
const STATUS_TONE: Record<string, Tone> = {
  pending: 'amber', confirmed: 'primary', 'in-progress': 'info', in_progress: 'info', completed: 'primary', cancelled: 'neutral',
  refunded: 'neutral', 'on-hold': 'amber', reviewing: 'info', in_review: 'info', approved: 'primary', rejected: 'danger',
  scheduled: 'info', rescheduled: 'amber', 'awaiting-payment': 'amber', paid: 'primary', overdue: 'danger', archived: 'neutral',
  draft: 'neutral', published: 'primary', suspended: 'danger', active: 'primary', inactive: 'neutral', expired: 'danger',
  dispute: 'danger', resolved: 'primary', issued: 'info', notice: 'amber', terminated: 'neutral', ended: 'neutral',
  compliant: 'primary', pending_review: 'amber', action_required: 'amber', paused: 'danger', granted: 'primary',
  refused: 'danger', none: 'neutral', waiting: 'amber', changes: 'amber', changes_requested: 'amber', live: 'primary',
  held: 'info', released: 'neutral', bounced: 'danger', cleared: 'primary', deposited: 'info', open: 'amber', closed: 'neutral',
  new: 'info', contacted: 'info', viewing: 'info', won: 'primary', lost: 'neutral', processed: 'primary', uploaded: 'info',
  missing: 'danger', verified: 'primary', available: 'primary', occupied: 'info', let: 'primary', vacant: 'neutral', reserved: 'amber',
};
export function toneOf(status: string | null | undefined): Tone {
  return STATUS_TONE[String(status ?? '').toLowerCase()] ?? 'neutral';
}
export const humanize = (s: string | null | undefined) =>
  String(s ?? '—').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function Pill({ tone = 'neutral', dot = true, children, title }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return <span className={cn('gx-pill', tone, dot && 'dot')} title={title}>{children}</span>;
}
/** A status pill straight from an API status string. */
export function StatusTag({ status, label }: { status: string | null | undefined; label?: string }) {
  return <Pill tone={toneOf(status)}>{label ?? humanize(status)}</Pill>;
}

// ---------------------------------------------------------------------------- buttons

type BtnProps = {
  children: ReactNode; href?: string; onClick?: () => void; variant?: 'primary' | 'danger' | 'amber' | 'ghost';
  size?: 'sm' | 'xs'; disabled?: boolean; type?: 'button' | 'submit'; title?: string; target?: string;
};
export function Btn({ children, href, onClick, variant, size, disabled, type = 'button', title, target }: BtnProps) {
  const cls = cn('gx-btn', variant, size);
  if (href && !disabled) return <Link href={href} className={cls} title={title} target={target}>{children}</Link>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

// ---------------------------------------------------------------------------- table bits

export function TableWrap({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="gx-tbl-wrap">
      {toolbar && <div className="gx-tbar">{toolbar}</div>}
      <div className="gx-tbl-scroll">{children}</div>
    </div>
  );
}
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="gx-field">
      <Search size={14} aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}
export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { v: T; l: ReactNode; n?: number }[]; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="gx-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={o.v === value} onClick={() => onChange(o.v)}>
          {o.l}{o.n != null && <span className="n">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}
export function Thumb({ text, src }: { text: string; src?: string | null }) {
  return <span className="gx-thumb">{src ? <img src={src} alt="" /> : initials(text)}</span>;
}
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody aria-busy="true">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>{Array.from({ length: cols }).map((__, c) => <td key={c}><div className="gx-skel" style={{ height: 12, width: c === 0 ? '70%' : '50%' }} /></td>)}</tr>
      ))}
    </tbody>
  );
}
export function EmptyRow({ cols, title, text }: { cols: number; title: string; text?: string }) {
  return <tbody><tr><td colSpan={cols}><div className="gx-empty"><b>{title}</b>{text}</div></td></tr></tbody>;
}
export function ErrorRow({ cols, onRetry }: { cols: number; onRetry?: () => void }) {
  return (
    <tbody><tr><td colSpan={cols}><div className="gx-empty"><b>Couldn&apos;t load this list</b>
      {onRetry && <div style={{ marginTop: 8 }}><Btn size="sm" onClick={onRetry}>Try again</Btn></div>}
    </div></td></tr></tbody>
  );
}

// ---------------------------------------------------------------------------- messages

export function Callout({ tone, title, children }: { tone?: 'warn' | 'bad' | 'info'; title?: string; children: ReactNode }) {
  const Ic = tone === 'warn' || tone === 'bad' ? AlertTriangle : tone === 'info' ? Info : CheckCircle2;
  return (
    <div className={cn('gx-callout', tone)}>
      <Ic size={15} aria-hidden />
      <div>{title && <strong>{title} </strong>}{children}</div>
    </div>
  );
}
export function Evid({ tone, children }: { tone?: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <div className={cn('gx-evid', tone)}>{children}</div>;
}
export function KV({ items }: { items: { k: string; v: ReactNode }[] }) {
  return <div className="gx-kv">{items.map((i) => <div key={i.k}><div className="k">{i.k}</div><div className="v">{i.v ?? '—'}</div></div>)}</div>;
}
export function Bars({ rows }: { rows: { l: string; pct: number; v: ReactNode; tone?: 'amber' | 'danger' }[] }) {
  return (
    <div className="gx-bars">
      {rows.map((r) => (
        <div key={r.l} className="r">
          <span className="l" title={r.l}>{r.l}</span>
          <span className={cn('gx-bar', r.tone)}><i style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} /></span>
          <span className="v">{r.v}</span>
        </div>
      ))}
    </div>
  );
}
export function Flow({ steps, current }: { steps: { t: string; s?: string }[] | string[]; current?: number }) {
  return (
    <div className="gx-flow">
      {steps.map((st, i) => {
        const t = typeof st === 'string' ? st : st.t;
        const s = typeof st === 'string' ? undefined : st.s;
        const cls = current == null ? '' : i < current ? 'done' : i === current ? 'current' : '';
        return (
          <div key={t + i} className={cn('gx-flow-step', cls)}>
            <div className="gx-flow-n">{current != null && i < current ? '✓' : i + 1}</div>
            <div className="gx-flow-t">{t}</div>{s && <div className="gx-flow-s">{s}</div>}
          </div>
        );
      })}
    </div>
  );
}
export function Timeline({ items }: { items: { t: ReactNode; s?: ReactNode; state?: 'done' | 'now' | 'bad'; mark?: ReactNode }[] }) {
  return (
    <div className="gx-tl">
      {items.map((it, i) => (
        <div key={i} className={cn('gx-tl-i', it.state)}>
          <div className="gx-tl-d">{it.mark ?? (it.state === 'done' ? '✓' : i + 1)}</div>
          <div className="gx-tl-b"><div className="gx-tl-t">{it.t}</div>{it.s && <div className="gx-tl-s">{it.s}</div>}</div>
        </div>
      ))}
    </div>
  );
}
export function Checklist({ items }: { items: { l: ReactNode; sub?: ReactNode; state: 'pass' | 'fail' | 'wait' }[] }) {
  return (
    <div className="gx-chk">
      {items.map((c, i) => (
        <div key={i} className={`gx-chk-i ${c.state}`}>
          <span className="box">{c.state === 'pass' ? '✓' : c.state === 'fail' ? '!' : '…'}</span>
          <span><span className="lb">{c.l}</span>{c.sub && <span className="sub">{c.sub}</span>}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- board

export function Board({ children }: { children: ReactNode }) { return <div className="gx-board">{children}</div>; }
export function BoardCol({ title, count, tone, children }: { title: string; count: number; tone?: 'booking' | 'res' | 'court' | 'charter'; children: ReactNode }) {
  return (
    <div className={cn('gx-bcol', tone)}>
      <div className="gx-bcol-hd"><span className="t">{title}</span><span className="c">{count}</span></div>
      {count === 0 ? <div className="gx-bcol-empty">Nothing here</div> : children}
    </div>
  );
}
export function BoardCard({ t, m, amt, tag, onClick, href }: { t: ReactNode; m?: ReactNode; amt?: ReactNode; tag?: ReactNode; onClick?: () => void; href?: string }) {
  const body = <><span className="t">{t}</span>{m && <span className="m">{m}</span>}<span className="f">{tag}{amt && <span className="amt">{amt}</span>}</span></>;
  return href ? <Link href={href} className="gx-bcard">{body}</Link> : <button type="button" className="gx-bcard" onClick={onClick}>{body}</button>;
}

// ---------------------------------------------------------------------------- locked & preview

export function Locked({ title, text, reqK, reqV, actions }: { title: string; text: ReactNode; reqK?: string; reqV?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="gx-locked">
      <div className="ic"><Lock size={22} aria-hidden /></div>
      <h2>{title}</h2>
      <p>{text}</p>
      {reqK && <div className="req"><div className="k">{reqK}</div><div className="v">{reqV}</div></div>}
      {actions && <div className="gx-btn-row" style={{ marginTop: 14, justifyContent: 'center' }}>{actions}</div>}
    </div>
  );
}
/** Mandatory on any screen or section showing Genspark preview data (no backend). */
export function PreviewBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="gx-preview" role="note">
      <Info size={15} aria-hidden />
      <div><strong>Preview — not saved.</strong> {children ?? 'This workflow has no backend yet. Records are demonstration data held in this browser tab; changes reset when you sign out or close the tab.'}</div>
    </div>
  );
}
export function PreviewPill() { return <Pill tone="preview" dot={false} title="Demonstration data — not saved">Preview</Pill>; }

// ---------------------------------------------------------------------------- overlays

function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !node) return;
      const f = node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
  }, [open, onClose]);
  return ref;
}

export function Drawer({ open, onClose, title, sub, lead, footer, children }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; lead?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  const ref = useOverlay(open, onClose);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="gx-scrim" onClick={onClose} />
      <aside ref={ref} className="gx-drawer" role="dialog" aria-modal="true">
        <div className="gx-dr-hd">
          {lead}
          <div style={{ flex: 1, minWidth: 0 }}><div className="t">{title}</div>{sub && <div className="s">{sub}</div>}</div>
          <button type="button" className="gx-x" onClick={onClose} aria-label="Close panel"><X size={16} /></button>
        </div>
        <div className="gx-dr-bd gx">{children}</div>
        {footer && <div className="gx-dr-ft gx">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

export function Modal({ open, onClose, title, footer, children, width }: {
  open: boolean; onClose: () => void; title: ReactNode; footer?: ReactNode; children: ReactNode; width?: number;
}) {
  const ref = useOverlay(open, onClose);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="gx-scrim" onClick={onClose} />
      <div ref={ref} className="gx-modal" role="dialog" aria-modal="true" style={width ? { width } : undefined}>
        <div className="gx-md-hd"><h3>{title}</h3><button type="button" className="gx-x" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="gx-md-bd gx">{children}</div>
        {footer && <div className="gx-md-ft gx">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------- form controls

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="gx-form-row">
      <label className="gx-lb" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="gx-hint">{hint}</div>}
      {error && <div className="gx-err" role="alert">{error}</div>}
    </div>
  );
}
