'use client';

/**
 * Building inspection report (0383) — the printable record of one visit:
 * building, period, inspector, result counts, every item with its finding and
 * photos, the landlord's decision. Print = the browser's print dialog (PDF).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { biUrl, fmtDate, fmtDateTime, STATUS_LABEL, Visit, VisitItem, visitHref } from '@/lib/buildingInspections';
import { ResultBadge } from '@/components/upnow/BuildingInspectionVisit';

export function BuildingInspectionReport({ id, manager }: { id: number; manager?: { rp: number } }) {
  const rp = manager?.rp ?? null;
  const router = useRouter();
  const u = useCallback((p: string) => biUrl(p, rp), [rp]);
  const [v, setV] = useState<Visit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { apiGet<Visit>(u(`/visits/${id}`)).then(setV).catch((e) => setErr((e as Error).message || 'Could not load the report.')); }, [u, id]);

  const groups = useMemo(() => {
    const m = new Map<string, VisitItem[]>();
    for (const i of v?.items ?? []) { if (!m.has(i.area)) m.set(i.area, []); m.get(i.area)!.push(i); }
    return [...m.entries()];
  }, [v?.items]);

  if (err) return <div className="max-w-3xl mx-auto px-4 py-6"><p className="text-sm text-[#b91c1c]">{err}</p></div>;
  if (!v) return <div className="max-w-3xl mx-auto px-4 py-6"><p className="text-sm text-[#9b9890] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p></div>;

  const count = (r: string | null) => v.items.filter((i) => i.result === r).length;
  const issues = v.items.filter((i) => i.result === 'issue');

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 sm:py-8 print:max-w-none print:px-0 print:py-0">
      <style>{`@media print { nav, aside, header, .no-print { display: none !important; } body { background: #fff; } .print-break { break-inside: avoid; } }`}</style>
      <div className="flex items-center justify-between gap-2 mb-3 no-print">
        <button type="button" onClick={() => router.push(visitHref(v.id, rp))} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916] cursor-pointer"><ArrowLeft size={15} /> Back to the visit</button>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1a1916] text-white text-[12.5px] font-semibold px-3 py-1.5"><Printer size={13} /> Print / save as PDF</button>
      </div>

      <div className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden print:border-0 print:rounded-none">
        <div className="px-5 py-4 bg-[#2e9f82] text-white">
          <div className="text-[10.5px] uppercase tracking-wider opacity-80">Building inspection report</div>
          <h1 className="text-xl font-bold leading-tight">{v.propertyName}</h1>
          <div className="text-[13px] opacity-90">{v.periodLabel} · {v.frequency === 'monthly' ? 'monthly' : 'quarterly'} walk-through</div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#f4f3ef] border-b border-[#e8e6e0]">
          {[
            ['Address', v.address ?? '—'], ['Inspector', v.inspectorName ?? v.submittedByName ?? '—'],
            ['Submitted', v.submittedAt ? `${fmtDateTime(v.submittedAt)}${v.submittedByName ? ` · ${v.submittedByName}` : ''}` : `Not yet · due ${fmtDate(v.dueDate)}`],
            ['Status', v.status === 'approved' ? `Approved ${fmtDateTime(v.reviewedAt)}` : v.status === 'returned' ? `Returned ${fmtDateTime(v.reviewedAt)}` : STATUS_LABEL[v.status]],
          ].map(([k, val]) => (
            <div key={k} className="bg-white px-4 py-3"><div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{k}</div><div className="text-[12.5px] text-[#1a1916] font-medium">{val}</div></div>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-px bg-[#f4f3ef] border-b border-[#e8e6e0]">
          {[['Items', v.items.length, ''], ['OK', count('ok'), 'text-[#166534]'], ['Issues', count('issue'), count('issue') ? 'text-[#b91c1c]' : ''], ['N/A', count('na'), 'text-[#6b6860]']].map(([k, n, tone]) => (
            <div key={String(k)} className="bg-white px-4 py-3 text-center"><div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{k}</div><div className={`text-lg font-bold tabular-nums ${tone}`}>{n}</div></div>
          ))}
        </div>

        {issues.length > 0 && (
          <div className="px-5 py-4 border-b border-[#e8e6e0] print-break">
            <div className="text-[13px] font-bold text-[#b91c1c] mb-2">Issues found ({issues.length})</div>
            <ol className="list-decimal pl-5 space-y-1">
              {issues.map((i) => (
                <li key={i.id} className="text-[12.5px] text-[#1a1916]">
                  <span className="font-semibold">{i.area} — {i.label}</span>{i.comment ? `: ${i.comment}` : ''}
                  {i.maintenanceRequestId && <span className="ml-1 text-[11px] text-[#1a7a5a] font-semibold">· Job #{i.maintenanceRequestId}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {groups.map(([area, items]) => (
          <div key={area} className="border-b border-[#e8e6e0] last:border-0 print-break">
            <div className="px-5 py-2 bg-[#fafaf8] text-[12.5px] font-bold text-[#1a1916]">{area}</div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-[#f4f3ef] align-top">
                    <td className="px-5 py-2 w-[45%]"><div className="text-[#1a1916]">{it.label}</div>{it.comment && <div className="text-[11.5px] text-[#4a4842] mt-0.5 whitespace-pre-wrap">{it.comment}</div>}</td>
                    <td className="px-2 py-2 w-[110px]"><ResultBadge result={it.result} /></td>
                    <td className="px-5 py-2">
                      {it.photos.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {it.photos.map((p) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={p.id} src={p.viewUrl} alt={p.caption ?? it.label} className="w-20 h-20 object-cover rounded-md border border-[#e8e6e0]" />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {v.photos.length > 0 && (
          <div className="px-5 py-4 border-t border-[#e8e6e0] print-break">
            <div className="text-[12.5px] font-bold text-[#1a1916] mb-2">General photos</div>
            <div className="flex flex-wrap gap-1.5">
              {v.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.viewUrl} alt={p.caption ?? 'Photo'} className="w-24 h-24 object-cover rounded-md border border-[#e8e6e0]" />
              ))}
            </div>
          </div>
        )}

        {(v.overallNote || v.reviewNote) && (
          <div className="px-5 py-4 border-t border-[#e8e6e0] grid sm:grid-cols-2 gap-4 print-break">
            {v.overallNote && <div><div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">Inspector&rsquo;s note</div><p className="text-[12.5px] text-[#1a1916] whitespace-pre-wrap">{v.overallNote}</p></div>}
            {v.reviewNote && <div><div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">Landlord&rsquo;s note</div><p className="text-[12.5px] text-[#1a1916] whitespace-pre-wrap">{v.reviewNote}</p></div>}
          </div>
        )}

        <div className="px-5 py-3 text-[10.5px] text-[#9b9890] border-t border-[#e8e6e0]">
          Report #{v.id} · period {fmtDate(v.periodStart)} – {fmtDate(v.periodEnd)} · generated {new Date().toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>
    </div>
  );
}
