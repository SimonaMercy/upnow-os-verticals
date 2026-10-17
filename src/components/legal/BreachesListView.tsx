'use client';

/**
 * Breaches — the breach pipeline's own page (owner, 14 Sep 2026: "keep
 * breaches and Legal separate — separate pages"). Warnings in progress on
 * leases: stage counts, open / closed, rows that open the lease's Breaches
 * section, and the one-click Escalate link the Operations board has. A breach
 * whose lease already has a case is flagged: it is hidden on the Operations
 * Breach board (a lease in legal shows on Legal only) but still listed here
 * so nothing is lost.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gavel, Loader2, Search, ShieldAlert } from 'lucide-react';
import { ReportBreachDialog } from '@/components/legal/ReportBreachDialog';
import { APP_TIME_ZONE } from '@/lib/datetime';
import {
  legalApi, breachStageTone, daysFromToday, BREACH_STAGE_LABELS, BREACH_CATEGORY_LABELS,
  type BreachRow, type BreachStage, type BreachCategory,
} from '@/lib/legal';

const fmtD = (d?: string | null) => d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const pillCls = 'text-[10px] font-bold px-[7px] py-[2px] rounded-full';
const OPEN_STAGES: BreachStage[] = ['reported', 'warning_sent', 'final_warning'];
const chipStyle = (on: boolean) => on ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e', border: '1px solid #e6e8e6' };

export function BreachesListView({ base, rp, leaseHrefOf, caseHrefOf, legalHref, breachHrefOf }: {
  base: string; rp?: number | null;
  /** The Legal (cases) page, for the cross-link in the intro. */
  legalHref: string;
  /** The lease page; rows add `#sec-breaches` (and `?escalate=<id>` for the Escalate link). */
  leaseHrefOf: (leaseId: number) => string;
  /** The breach's own page. A breach used to open only inside its lease; without this prop it still does. */
  breachHrefOf?: (breachId: number) => string;
  caseHrefOf: (caseId: number) => string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<BreachRow[] | null>(null);
  const [caseByLease, setCaseByLease] = useState<Map<number, number>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [stage, setStage] = useState<BreachStage | ''>('');
  const [category, setCategory] = useState<BreachCategory | ''>('');
  const [q, setQ] = useState('');
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null); setErr(null);
    Promise.all([
      legalApi.breaches(base, rp ?? undefined, {}),
      legalApi.disputes(base, rp ?? undefined, { open: true }).catch(() => ({ items: [], counts: {} })),
    ])
      .then(([b, d]) => { if (!live) return; setRows(b.items); setCaseByLease(new Map(d.items.map(x => [x.leaseId, x.id]))); })
      .catch(e => { if (live) { setErr((e as Error)?.message || 'Could not load breaches.'); setRows([]); } });
    return () => { live = false; };
  }, [base, rp, reloadKey]);

  const all = rows ?? [];
  const open = all.filter(b => OPEN_STAGES.includes(b.stage));
  const closed = all.filter(b => !OPEN_STAGES.includes(b.stage));
  const stageCount = (s: BreachStage) => all.filter(b => b.stage === s).length;
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => (showClosed ? closed : open)
    .filter(b => !stage || b.stage === stage)
    .filter(b => !category || b.category === category)
    .filter(b => !needle || [`#${b.id}`, b.lease?.unitNumber, b.lease?.customerName, b.lease?.buildingName, b.categoryLabel, b.description].some(v => (v ?? '').toLowerCase().includes(needle))),
    [showClosed, closed, open, stage, category, needle]);
  const onLeaseInLegal = open.filter(b => caseByLease.has(b.leaseId)).length;

  const withQuery = (href: string, extra: string) => `${href}${href.includes('?') ? '&' : '?'}${extra}#sec-breaches`;

  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[-.01em]">Breaches</h1>
          <p className="text-[12.5px] text-[#5b615e] mt-1">Behaviour and agreement breaches handled with warnings. A breach becomes a legal case only when you escalate it — cases live on the <Link href={legalHref} className="text-[#1a7a52] hover:text-[#125a3c] underline">Legal</Link> page.</p>
        </div>
        <button type="button" onClick={() => setReporting(true)} className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] whitespace-nowrap cursor-pointer">+ Report breach</button>
      </div>
      {notice && <div className="mt-3 px-3 py-2 rounded-lg text-[12px]" style={{ background: '#e6f4ef', color: '#125a3c', border: '1px solid #bfe3d3' }}>{notice}</div>}
      {reporting && <ReportBreachDialog base={base} rp={rp} onClose={() => setReporting(false)} onDone={b => { setReporting(false); setNotice(`Breach #${b.id} reported on Unit ${b.lease?.unitNumber ?? ''} — issue the warning from the lease's Breaches section.`); setReloadKey(k => k + 1); }} />}

      {/* stage counts — the three open stages, each a filter, plus the closed ones */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-[22px]">
        {OPEN_STAGES.map(s => {
          const t = breachStageTone(s); const on = stage === s && !showClosed;
          return (
            <button key={s} type="button" onClick={() => { setShowClosed(false); setStage(on ? '' : s); }}
              className="bg-white border rounded-xl px-4 py-3.5 text-left cursor-pointer hover:border-[#c9cfcb]" style={{ borderColor: on ? t.fg : '#e6e8e6' }}>
              <p className="text-[11px] text-[#5b615e]">{BREACH_STAGE_LABELS[s]}</p>
              <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: t.fg }}>{rows ? stageCount(s) : '…'}</p>
            </button>
          );
        })}
        <div className="bg-white border border-[#e6e8e6] rounded-xl px-4 py-3.5">
          <p className="text-[11px] text-[#5b615e]">Resolved · Escalated</p>
          <p className="text-[22px] font-extrabold mt-1 leading-none text-[#5b615e]">{rows ? `${stageCount('resolved')} · ${stageCount('escalated')}` : '…'}</p>
        </div>
      </div>

      {onLeaseInLegal > 0 && !showClosed && (
        <p className="text-[11.5px] text-[#5b615e] mt-3">
          {onLeaseInLegal} open breach{onLeaseInLegal === 1 ? ' is' : 'es are'} on a lease that already has a legal case — listed here with a purple chip, not on the Operations Breach board (a lease in legal shows on the Legal side only).
        </p>
      )}

      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        <label className="relative w-full sm:w-[260px]">
          <Search size={13} className="absolute left-3 top-[10px] text-[#8a8f8c]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, customer, building…"
            className="pl-8 pr-3 py-2 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full" />
        </label>
        <select value={category} onChange={e => setCategory(e.target.value as BreachCategory | '')} className="text-[12px] px-3 py-2 border border-[#e6e8e6] rounded-lg bg-white" style={category ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All breach types</option>
          {(Object.keys(BREACH_CATEGORY_LABELS) as BreachCategory[]).map(c => <option key={c} value={c}>{BREACH_CATEGORY_LABELS[c]}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => { setShowClosed(false); setStage(''); }} className="text-[11px] px-3 py-1.5 rounded-full font-semibold cursor-pointer" style={chipStyle(!showClosed)}>Open · {rows ? open.length : '…'}</button>
          <button type="button" onClick={() => { setShowClosed(true); setStage(''); }} className="text-[11px] px-3 py-1.5 rounded-full font-semibold cursor-pointer" style={chipStyle(showClosed)}>Resolved / escalated · {rows ? closed.length : '…'}</button>
        </div>
      </div>

      {err && <p className="text-[11px] text-red-600 mt-3">{err}</p>}
      {rows == null && !err && <div className="flex items-center gap-2 text-[12px] text-[#8a8f8c] mt-6"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {rows && list.length === 0 && !err && (
        <div className="bg-white rounded-2xl border border-[#e4e9e5] p-12 text-center mt-4">
          <ShieldAlert size={20} className="mx-auto text-[#9a5b00]" />
          <p className="text-[12.5px] text-[#5b615e] mt-2">{showClosed ? 'No resolved or escalated breaches yet.' : 'No open breaches. Report one from a lease’s Breaches section.'}</p>
        </div>
      )}
      {rows && list.length > 0 && (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] overflow-hidden mt-4">
          <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_130px_minmax(0,1.3fr)_150px] px-[18px] py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]">
            <span>UNIT · CUSTOMER</span><span>BREACH</span><span>STAGE</span><span>NEXT</span><span className="text-right">ACTION</span>
          </div>
          {list.map(b => {
            const t = breachStageTone(b.stage);
            const days = daysFromToday(b.nextDate);
            const caseId = caseByLease.get(b.leaseId) ?? (b.disputeId ?? undefined);
            // The WHOLE row opens the breach. The links inside it (lease, case, Escalate) keep
            // their own targets — they stop the click from reaching the row.
            const openHref = breachHrefOf ? breachHrefOf(b.id) : `${leaseHrefOf(b.leaseId)}#sec-breaches`;
            const own = (e: React.MouseEvent) => e.stopPropagation();
            return (
              <div key={b.id} role="link" tabIndex={0} aria-label={`Open breach #${b.id}`}
                onClick={() => router.push(openHref)}
                onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) router.push(openHref); }}
                className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_130px_minmax(0,1.3fr)_150px] items-center px-[18px] py-3.5 text-[12.5px] border-b border-[#f1f3f1] last:border-0 hover:bg-[#f3f8f5] cursor-pointer focus:outline-none focus-visible:bg-[#f3f8f5]">
                <div className="min-w-0">
                  <div className="font-semibold truncate">Unit {b.lease?.unitNumber ?? '—'} <span className="font-normal text-[#5b615e]">{b.lease?.customerName ?? ''}</span></div>
                  <div className="text-[11px] text-[#8a8f8c] truncate">Breach #{b.id} · {b.lease?.buildingName ?? ''} · <Link href={leaseHrefOf(b.leaseId)} onClick={own} className="text-[#1a7a52] hover:underline">CID-{b.leaseId}</Link> · opened {fmtD(b.openedDate)}</div>
                </div>
                <div className="min-w-0"><div className="font-semibold truncate">{b.categoryLabel}</div>{b.description && <div className="text-[11px] text-[#8a8f8c] truncate">{b.description}</div>}</div>
                <div className="flex flex-col items-start gap-1">
                  <span className={pillCls} style={{ background: t.bg, color: t.fg }}>{b.stageLabel}</span>
                  {caseId != null && (
                    <Link href={caseHrefOf(caseId)} onClick={own} className={pillCls + ' no-underline'} style={{ background: '#ece9fd', color: '#5b3fbf' }} title={b.stage === 'escalated' ? 'The case this breach opened' : 'This lease is already in legal'}>
                      {b.stage === 'escalated' ? 'case' : 'also case'} #{caseId}
                    </Link>
                  )}
                </div>
                <div className="min-w-0">
                  {b.nextDate ? (
                    <div className="font-semibold" style={{ color: days != null && days < 0 ? '#b42318' : '#1c1f1d' }}>{fmtD(b.nextDate)} <span className="text-[11px] font-normal text-[#8a8f8c]">· {days == null ? '' : days < 0 ? `${-days}d ago` : `in ${days}d`}</span></div>
                  ) : <div className="text-[#8a8f8c]">{b.stage === 'resolved' ? `Resolved ${fmtD(b.resolvedDate)}` : '—'}</div>}
                  <div className="text-[11px] truncate" style={{ color: b.alert ? '#b42318' : '#8a8f8c' }}>{b.alert?.text ?? b.hint}</div>
                </div>
                <div className="text-right flex items-center justify-end gap-3">
                  {b.actions.escalate && (
                    <Link href={breachHrefOf ? `${breachHrefOf(b.id)}${breachHrefOf(b.id).includes('?') ? '&' : '?'}escalate=1` : withQuery(leaseHrefOf(b.leaseId), `escalate=${b.id}`)} onClick={own} className="inline-flex items-center gap-1 text-[11px] font-semibold no-underline" style={{ color: '#5b3fbf' }} title="Opens the breach with the Escalate dialog">
                      <Gavel size={12} /> Escalate
                    </Link>
                  )}
                  <Link href={openHref} onClick={own} className="text-[12px] font-semibold text-[#1a7a52] hover:text-[#125a3c] no-underline">Open →</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
