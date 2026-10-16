'use client';

/**
 * PROTOTYPE ONLY — small UI kit used by every prototype screen.
 *
 * Styled after the MarketSpace provider dashboard (upnow-marketspace
 * pages/provider-dashboard/pw/app.css + css/styles.css): pill buttons (.btn),
 * dotted status pills (.st), panels (.pn), KPI tiles (.kpi), tabs (.tabs),
 * chips (.chip), fields (.fld), table (.tbl), kanban (.kc/.lc), drawer and
 * modal. Colours come from the tokens in theme.css.
 */
import { useEffect, type ReactNode } from 'react';
import { X, Search, FlaskConical, Info, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VERTICAL } from './registry';
import type { VerticalId } from './types';

// ── Formatting ────────────────────────────────────────────────────────────
const AED = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });
export const fmtAed = (n: number) => AED.format(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Formats an ISO date (YYYY-MM-DD[ HH:MM]) without timezone conversion. */
export function fmtDate(iso?: string) {
  if (!iso || iso === '—') return '—';
  const [d, t] = iso.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return iso;
  return `${day} ${MONTHS[m - 1]} ${y}${t ? `, ${t}` : ''}`;
}
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

// ── Status vocabulary (MarketSpace .st pills) ─────────────────────────────
type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';
/** .st (green) · .st.warn · .st.risk · .st.mute · .st.info — "violet" maps to the deeper brand tint. */
const TONE: Record<Tone, string> = {
  green: 'bg-[var(--g1)] text-[var(--g8)]',
  amber: 'bg-[#fbf0dc] text-[#8a5a14]',
  red: 'bg-[#f9e3e1] text-[#9a2f2a]',
  neutral: 'bg-[#eef0ef] text-[var(--ink2)]',
  blue: 'bg-[#e3eef8] text-[#1f5a8c]',
  violet: 'bg-[var(--g2)] text-[var(--g9)]',
};

const STATUS: Record<string, [string, Tone]> = {
  // org / authorisation / applications
  verified: ['Verified', 'green'], approved: ['Approved', 'green'], submitted: ['Submitted', 'blue'],
  pending_review: ['Pending review', 'blue'], changes_requested: ['Changes requested', 'amber'],
  rejected: ['Rejected', 'red'], not_requested: ['Not requested', 'neutral'],
  valid: ['Valid', 'green'], expiring: ['Expiring soon', 'amber'], missing: ['Missing', 'red'], pending: ['Pending', 'blue'],
  active: ['Active', 'green'], invited: ['Invited', 'blue'],
  // listings
  draft: ['Draft', 'neutral'], awaiting_verification: ['Waiting for verification', 'amber'], awaiting_licence: ['Awaiting licence', 'amber'], in_review: ['In review', 'blue'],
  published: ['Published', 'green'], withdrawn: ['Withdrawn', 'neutral'],
  // leads
  new: ['New', 'blue'], contacted: ['Contacted', 'violet'], qualified: ['Qualified', 'amber'], converted: ['Converted', 'green'], lost: ['Lost', 'neutral'],
  // finance
  issued: ['Issued', 'blue'], paid: ['Paid', 'green'], overdue: ['Overdue', 'red'], refunded: ['Refunded', 'violet'], void: ['Void', 'neutral'],
  held: ['Held', 'blue'], released: ['Released', 'green'], partially_released: ['Partly released', 'amber'], forfeited: ['Forfeited', 'red'],
  scheduled: ['Scheduled', 'blue'],
  // stays / courts / charters / venues
  requested: ['Requested', 'amber'], confirmed: ['Confirmed', 'green'], checked_in: ['Checked in', 'violet'], checked_out: ['Checked out', 'neutral'],
  cancelled: ['Cancelled', 'red'], held_slot: ['Held', 'amber'], blocked: ['Blocked', 'neutral'],
  enquiry: ['Enquiry', 'blue'], quote_sent: ['Quote sent', 'violet'], site_visit: ['Site visit', 'amber'], deposit_paid: ['Deposit paid', 'green'],
  completed: ['Completed', 'neutral'], manifest_complete: ['Manifest complete', 'green'], settled: ['Settled', 'neutral'],
  // services
  request: ['Request', 'blue'], quoted: ['Quoted', 'violet'], in_progress: ['In progress', 'amber'],
  brief: ['Brief', 'blue'], accepted: ['Accepted', 'green'], delivered: ['Delivered', 'neutral'],
  // experiences
  checked: ['Checked in', 'violet'], full: ['Full', 'red'],
  // memberships
  trial: ['Free visit', 'blue'], frozen: ['Frozen', 'violet'], renewal_due: ['Renewal due', 'amber'], expired: ['Expired', 'red'],
  // programs
  tour_booked: ['Tour booked', 'blue'], assessment: ['Assessment', 'violet'], offer: ['Offer made', 'amber'], enrolled: ['Enrolled', 'green'], upcoming: ['Upcoming', 'blue'],
  // insurance
  details_collected: ['Details collected', 'violet'], quotes_received: ['Quotes received', 'amber'], application: ['Application', 'blue'],
  policy_issued: ['Policy issued', 'green'], lapsed: ['Lapsed', 'red'],
};

export function statusLabel(s: string) {
  return STATUS[s]?.[0] ?? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** MarketSpace `.st` pill: 24px, bold, with a leading dot. */
export function Badge({ tone = 'neutral', children, className, dot = true }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] text-[12px] font-bold', TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [statusLabel(status), 'neutral' as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Vertical label: MarketSpace identifies packs by icon + name in the brand green, not by colour. */
export function VerticalTag({ v, size = 'sm' }: { v: VerticalId; size?: 'sm' | 'md' }) {
  const d = VERTICAL[v];
  const Icon = d.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[var(--g1)] font-bold text-[var(--g8)]', size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]')}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5 text-[var(--g7)]' : 'h-4 w-4 text-[var(--g7)]'} aria-hidden />
      {d.label}
    </span>
  );
}

// ── Layout primitives ─────────────────────────────────────────────────────
/** `.pn` panel. */
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cn('rounded-[var(--r)] border border-[var(--line)] bg-white', pad && 'p-5', className)}>{children}</div>;
}

/** `.ph` page head — serif title in the darkest green. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[var(--ink3)]">{eyebrow}</div>}
        <h1 className="ms-serif text-[32px] leading-[1.05] text-[var(--g9)] md:text-[36px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-[15px] text-[var(--ink3)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** `.pn-h h2`. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <h2 className="text-[17px] font-bold tracking-[-0.01em] text-[var(--ink)]">{children}</h2>
      <span className="flex-1" />
      {right}
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
/** `.btn-g` · `.btn-o` · `.btn-ghost` · `.act.chat` (subtle) · outline-red (danger). */
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-[var(--g7)] text-white hover:bg-[var(--g8)]',
  secondary: 'border-[1.5px] border-[var(--line2)] bg-white text-[var(--ink)] hover:border-[var(--g6)] hover:text-[var(--g8)]',
  ghost: 'text-[var(--g7)] hover:bg-[var(--g1)]',
  danger: 'border-[1.5px] border-[#efcfcb] bg-white text-[var(--red)] hover:border-[var(--red)] hover:bg-[#fdf3f2]',
  subtle: 'bg-[var(--g1)] text-[var(--g8)] hover:bg-[var(--g2)]',
};
export function Button({
  variant = 'primary', size = 'md', className, children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-full font-bold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-[34px] px-[13px] text-[13px]' : 'h-10 px-4 text-[13.5px]',
        BTN[variant], className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** `.kpi` tile. */
export function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-[var(--r)] border border-[var(--line)] bg-white px-4 pb-3 pt-4 transition-colors hover:border-[var(--g5)]">
      <div className="flex items-center justify-between text-[13px] font-semibold text-[var(--ink3)]">
        <span>{label}</span>
        {icon && <span className="text-[var(--g7)]">{icon}</span>}
      </div>
      <div className="text-[28px] font-extrabold tracking-[-0.02em] text-[var(--ink)]">{value}</div>
      {sub && <div className={cn('text-[13px] font-bold', tone === 'bad' ? 'text-[var(--red)]' : tone === 'warn' ? 'text-[var(--amber)]' : 'text-[var(--g6)]')}>{sub}</div>}
    </div>
  );
}

/** `.tabs`. */
export function Tabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--line)]">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex h-[42px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] font-bold transition-colors',
            value === t.id ? 'border-[var(--g7)] text-[var(--g8)]' : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink)]',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-[var(--bg)] px-[7px] text-[11px] text-[var(--ink2)]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** `.chip` filter row. */
export function Chips<T extends string>({ items, value, onChange }: { items: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          className={cn(
            'inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full border px-[13px] text-[13.5px] font-semibold transition-colors',
            value === c.id ? 'border-[var(--g8)] bg-[var(--g8)] text-white' : 'border-[var(--line2)] bg-white text-[var(--ink)] hover:border-[var(--g5)]',
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** `.top .srch` pill search. */
export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex h-[38px] w-72 max-w-full items-center gap-2 rounded-full border border-[var(--line2)] bg-white px-3.5 text-[var(--ink3)] focus-within:border-[var(--g6)]">
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
      />
    </label>
  );
}

/** `.empty` / `.addc` dashed card. */
export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--r)] border-[1.5px] border-dashed border-[var(--line2)] bg-white px-6 py-12 text-center">
      {icon && <div className="text-[var(--g7)]">{icon}</div>}
      <div className="font-bold text-[var(--ink)]">{title}</div>
      {body && <p className="max-w-md text-[14px] text-[var(--ink3)]">{body}</p>}
      {action}
    </div>
  );
}

/** `.qbar` progress. Turns amber near capacity and red when full. */
export function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const tone = pct >= 100 ? 'var(--red)' : pct >= 85 ? 'var(--amber)' : 'var(--g6)';
  return (
    <div className="flex items-center gap-2" title={`${value} of ${max}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <span className="w-24 shrink-0 text-right text-[12.5px] font-bold text-[var(--ink2)]">{label ?? `${value}/${max}`}</span>
    </div>
  );
}

/** Wizard step numbering (`.wz .side` circles): done = tint, current = brand green. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={`${s}-${i}`} className="flex items-center gap-1.5">
            <span className={cn('flex items-center gap-2 text-[13px] font-semibold', on ? 'text-[var(--g8)]' : done ? 'text-[var(--ink2)]' : 'text-[var(--ink3)]')}>
              <span className={cn(
                'grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] text-[11px] font-extrabold',
                on ? 'border-[var(--g7)] bg-[var(--g7)] text-white' : done ? 'border-[var(--g2)] bg-[var(--g2)] text-[var(--g8)]' : 'border-[var(--line2)] bg-white text-[var(--ink3)]',
              )}>
                {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              {s}
            </span>
            {i < steps.length - 1 && <span className={cn('h-0.5 w-4 rounded-full', done ? 'bg-[var(--g6)]' : 'bg-[var(--line)]')} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/** `.av` round avatar (tint by default, solid brand when a colour is passed). */
export function Avatar({ name, colour, size = 34 }: { name: string; colour?: string; size?: number }) {
  const initials = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-extrabold', !colour && 'bg-[var(--g2)] text-[var(--g8)]')}
      style={{ width: size, height: size, fontSize: size * 0.35, ...(colour ? { background: colour, color: '#fff' } : {}) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Inline note — `.lcard .tip` (prototype boundary) or info tint. */
export function ProtoNote({ children, kind = 'proto' }: { children: ReactNode; kind?: 'proto' | 'info' }) {
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-[var(--r-sm)] px-3 py-2.5 text-[13px] leading-relaxed',
      kind === 'proto' ? 'bg-[#fbf4e4] text-[#8a5a14]' : 'bg-[#e3eef8] text-[#1f5a8c]',
    )}>
      {kind === 'proto' ? <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

// ── Overlays ──────────────────────────────────────────────────────────────
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

const closeBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--line)] text-[var(--ink2)] hover:border-[var(--g5)] hover:text-[var(--g8)]';

/** `.scrim` + `.modal` (18px radius). */
export function Modal({ open, onClose, title, subtitle, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(12,24,18,0.45)] p-0 sm:items-center sm:p-5" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn('flex max-h-[92vh] w-full flex-col rounded-t-[18px] bg-white shadow-[var(--sh-lg)] sm:rounded-[18px]', wide ? 'sm:max-w-3xl' : 'sm:max-w-[520px]')}
      >
        <div className="flex items-start gap-3 px-[22px] pb-1 pt-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-[18px] font-bold text-[var(--ink)]">{title}</h3>
            {subtitle && <div className="mt-0.5 text-[13.5px] text-[var(--ink3)]">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className={closeBtn} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-[22px] py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] px-[22px] py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/** `.dscrim` + `.drawer` (520px). */
export function Drawer({ open, onClose, title, subtitle, children, footer }: {
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-[rgba(12,24,18,0.35)]" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[520px] flex-col bg-white shadow-[var(--sh-lg)]"
      >
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-5 py-[18px]">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[18px] font-bold text-[var(--ink)]">{title}</h3>
            {subtitle && <div className="mt-0.5 text-[13.5px] text-[var(--ink3)]">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className={closeBtn} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-[18px]">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">{footer}</div>}
      </aside>
    </div>
  );
}

// ── Form fields (`.fld`) ──────────────────────────────────────────────────
const inputCls = 'h-11 w-full min-w-0 rounded-[var(--r-sm)] border-[1.5px] border-[var(--line2)] bg-white px-3 text-[14.5px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--g6)] disabled:bg-[var(--bg)] disabled:text-[var(--ink3)]';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[5px]">
      <span className="text-[13px] font-bold text-[var(--ink2)]">{label}</span>
      {children}
      {hint && <span className="text-[12.5px] text-[var(--ink3)]">{hint}</span>}
    </label>
  );
}
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}
export function SelectInput({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[] }) {
  return (
    <select {...props} className={cn(inputCls, 'cursor-pointer pr-8', props.className)}>
      {options.map((o) => (typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, 'h-auto min-h-[80px] resize-none py-2.5', props.className)} />;
}

// ── Table (`.tbl` inside a panel) ─────────────────────────────────────────
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-white px-2.5 pt-3.5">
      <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-[var(--line)] px-2.5 pb-2.5 text-[11.5px] font-bold uppercase tracking-[0.05em] text-[var(--ink3)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:hover>td]:bg-[var(--bg)] [&>tr:last-child>td]:border-b-0">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cn('border-b border-[var(--line)] px-2.5 py-3 align-middle text-[var(--ink)]', className)}>{children}</td>
);

// ── Kanban (`.kb` / `.kc` / `.lc`) ────────────────────────────────────────
export function Kanban<T extends { id: string; stage: string }>({ columns, items, render }: {
  columns: { id: string; label: string }[]; items: T[]; render: (item: T) => ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2.5">
      {columns.map((c) => {
        const col = items.filter((i) => i.stage === c.id);
        return (
          <div key={c.id} className="flex min-h-[200px] w-[264px] shrink-0 flex-col rounded-[var(--r)] bg-[var(--kc)] p-2.5">
            <div className="flex items-center gap-2 px-1 pb-2.5 pt-1 text-[13.5px] font-extrabold text-[var(--ink)]">
              <span>{c.label}</span>
              <span className="font-semibold text-[var(--ink3)]">{col.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {col.length === 0 && <div className="rounded-xl border-[1.5px] border-dashed border-[var(--line2)] px-3 py-4 text-center text-[12.5px] text-[var(--ink3)]">Nothing here</div>}
              {col.map((i) => <div key={i.id}>{render(i)}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
