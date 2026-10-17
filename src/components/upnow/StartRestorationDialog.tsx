'use client';

/**
 * Start restoration on a vacant unit — ONE job whose task list is the unit's
 * move-out form, main category by main category (owner, 17 Sep 2026: "prefill
 * what we have in the move-out form as main category as a task list, let the
 * property manager or technician mark it, and keep attaching the bills").
 *
 * Categories where the last move-out found something open ticked, with what it
 * found; the Restoration List's other groups can be added. The chosen tasks'
 * move-out photos become the job's before photos.
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { useBackClose } from '@/lib/useSlideOver';

interface Finding { label: string; condition: string; costAed: number; photoIds: string[] }
interface PlanTask { key: string; label: string; findings: Finding[]; suggested: boolean; fromMoveOut: boolean }
interface Plan { moveOut: { contractId: number; inspectionDate: string | null } | null; tasks: PlanTask[] }

const MAX_PHOTOS = 40;
const aed = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });

function Tick({ on }: { on: boolean }) {
  return (
    <span className={`mt-0.5 flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border shrink-0 ${on ? 'bg-[#047246] border-[#047246] text-white' : 'border-[#cfd6cf] bg-white'}`}>
      {on && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

export function StartRestorationDialog({ unit, maintBase, maintQ, onClose, onStarted }: {
  unit: { id: number; unitNumber: string | null };
  maintBase: string;
  maintQ: string;
  onClose: () => void;
  onStarted: (requestId: number) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const q = maintQ ? `?${maintQ}` : '';
  useBackClose(() => { if (!busy) onClose(); });

  useEffect(() => {
    apiGet<Plan>(`${maintBase}/restoration/units/${unit.id}/plan${q}`)
      .then(p => { setPlan(p); setChosen(new Set(p.tasks.filter(t => t.suggested).map(t => t.key))); })
      .catch(() => setLoadErr(true));
  }, [maintBase, q, unit.id]);

  const toggle = (key: string) => setChosen(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const fromForm = plan?.tasks.filter(t => t.fromMoveOut) ?? [];
  const others = plan?.tasks.filter(t => !t.fromMoveOut) ?? [];
  const picked = plan?.tasks.filter(t => chosen.has(t.key)) ?? [];
  const photoCount = Math.min(picked.flatMap(t => t.findings.flatMap(f => f.photoIds)).length, MAX_PHOTOS);
  const estimate = picked.flatMap(t => t.findings).reduce((n, f) => n + (f.costAed || 0), 0);
  const found = fromForm.reduce((n, t) => n + t.findings.length, 0);

  const submit = async () => {
    if (!picked.length) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiPost<{ id: number }>(`${maintBase}/restoration/units/${unit.id}/start${q}`, {
        categoryKeys: picked.map(t => t.key), notes: notes.trim() || undefined, withPhotos,
      });
      onStarted(res.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the restoration');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,30,25,.45)' }} onClick={() => !busy && onClose()}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-[18px] w-full max-w-[560px] max-h-full flex flex-col shadow-[0_20px_60px_rgba(0,0,0,.18)]">
        <div className="px-6 pt-6 pb-3">
          <div className="text-[17px] font-extrabold text-[#14201a]">Start restoration — Unit {unit.unitNumber}</div>
          <div className="text-[12.5px] text-[#6b756f] mt-1">
            {!plan && !loadErr ? 'Reading the last move-out form…'
              : plan?.moveOut ? <>The task list comes from the move-out form{plan.moveOut.inspectionDate ? ` of ${fmtDay(plan.moveOut.inspectionDate)}` : ''}{found ? ` — ${found} thing${found === 1 ? '' : 's'} to fix, ticked below` : ''}. The team marks each task done and files its bills against it.</>
              : 'No move-out form on this unit — tick the work it needs. The team marks each task done and files its bills against it.'}
          </div>
        </div>

        <div className="overflow-y-auto px-6 pb-2">
          {loadErr && <p className="text-xs text-[#b91c1c]">Could not read the unit&apos;s move-out form. Close and try again.</p>}

          {fromForm.length > 0 && (
            <>
              <div className="text-xs font-bold text-[#6b756f] mb-2">Tasks from the move-out form</div>
              <ul className="border border-[#e5e9e6] rounded-xl divide-y divide-[#eef1ec]">
                {fromForm.map(t => (
                  <li key={t.key}>
                    <button type="button" onClick={() => toggle(t.key)} className="w-full flex items-start gap-3 px-3.5 py-2.5 text-left cursor-pointer hover:bg-[#fafbfa]">
                      <Tick on={chosen.has(t.key)} />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-semibold text-[#14201a]">{t.label}</span>
                        {t.findings.length === 0
                          ? <span className="block text-xs text-[#8a948d] mt-0.5">Nothing found at move-out</span>
                          : (
                            <span className="block mt-1 space-y-0.5">
                              {t.findings.map((f, i) => (
                                <span key={i} className="flex justify-between gap-3 text-xs text-[#6b756f]">
                                  <span className="min-w-0">{f.label}{f.condition && <span className="text-[#9a3412]"> · {f.condition}</span>}</span>
                                  {f.costAed > 0 && <span className="shrink-0">{aed(f.costAed)}</span>}
                                </span>
                              ))}
                            </span>
                          )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {others.length > 0 && (
            <>
              <div className={`text-xs font-bold text-[#6b756f] mb-2 ${fromForm.length ? 'mt-4' : ''}`}>{fromForm.length ? 'Other work — from your Restoration list' : 'What work is needed?'}</div>
              <div className="flex flex-wrap gap-1.5">
                {others.map(t => {
                  const on = chosen.has(t.key);
                  return (
                    <button key={t.key} type="button" onClick={() => toggle(t.key)}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer ${on ? 'bg-[#e6f7f1] border-[#047246] text-[#1a7a5a]' : 'bg-white border-[#e5e9e6] text-[#6b756f] hover:border-[#cfd6cf]'}`}>
                      {on && <Check size={12} strokeWidth={3} />}{t.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {estimate > 0 && (
            <div className="flex justify-between text-xs font-semibold text-[#14201a] mt-3 px-1">
              <span>Estimate from the move-out form</span><span>{aed(estimate)}</span>
            </div>
          )}

          {photoCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-[#14201a] mt-3 cursor-pointer">
              <input type="checkbox" checked={withPhotos} onChange={e => setWithPhotos(e.target.checked)} />
              Add the move-out photos as before photos ({photoCount})
            </label>
          )}

          <label className="block text-xs font-bold text-[#6b756f] mt-4">Notes — optional
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Anything else before the next customer moves in"
              className="block w-full mt-1.5 border border-[#e5e9e6] rounded-[10px] px-3 py-2.5 text-sm font-normal resize-y focus:outline-none focus:border-[#047246]" />
          </label>
          {err && <p className="text-xs text-[#b91c1c] mt-2">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#eef1ec]">
          <button type="button" disabled={busy} onClick={onClose} className="text-[13px] font-bold text-[#6b756f] bg-[#eef1ec] px-4 py-2.5 rounded-[10px] cursor-pointer">Cancel</button>
          <button type="button" disabled={busy || !plan || picked.length === 0} onClick={submit}
            className="text-[13px] font-bold text-white bg-[#047246] px-4 py-2.5 rounded-[10px] cursor-pointer disabled:opacity-50">
            {busy ? 'Starting…' : picked.length ? `Start restoration · ${picked.length} task${picked.length === 1 ? '' : 's'}` : 'Start restoration'}
          </button>
        </div>
      </div>
    </div>
  );
}
