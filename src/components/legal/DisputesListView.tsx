'use client';

/**
 * Legal pipeline — Disputes list (spec §7.2). Shared by the RP portal
 * (base '/legal') and the manager mirror ('/manager/legal' + rp).
 *
 * Stage counts across the top (the six stages) — no money on the list (owner, 14 Sep:
 * amounts live inside each case; a report will cover the money side), filters: stage · type · filed
 * by, plus search. Rows: unit · customer, type, stage pill, next date with the
 * countdown hint, amount (label flips with filed_by), filed by. Closed cases
 * live under the "Closed" stage — they are never mixed into the open list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Scale, Search } from 'lucide-react';
import {
  legalApi, daysFromToday, disputeStageTone, DISPUTE_STAGES, DISPUTE_STAGE_LABELS, DISPUTE_TYPE_LABELS,
  type DisputeFiledBy, type DisputeRow, type DisputeStage, type DisputeType,
} from '@/lib/legal';
import { StartNoticeModal, fmtD, pillCls } from '@/components/legal/StartNoticeModal';

function Empty({ msg }: { msg: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e4e9e5] p-12 text-center">
      <Scale size={28} className="mx-auto mb-2 text-[#c5c3bc]" />
      <p className="text-sm text-[#8a948d]">{msg}</p>
    </div>
  );
}

const GRID = 'grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_120px_minmax(0,1.5fr)_110px_60px] gap-3 items-center px-[18px]';

export function DisputesListView({ base, rp, detailHrefOf, leaseHrefOf }: {
  /** '/legal' for the landlord, '/manager/legal' (+ rp) for a manager. */
  base: string; rp?: number | null;
  detailHrefOf: (id: number) => string;
  leaseHrefOf?: (leaseId: number) => string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<DisputeStage | ''>('');
  const [type, setType] = useState<DisputeType | ''>('');
  const [filedBy, setFiledBy] = useState<DisputeFiledBy | ''>('');
  const [q, setQ] = useState('');
  const [showStart, setShowStart] = useState(false);

  // Initial load shows the spinner; a reload after an action refreshes in place.
  const load = useCallback(() => {
    legalApi.disputes(base, rp ?? undefined)
      .then(r => { setRows(Array.isArray(r.items) ? r.items : []); setCounts(r.counts ?? {}); })
      .catch(() => { setRows([]); setCounts({}); })
      .finally(() => setLoading(false));
  }, [base, rp]);
  useEffect(() => { load(); }, [load]);

  // Counts come from the server (every case, unfiltered); the row filters are client-side.
  const stageCount = (s: DisputeStage) => counts[s] ?? (rows ?? []).filter(r => r.stage === s).length;
  const openCount = DISPUTE_STAGES.filter(s => s !== 'closed').reduce((n, s) => n + stageCount(s), 0);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? [])
    .filter(r => stage ? r.stage === stage : r.stage !== 'closed')
    .filter(r => !type || r.type === type)
    .filter(r => !filedBy || r.filedBy === filedBy)
    .filter(r => !needle || [r.lease?.unitNumber, r.lease?.customerName, r.lease?.buildingName, r.typeLabel, r.authorityCaseNumber, `#${r.id}`, `cid-${r.leaseId}`]
      .some(v => (v ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || b.id - a.id), [rows, stage, type, filedBy, needle]);

  /** The next-date cell: the date, then the countdown hint under it. */
  const nextCell = (r: DisputeRow) => {
    const d = r.nextDate; const n = daysFromToday(d);
    const overdue = n != null && n < 0 && r.stage !== 'closed';
    return (
      <div className="min-w-0">
        <div className={`text-[12.5px] whitespace-nowrap ${overdue ? 'font-bold text-[#b42318]' : 'font-semibold'}`}>
          {r.stage === 'closed' ? (r.closedDate ? `Closed ${fmtD(r.closedDate)}` : 'Closed') : d ? <>{fmtD(d)}{n != null && <span className="font-medium text-[#8a8f8c]"> · {n === 0 ? 'today' : n > 0 ? `in ${n}d` : `${-n}d ago`}</span>}</> : '—'}
        </div>
        <div className={`text-[11px] mt-0.5 truncate ${r.alert ? 'text-[#c47a00] font-semibold' : 'text-[#8a8f8c]'}`} title={r.hint}>{r.stage === 'closed' ? (r.outcomeLabel ?? '') : r.hint}</div>
      </div>
    );
  };
  const chipStyle = (on: boolean) => on ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e', border: '1px solid #e6e8e6' };
  const selectCls = 'py-2 pl-3 pr-8 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full sm:w-auto max-w-[240px]';
  const activeSel = { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } as const;

  return (
    <div className="text-[#1c1f1d]">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[-.01em]">Legal</h1>
          <p className="text-[12.5px] text-[#5b615e] mt-1">Formal notices, cases at the rental authority, settlement, decision and enforcement. A case is opened with a notice; a breach reaches here only when you escalate it.</p>
        </div>
        <button type="button" onClick={() => setShowStart(true)}
          className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] whitespace-nowrap cursor-pointer">+ Start notice</button>
      </div>

      {showStart && <StartNoticeModal base={base} rp={rp} onClose={() => setShowStart(false)} onSaved={id => { setShowStart(false); load(); router.push(detailHrefOf(id)); }} />}

      {/* stage counts — the six stages, each a filter */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-[22px]">
        {DISPUTE_STAGES.map(s => {
          const t = disputeStageTone(s); const on = stage === s;
          return (
            <button key={s} type="button" onClick={() => setStage(on ? '' : s)}
              className="bg-white border rounded-xl px-4 py-3.5 text-left cursor-pointer hover:border-[#c9cfcb]" style={{ borderColor: on ? t.fg : '#e6e8e6' }}>
              <p className="text-[11px] text-[#5b615e]">{DISPUTE_STAGE_LABELS[s]}</p>
              <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: t.fg }}>{loading ? '…' : stageCount(s)}</p>
            </button>
          );
        })}
      </div>


      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        <label className="relative w-full sm:w-[260px]">
          <Search size={13} className="absolute left-3 top-[10px] text-[#8a8f8c]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, customer, case no…"
            className="pl-8 pr-3 py-2 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full" />
        </label>
        <select value={type} onChange={e => setType(e.target.value as DisputeType | '')} className={selectCls} style={type ? activeSel : undefined} title="Filter by type">
          <option value="">All types</option>
          {(Object.keys(DISPUTE_TYPE_LABELS) as DisputeType[]).map(t => <option key={t} value={t}>{DISPUTE_TYPE_LABELS[t]}</option>)}
        </select>
        <div className="flex gap-1.5">
          {([['', 'Filed by anyone'], ['landlord', 'Filed by you'], ['customer', 'Filed by customer']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFiledBy(k)} className="text-[11px] px-3 py-1.5 rounded-full font-semibold transition-colors cursor-pointer" style={chipStyle(filedBy === k)}>{label}</button>
          ))}
        </div>
        <div className="flex gap-1.5 ml-auto">
          <button type="button" onClick={() => setStage('')} className="text-[11px] px-3 py-1.5 rounded-full font-semibold cursor-pointer" style={chipStyle(stage === '')}>Open · {loading ? '…' : openCount}</button>
          <button type="button" onClick={() => setStage('closed')} className="text-[11px] px-3 py-1.5 rounded-full font-semibold cursor-pointer" style={chipStyle(stage === 'closed')}>Closed · {loading ? '…' : stageCount('closed')}</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : !shown.length ? (
        <div className="mt-3.5"><Empty msg={stage === 'closed' ? 'No closed cases yet.' : stage ? `No cases at “${DISPUTE_STAGE_LABELS[stage]}”.` : rows?.length ? 'No open cases match these filters.' : 'No open cases — start a notice when a formal step is needed.'} /></div>
      ) : (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <div className={GRID + ' py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]'}>
                <span>UNIT · CUSTOMER</span><span>TYPE</span><span>STAGE</span><span>NEXT DATE</span><span>FILED BY</span><span />
              </div>
              {shown.map(r => {
                const t = disputeStageTone(r.stage); const href = detailHrefOf(r.id);
                return (
                  <div key={r.id} onClick={() => router.push(href)}
                    className={GRID + ' py-3.5 text-[12.5px] border-b border-[#f1f3f1] last:border-0 cursor-pointer hover:bg-[#fafbfa]'}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">Unit {r.lease?.unitNumber ?? '—'}</span>
                        <span className="truncate">{r.lease?.customerName ?? '—'}</span>
                      </div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">
                        Case #{r.id} · {r.lease?.buildingName ?? ''}{leaseHrefOf && r.leaseId ? <> · <Link href={leaseHrefOf(r.leaseId)} onClick={e => e.stopPropagation()} className="text-[#1a7a52] hover:underline">CID-{r.leaseId}</Link></> : ` · CID-${r.leaseId}`}
                        {r.breachId != null && <> · from breach</>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{r.typeLabel}</div>
                      {r.breachReasonLabels.length > 0 && <div className="text-[11px] text-[#8a8f8c] truncate">{r.breachReasonLabels.join(', ')}</div>}
                    </div>
                    <div><span className={pillCls} style={{ background: t.bg, color: t.fg }}>{r.stageLabel}</span></div>
                    {nextCell(r)}
                    <div className="text-[11.5px] whitespace-nowrap">{r.filedByLabel}{(r.missingCostsCount ?? 0) > 0 && <span className="block text-[11px] font-semibold" style={{ color: '#9a5b00' }} title="Fee-book lines for stages this case has reached that nobody recorded">{r.missingCostsCount} cost{r.missingCostsCount === 1 ? '' : 's'} missing</span>}</div>
                    <div className="text-right" onClick={e => e.stopPropagation()}>
                      <Link href={href} className="text-[12px] font-semibold text-[#1a7a52] hover:text-[#125a3c] no-underline">View →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
