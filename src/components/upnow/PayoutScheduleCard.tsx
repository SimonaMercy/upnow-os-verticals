/**
 * PayoutScheduleCard (SP-221) — admin editor for platform_policies.payout_schedule:
 * hold after release, cadence, weekday, minimum payout. Saved through the
 * audited PATCH /admin/catalog/policies (server validates). Self-contained so
 * the 2k-line catalog page only mounts it.
 */
'use client';

import { useEffect, useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';

interface Policy { holdHoursAfterRelease: number; cadence: 'daily' | 'weekly' | 'manual'; payoutWeekday: number; minPayoutAed: number }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PayoutScheduleCard({ onConfirm }: { onConfirm?: (message: string, run: () => Promise<void>) => void }) {
  const [server, setServer] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      apiGet<{ policies?: { payout_schedule?: Policy } }>('/admin/catalog/overview')
        .then((o) => { const p = o?.policies?.payout_schedule ?? null; setServer(p); setDraft(p); })
        .catch(() => setErr('Could not load the payout schedule.'));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const dirty = !!server && !!draft && JSON.stringify(server) !== JSON.stringify(draft);
  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const run = async () => {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiPatch<{ payout_schedule?: Policy }>('/admin/catalog/policies', { key: 'payout_schedule', value: draft });
      const p = res?.payout_schedule ?? draft; setServer(p); setDraft(p);
    } catch (e) { setErr((e as Error)?.message || 'Save failed'); }
    finally { setBusy(false); }
  };
  const save = () => (onConfirm ? onConfirm('Save the payout schedule? Providers see the new hold and cadence immediately; escrow release is unaffected.', run) : run());

  return (
    <div className="rounded-2xl border border-[#ececea] bg-white p-4">
      <div className="flex items-center gap-2 mb-1"><Wallet size={15} className="text-[#2e9f82]" /><h3 className="text-[13.5px] font-bold text-[#1a1916]">Payout schedule</h3><span className="text-[10.5px] text-[#9b9890]">SP-221</span></div>
      <p className="text-[11.5px] text-[#6b6860] mb-3">Applied at payout time — a released job&apos;s net becomes payable after the hold; escrow release (Gate 6) is unchanged. Every change is audited.</p>
      {!draft ? <p className="text-[11px] text-[#9b9890]">{err ?? 'Loading…'}</p> : (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[11px] text-[#6b6860]">Hold after release (hours)
            <input type="number" min={0} max={720} value={draft.holdHoursAfterRelease} onChange={(e) => set('holdHoursAfterRelease', Math.max(0, Math.min(720, Math.round(Number(e.target.value) || 0))))} className="mt-1 w-full rounded-lg border border-[#ececea] px-2 py-1.5 text-[12.5px]" />
          </label>
          <label className="text-[11px] text-[#6b6860]">Minimum payout (AED)
            <input type="number" min={0} max={100000} value={draft.minPayoutAed} onChange={(e) => set('minPayoutAed', Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded-lg border border-[#ececea] px-2 py-1.5 text-[12.5px]" />
          </label>
          <label className="text-[11px] text-[#6b6860]">Cadence
            <select value={draft.cadence} onChange={(e) => set('cadence', e.target.value as Policy['cadence'])} className="mt-1 w-full rounded-lg border border-[#ececea] px-2 py-1.5 text-[12.5px] bg-white">
              <option value="weekly">Weekly</option><option value="daily">Daily</option><option value="manual">Manual (ops decides)</option>
            </select>
          </label>
          <label className="text-[11px] text-[#6b6860]">Payout day (weekly)
            <select value={draft.payoutWeekday} disabled={draft.cadence !== 'weekly'} onChange={(e) => set('payoutWeekday', Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[#ececea] px-2 py-1.5 text-[12.5px] bg-white disabled:opacity-50">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        </div>
      )}
      {err && draft && <p className="text-[11px] text-[#b42318] mt-2">{err}</p>}
      <button onClick={save} disabled={!dirty || busy} className="mt-3 w-full rounded-lg bg-[#2e9f82] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center justify-center gap-2">
        {busy && <Loader2 size={12} className="animate-spin" />} Save payout schedule
      </button>
    </div>
  );
}
