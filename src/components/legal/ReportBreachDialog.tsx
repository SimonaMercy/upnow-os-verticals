'use client';

/**
 * Report a breach from the Breaches page (owner, 14 Sep: "there must be an
 * option to add breach"). Pick the lease, then the same facts the lease-page
 * form takes: date, category, who reported it, description, an attachment.
 * The breach opens at "Reported" — the warning steps happen on the lease's
 * Breaches section. Breach only: nothing legal is asked here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { legalApi, BREACH_CATEGORY_LABELS, BREACH_REPORTED_BY_LABELS, type BreachCategory, type BreachReportedBy, type BreachDetail } from '@/lib/legal';
import { leaseListPath, leaseLine, type LeaseOpt } from '@/components/legal/StartNoticeModal';

const field = 'w-full text-sm px-3 py-2 border border-[#e4e9e5] rounded-lg bg-white focus:outline-none focus:border-[#047246]';
const lbl = 'text-xs font-medium text-[#5f6b63] mb-1 block';
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.NEXT_PUBLIC_APP_TIME_ZONE || 'Asia/Dubai' });
const errText = (e: unknown, fb: string) => (e as Error)?.message || fb;

export function ReportBreachDialog({ base, rp, onClose, onDone }: {
  base: string; rp?: number | null; onClose: () => void; onDone: (b: BreachDetail) => void;
}) {
  const [leases, setLeases] = useState<LeaseOpt[] | null>(null);
  const [lease, setLease] = useState<LeaseOpt | null>(null);
  const [q, setQ] = useState('');
  const [date, setDate] = useState(todayIso());
  const [category, setCategory] = useState<BreachCategory>('noise');
  const [reportedBy, setReportedBy] = useState<BreachReportedBy>('staff');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<LeaseOpt[]>(leaseListPath(base, rp)).then(l => setLeases(Array.isArray(l) ? l : [])).catch(() => setLeases([]));
  }, [base, rp]);

  // Breaches happen on RUNNING leases (or ones that just ended — overstaying); the rest of the register stays out.
  const cutoff = useMemo(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 180); return d.toISOString().slice(0, 10); }, []);
  const needle = q.trim().toLowerCase();
  const options = useMemo(() => (leases ?? [])
    .filter(l => ['active', 'issued'].includes(l.status) || (l.status === 'expired' && (l.endDate ?? '') >= cutoff && l.contractActive !== false))
    .filter(l => !needle || leaseLine(l).toLowerCase().includes(needle) || String(l.id) === needle)
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.unit?.number ?? '').localeCompare(b.unit?.number ?? '', undefined, { numeric: true })),
    [leases, needle, cutoff]);

  async function submit() {
    if (!lease) { setErr('Pick the lease.'); return; }
    setErr(null); setBusy(true);
    try {
      let breach = await legalApi.reportBreach(base, rp ?? undefined, { leaseId: lease.id, category, description: description.trim() || undefined, reportedBy, openedDate: date });
      if (file) {
        try {
          const { id } = await uploadOwnedDocument({ ownerType: 'tenancy_breach', ownerId: breach.id, documentKey: `breach_${breach.id}_${Date.now()}`, category: 'legal', displayName: file.name, file });
          if (id) breach = await legalApi.breachEvent(base, rp ?? undefined, breach.id, { type: 'note', description: 'Attachment', documentId: id });
        } catch (e) { console.warn('Breach reported; attachment failed', e); }
      }
      onDone(breach);
    } catch (e) { setErr(errText(e, 'Could not report the breach.')); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#eef1ef] sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-sm font-bold text-[#14201a]">Report breach</h2>
            <p className="text-[11px] text-[#8a948d] mt-0.5">Opens at “Reported”. Warnings and escalation happen on the lease’s Breaches section.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#8a948d] hover:text-[#14201a] cursor-pointer"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
            <div className="text-[12px] font-bold mb-2">1 · Lease</div>
            {leases == null ? (
              <div className="flex items-center gap-2 text-[12px] text-[#8a8f8c]"><Loader2 size={13} className="animate-spin" /> Loading leases…</div>
            ) : lease ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[#e6e8e6] bg-[#fafbfa] px-3 py-2">
                <div className="min-w-0"><div className="text-[12.5px] font-semibold truncate">{leaseLine(lease)}</div></div>
                <button type="button" onClick={() => { setLease(null); setQ(''); }} className="text-[11px] font-semibold text-[#1a7a52] hover:underline cursor-pointer shrink-0">Change</button>
              </div>
            ) : (
              <div>
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a unit, customer, building or CID…" className={field} />
                <div className="mt-1.5 rounded-lg border border-[#e6e8e6] overflow-hidden max-h-56 overflow-y-auto">
                  {options.length === 0 ? <div className="px-3 py-2 text-[12px] text-[#8a8f8c]">No lease matches.</div>
                    : options.slice(0, 8).map(l => (
                      <button key={l.id} type="button" onClick={() => setLease(l)} className="w-full text-left px-3 py-2 text-[12.5px] border-b border-[#f1f3f1] last:border-0 hover:bg-[#eef7f2] cursor-pointer">
                        <div className="font-medium truncate">{leaseLine(l)}</div>
                      </button>
                    ))}
                  {options.length > 8 && <div className="px-3 py-1.5 text-[11px] text-[#8a8f8c] bg-[#fafbfa]">Showing the first 8 — type to narrow it down.</div>}
                </div>
              </div>
            )}
          </section>

          <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
            <div className="text-[12px] font-bold mb-2">2 · What happened</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><span className={lbl}>Date</span><input type="date" className={field} value={date} onChange={e => setDate(e.target.value)} /></div>
              <div>
                <span className={lbl}>Breach</span>
                <select className={field} value={category} onChange={e => setCategory(e.target.value as BreachCategory)}>
                  {(Object.keys(BREACH_CATEGORY_LABELS) as BreachCategory[]).map(c => <option key={c} value={c}>{BREACH_CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div>
                <span className={lbl}>Reported by</span>
                <select className={field} value={reportedBy} onChange={e => setReportedBy(e.target.value as BreachReportedBy)}>
                  {(Object.keys(BREACH_REPORTED_BY_LABELS) as BreachReportedBy[]).map(r => <option key={r} value={r}>{BREACH_REPORTED_BY_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3"><span className={lbl}>Description</span><textarea rows={3} className={field} value={description} onChange={e => setDescription(e.target.value)} placeholder="What was reported, by whom, when — enough for a warning letter." /></div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <label className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer inline-flex items-center gap-1.5 ${file ? 'border-[#1a7a5a] text-[#1a7a5a] bg-[#e6f4ef]' : 'border-dashed border-[#d8d6d0] text-[#5f6b63] hover:bg-[#f9f8f6]'}`}>
                <Paperclip size={12} /> {file ? file.name : 'Attach photo / complaint'}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              </label>
              <span className="text-[11px] text-[#8a8f8c]">Optional — a photo, the complaint, a security report.</span>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[#eef1ef] sticky bottom-0 bg-white">
          <span className="text-[11px] text-red-600">{err ?? ''}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#e6e8e6] bg-white cursor-pointer">Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={busy || !lease} className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] disabled:opacity-50 cursor-pointer">{busy ? 'Reporting…' : 'Report breach'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
