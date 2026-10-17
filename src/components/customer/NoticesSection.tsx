'use client';

/**
 * Notices & warnings on the customer's lease (owner, 14 Sep 2026: "it should
 * be visible on customer portal as well"). Read-only: the warnings the landlord
 * issued (with the letters they attached), the deadline to put things right,
 * and any legal case — notice served, deadline, stage, hearing, decision.
 * Nothing internal to the landlord (unwarned reports, notes, costs, proofs)
 * is shown. The bell notification deep-links here (#notices).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Gavel, ShieldAlert } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { openDocViewerByIds } from '@/lib/docViewer';

interface Letter { id: number; date: string; type: string; document: { id: number; name: string; fileUrl: string } | null }
interface CustomerBreach {
  id: number; leaseId: number; categoryLabel: string; stage: string; stageLabel: string;
  warningSentDate: string | null; correctionDeadline: string | null; finalWarningDate: string | null; finalDeadline: string | null;
  resolvedDate: string | null; hint: string; letters: Letter[];
}
interface CustomerCase {
  id: number; leaseId: number; filedByLabel: string; typeLabel: string; stage: string; stageLabel: string;
  noticeTypeLabel: string; noticeServedDate: string | null; noticeDeadline: string | null; nextHearingDate: string | null;
  decisionDate: string | null; outcomeLabel: string | null; claimAmount: number | null; claimLabel: string; hint: string;
}

const fmt = (d?: string | null) => d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const BREACH_TONE: Record<string, { bg: string; fg: string }> = {
  warning_sent: { bg: '#fdecd2', fg: '#8a4b00' }, final_warning: { bg: '#fde2e1', fg: '#a32d2d' }, resolved: { bg: '#e6f4ef', fg: '#1a7a5a' }, escalated: { bg: '#ece9fd', fg: '#5b3fbf' },
};
const CASE_TONE: Record<string, { bg: string; fg: string }> = {
  notice_sent: { bg: '#fff4e0', fg: '#9a5b00' }, case_filed: { bg: '#e0f2fe', fg: '#0369a1' }, settlement: { bg: '#ece9fd', fg: '#5b3fbf' },
  decision: { bg: '#e0f2fe', fg: '#0369a1' }, enforcement: { bg: '#fde2e1', fg: '#a32d2d' }, closed: { bg: '#eeefed', fg: '#5b615e' },
};
const pill = 'text-[10.5px] font-bold px-2 py-[3px] rounded-full';

export function NoticesSection({ contractId }: { contractId: number }) {
  const [data, setData] = useState<{ breaches: CustomerBreach[]; cases: CustomerCase[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<{ breaches: CustomerBreach[]; cases: CustomerCase[] }>(`/customer/legal/notices?contractId=${contractId}`)
      .then(d => { if (live) setData(d); })
      .catch(e => { if (live) { setErr(e instanceof Error ? e.message : 'Could not load notices.'); setData({ breaches: [], cases: [] }); } });
    return () => { live = false; };
  }, [contractId]);

  // Nothing served on this lease → no section at all; a clean lease stays clean.
  if (!data || (data.breaches.length === 0 && data.cases.length === 0 && !err)) return null;
  const urgent = data.breaches.some(b => (b.stage === 'warning_sent' || b.stage === 'final_warning')) || data.cases.some(c => c.stage !== 'closed');

  return (
    <section id="notices" className="bg-white rounded-2xl border border-[#e4e9e5] overflow-hidden scroll-mt-24">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0eeea]" style={{ background: urgent ? '#fff7ed' : '#f6f8f6' }}>
        <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: urgent ? '#fed7aa' : '#eef3f1', color: urgent ? '#9a3412' : '#2e6f5e' }}>
          {urgent ? <AlertTriangle size={17} /> : <ShieldAlert size={17} />}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#14201a]">Notices &amp; warnings</h2>
          <p className="text-[12px] text-[#5f6b63]">What your landlord has served on this lease and by when you need to act. The letters themselves are delivered to you separately.</p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {err && <p className="text-[12px] text-red-600">{err}</p>}

        {data.breaches.map(b => {
          const t = BREACH_TONE[b.stage] ?? BREACH_TONE.warning_sent;
          const deadline = b.stage === 'final_warning' ? b.finalDeadline : b.stage === 'warning_sent' ? b.correctionDeadline : null;
          return (
            <div key={`b-${b.id}`} className="rounded-xl border border-[#eef0ee] px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={pill} style={{ background: t.bg, color: t.fg }}>{b.stageLabel}</span>
                <span className="text-[13px] font-semibold text-[#14201a]">{b.categoryLabel}</span>
                {deadline && <span className="text-[12px] text-[#5f6b63]">· put right by <b className="text-[#14201a]">{fmt(deadline)}</b></span>}
              </div>
              {b.hint && <p className="text-[12.5px] mt-1.5" style={{ color: b.hint.includes('passed') ? '#b42318' : '#46534c' }}>{b.hint}</p>}
              <div className="text-[11.5px] text-[#5f6b63] mt-2 flex gap-4 flex-wrap">
                {b.warningSentDate && <span>Warning issued {fmt(b.warningSentDate)}</span>}
                {b.finalWarningDate && <span>Final warning {fmt(b.finalWarningDate)}</span>}
                {b.resolvedDate && <span>Resolved {fmt(b.resolvedDate)}</span>}
              </div>
              {b.letters.some(l => l.document) && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {b.letters.filter(l => l.document).map(l => (
                    <button key={l.id} type="button" onClick={() => void openDocViewerByIds([{ id: l.document!.id, caption: `${l.type} letter`, mimeType: null }], `${l.type} letter`)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#1a7a52] hover:underline cursor-pointer">
                      <ExternalLink size={12} /> {l.type} letter · {fmt(l.date)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {data.cases.map(c => {
          const t = CASE_TONE[c.stage] ?? CASE_TONE.notice_sent;
          return (
            <div key={`c-${c.id}`} className="rounded-xl border px-4 py-3" style={{ borderColor: '#d9d3f7', background: '#faf9fe' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <Gavel size={14} style={{ color: '#5b3fbf' }} />
                <span className="text-[13px] font-semibold text-[#14201a]">Legal case · {c.typeLabel}</span>
                <span className={pill} style={{ background: t.bg, color: t.fg }}>{c.stageLabel}</span>
                <span className="text-[11.5px] text-[#5f6b63]">{c.filedByLabel}</span>
              </div>
              {c.hint && <p className="text-[12.5px] mt-1.5" style={{ color: c.hint.includes('passed') ? '#b42318' : '#46534c' }}>{c.hint}</p>}
              <div className="text-[11.5px] text-[#5f6b63] mt-2 flex gap-4 flex-wrap">
                {c.noticeServedDate && <span>{c.noticeTypeLabel} served {fmt(c.noticeServedDate)}</span>}
                {c.noticeDeadline && <span>Deadline {fmt(c.noticeDeadline)}</span>}
                {c.nextHearingDate && <span>Hearing {fmt(c.nextHearingDate)}</span>}
                {c.decisionDate && <span>Decision {fmt(c.decisionDate)}{c.outcomeLabel ? ` — ${c.outcomeLabel}` : ''}</span>}
                {c.claimAmount != null && <span>{c.claimLabel}: <b className="text-[#14201a]">AED {Number(c.claimAmount).toLocaleString('en-AE')}</b></span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
