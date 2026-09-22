/**
 * Operation Management Plan — the ops team's plan sheet, read straight off the
 * system. One section per kind of work (the team's own eleven), a row per
 * matter: what the system holds, the stage it is at, what that stage calls for,
 * and the person the pipeline names for it. Nothing is typed and nothing is
 * stored (owner, 22 Sep 2026: "a straightforward report of operations").
 *
 * Data: GET {endpointBase}?rp=N. The Excel button writes the team's own sheet
 * format, cell for cell.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, Download, ListChecks, ExternalLink } from 'lucide-react';

interface PlanLink { kind: 'lease' | 'lead' | 'unit' | 'job' | 'breach' | 'dispute' | 'vendor-contract'; id: number }
interface Row {
  key: string; section: string; property: string | null; party: string | null; unit: string | null;
  system: string | null; date: string | null; state: string; nextStep: string; link: PlanLink | null; responsible: string | null;
}
interface Section { key: string; no: number; title: string; rows: Row[] }
interface Payload { generatedAt: string; sections: Section[] }

const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** Where a row's record lives on this portal. */
function hrefOf(link: PlanLink | null, managerRp?: number): string | null {
  if (!link) return null;
  const base = managerRp != null ? '/dashboard/manager' : '/rental-provider/dashboard';
  const q = managerRp != null ? `?rp=${managerRp}` : '';
  switch (link.kind) {
    case 'lease': return `${base}/operations/${link.id}${q}`;
    case 'lead': return `${base}/leads/${link.id}${q}`;
    case 'breach': return `${base}/breaches/${link.id}${q}`;
    case 'dispute': return `${base}/legal/${link.id}${q}`;
    case 'job': return `${base}/maintenance/${link.id}${q}`;
    case 'unit': return `${base}/units${q}`;
    default: return null;
  }
}

export function OperationPlanReport({
  endpointBase = '/api/operation-plan',
  extraQuery,
  backHref = '/rental-provider/dashboard/reports',
  onBack,
  managerRp,
}: {
  endpointBase?: string;
  /** e.g. `rp=12` — the manager portal scopes the plan to one landlord. */
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
  managerRp?: number;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const q = extraQuery ? `?${extraQuery}` : '';

  const load = useCallback(() => fetch(`${endpointBase}${q}`, { credentials: 'include', cache: 'no-store' })
    .then(async res => {
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
      return res.json() as Promise<Payload>;
    })
    .then(d => { setData(d); setError(null); })
    .catch(e => setError(String((e as Error).message ?? e)))
    .finally(() => setLoading(false)), [endpointBase, q]);
  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => data?.sections.reduce((n, s) => n + s.rows.length, 0) ?? 0, [data]);

  /** The team's own sheet, cell for cell: Category (merged per section) · Property · Tenant/Customer/ Vendors ·
   *  Unit / No · Current Position/Issues · What Needs to Happen · Reponsible · Status — their headers, widths,
   *  font and borders (Operation Management Plan Category.xlsx). */
  const downloadXlsx = async () => {
    if (!data) return;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Operation');
    ws.columns = [30.7, 23.7, 20.5, 18, 39.6, 60.7, 24.3, 21.5].map(width => ({ width }));
    const font = { name: 'Arial Nova Cond', size: 12 };
    const thin = { style: 'thin' as const };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const head = ws.addRow(['Category', 'Property', 'Tenant/Customer/ Vendors', 'Unit / No', 'Current Position/Issues', 'What Needs to Happen', 'Reponsible', 'Status']);
    head.height = 47;
    head.eachCell(c => { c.font = { ...font, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF808080' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border; });
    const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : ' -');
    for (const sec of data.sections) {
      const rows: (Row | null)[] = sec.rows.length ? sec.rows : [null];
      const start = ws.rowCount + 1;
      for (const r of rows) {
        const row = ws.addRow([sec.title, dash(r?.property), dash(r?.party), dash(r?.unit), dash(r?.system), dash(r?.nextStep), dash(r?.responsible), dash(r?.state)]);
        row.eachCell({ includeEmpty: true }, c => { c.font = font; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
      }
      if (rows.length > 1) ws.mergeCells(start, 1, ws.rowCount, 1);
    }
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = `Operation Management Plan Category ${data.generatedAt.slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-6 print:py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 print:mb-3">
        <div>
          {onBack ? (
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-2 print:hidden"><ArrowLeft size={14} /> All Reports</button>
          ) : (
            <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] mb-2 print:hidden"><ArrowLeft size={14} /> All Reports</Link>
          )}
          <h1 className="text-2xl font-bold text-[#26241f] flex items-center gap-2"><ListChecks size={22} className="text-[#2e9f82]" /> Operation Management Plan</h1>
          <p className="text-sm text-[#6b6860] mt-1 max-w-3xl">
            The work on the books, section by section — {total} items. What the system holds, the stage each matter is at, what that stage calls for, and who handles it.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={downloadXlsx} disabled={!data} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm font-medium text-[#3d3b35] hover:border-[#2e9f82] disabled:opacity-50"><Download size={15} /> Excel</button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#1a7a5a]"><Printer size={15} /> Print</button>
        </div>
      </div>

      {error && <div className="mb-4 flex items-center gap-2 text-sm text-[#b91c1c] bg-[#fee2e2] rounded-xl px-4 py-3"><AlertCircle size={16} /> {error}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-[#6b6860] py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>}

      {!loading && data && (
        <div className="space-y-5">
          {data.sections.map(sec => (
            <section key={sec.key} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden break-inside-avoid">
              <div className="px-4 sm:px-5 py-3 border-b border-[#e8e6e0] bg-[#faf9f7]">
                <h2 className="text-base font-semibold text-[#26241f]"><span className="text-[#8a8780] font-medium mr-2">{sec.no}.</span>{sec.title}<span className="ml-2 text-xs font-medium text-[#8a8780]">{sec.rows.length}</span></h2>
              </div>
              {sec.rows.length === 0 ? (
                <p className="py-3 pl-4 text-sm text-[#9b9890]">Nothing open.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm align-top">
                    <thead>
                      <tr className="text-left text-[#6b6860] border-b border-[#e8e6e0] text-xs">
                        <th className="py-2 pl-4 pr-3 font-medium w-[150px]">Property</th>
                        <th className="py-2 px-3 font-medium w-[220px]">Customer / Vendor — Unit</th>
                        <th className="py-2 px-3 font-medium">In the system</th>
                        <th className="py-2 px-3 font-medium">What needs to happen</th>
                        <th className="py-2 px-3 font-medium w-[150px]">Responsible</th>
                        <th className="py-2 px-3 pr-4 font-medium w-[170px]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map(r => {
                        const href = hrefOf(r.link, managerRp);
                        return (
                          <tr key={r.key} className="border-b border-[#f1efe9] last:border-0">
                            <td className="py-2 pl-4 pr-3 text-[#3d3b35]">{r.property ?? '—'}</td>
                            <td className="py-2 px-3 text-[#26241f]">
                              {r.party && <span className="font-medium">{r.party}</span>}
                              {r.unit && <span className={r.party ? 'text-[#6b6860]' : 'font-medium'}>{r.party ? ` — ${r.unit}` : r.unit}</span>}
                              {!r.party && !r.unit && '—'}
                              {href && <Link href={href} className="ml-1.5 inline-flex align-middle text-[#2e9f82] print:hidden" title="Open"><ExternalLink size={12} /></Link>}
                            </td>
                            <td className="py-2 px-3 text-[#3d3b35]">{r.system}{r.date && <div className="text-xs text-[#8a8780] mt-0.5">{fmtDate(r.date)}</div>}</td>
                            <td className="py-2 px-3 text-[#3d3b35]">{r.nextStep}</td>
                            <td className="py-2 px-3 text-[#26241f]">{r.responsible ?? '—'}</td>
                            <td className="py-2 px-3 pr-4"><span className="inline-block text-xs font-semibold rounded-lg px-2 py-1 bg-[#eef7f2] text-[#1a7a5a]">{r.state}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
          <p className="text-xs text-[#9b9890]">As of {new Date(data.generatedAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.</p>
        </div>
      )}
    </div>
  );
}
