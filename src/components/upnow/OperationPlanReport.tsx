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

interface PlanLink { kind: 'lease' | 'lead' | 'unit' | 'job' | 'breach' | 'dispute' | 'vendor-contract' | 'vendor' | 'customers' | 'customer' | 'inspection'; id: number }
interface Note { body: string; by: string | null; at: string }
interface Row {
  key: string; section: string; property: string | null; party: string | null; unit: string | null;
  system: string | null; date: string | null; state: string; nextStep: string; link: PlanLink | null; responsible: string | null;
  /** The last note the team wrote on the record. */
  note: Note | null;
  /** The record's last activity (ISO) — the Operations page's clock; days since are shown. */
  since: string | null;
  /** A badge colour the row's own page dictates (Leads page red / amber), overriding the days tone. */
  tone?: 'red' | 'orange' | 'green';
}
interface Section { key: string; no: number; title: string; rows: Row[] }
interface Payload { generatedAt: string; sections: Section[] }

const fmtDate = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtAt = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
/** Days since the record's last activity — the Operations page's own count (its `daysSince`). */
const daysPending = (since: string | null): number | null => {
  if (!since) return null;
  const t = new Date(since).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};
const pendingFor = (since: string | null): string | null => {
  const d = daysPending(since);
  return d == null ? null : d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`;
};
/** The row's colour by how long the matter has waited — the Operations page's own thresholds (`ageTone`):
 *  7 to 13 days orange, 14 and over red. Anything younger, or with no clock, stays plain (owner, 7 Oct 2026:
 *  "don't show green, only orange and red; the rows should be filled with full colour"). */
type Tone = 'orange' | 'red' | 'neutral';
const toneOf = (since: string | null, own?: Tone | 'green'): Tone => { if (own) return own === 'green' ? 'neutral' : own; const d = daysPending(since); return d == null ? 'neutral' : d >= 14 ? 'red' : d >= 7 ? 'orange' : 'neutral'; };
const TONE_CLASS: Record<Tone, string> = { orange: 'bg-[#fdebc8] text-[#b45309]', red: 'bg-[#fbcaca] text-[#b91c1c]', neutral: 'bg-[#f1efe9] text-[#3d3b35]' };
/** The whole row carries the colour. */
const ROW_CLASS: Record<Tone, string> = { orange: 'bg-[#fff4e5]', red: 'bg-[#fee2e2]', neutral: '' };
const TONE_FILL: Record<Tone, { fill: string; font: string } | null> = { orange: { fill: 'FFFFF4E5', font: 'FFB45309' }, red: { fill: 'FFFEE2E2', font: 'FFB91C1C' }, neutral: null };
/** "— Maria Eloisa, 6 Oct 2026" */
const noteSign = (n: Note) => [n.by, fmtAt(n.at)].filter(Boolean).join(', ');

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
    case 'vendor-contract': return `${base}/amc/${link.id}${q}`;
    case 'vendor': return `${base}/vendors/${link.id}${q}`;
    case 'inspection': return `${base}/building-inspections/${link.id}${q}`;
    case 'customers': return `${base}/tenants${q}`;
    case 'customer': return `${base}/tenants/${link.id}${q}`;
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
    ws.columns = [30.7, 23.7, 20.5, 18, 39.6, 60.7, 24.3, 21.5, 60.7].map(width => ({ width }));
    const font = { name: 'Arial Nova Cond', size: 12 };
    const thin = { style: 'thin' as const };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    // The team's eight columns as they are; the last note rides along as a ninth, after Status.
    const head = ws.addRow(['Category', 'Property', 'Tenant/Customer/ Vendors', 'Unit / No', 'Current Position/Issues', 'What Needs to Happen', 'Reponsible', 'Status', 'Last Note']);
    head.height = 47;
    head.eachCell(c => { c.font = { ...font, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF808080' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border; });
    const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : ' -');
    for (const sec of data.sections) {
      const rows: (Row | null)[] = sec.rows.length ? sec.rows : [null];
      const start = ws.rowCount + 1;
      for (const r of rows) {
        const row = ws.addRow([sec.title, dash(r?.property), dash(r?.party), dash(r?.unit), dash(r?.system), dash(r?.nextStep), dash(r?.responsible), dash(r ? [r.state, pendingFor(r.since)].filter(Boolean).join(' · ') : null), dash(r?.note ? `${r.note.body}\n— ${noteSign(r.note)}` : null)]);
        row.eachCell({ includeEmpty: true }, c => { c.font = font; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
        if (r) { const t = TONE_FILL[toneOf(r.since, r.tone)]; if (t) { row.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: t.fill } }; }); const cell = row.getCell(8); cell.font = { ...font, bold: true, color: { argb: t.font } }; } }
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
            The work on the books, section by section — {total} items. Each matter's current position, the stage it is at, what that stage calls for, the last note on it, and who handles it.
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
                        <th className="py-2 px-3 font-medium min-w-[280px]">Current position / issues</th>
                        <th className="py-2 px-3 font-medium w-[160px]">What needs to happen</th>
                        <th className="py-2 px-3 font-medium min-w-[240px]">Last note</th>
                        <th className="py-2 px-3 font-medium w-[150px]">Responsible</th>
                        <th className="py-2 px-3 pr-4 font-medium w-[170px]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.rows.map(r => {
                        const href = hrefOf(r.link, managerRp);
                        return (
                          <tr key={r.key} className={`border-b border-[#f1efe9] last:border-0 ${ROW_CLASS[toneOf(r.since, r.tone)]}`}>
                            <td className="py-2 pl-4 pr-3 text-[#3d3b35]">{r.property ?? '—'}</td>
                            <td className="py-2 px-3 text-[#26241f]">
                              {r.party && <span className="font-medium">{r.party}</span>}
                              {r.unit && <span className={r.party ? 'text-[#6b6860]' : 'font-medium'}>{r.party ? ` — ${r.unit}` : r.unit}</span>}
                              {!r.party && !r.unit && '—'}
                              {href && <Link href={href} className="ml-1.5 inline-flex align-middle text-[#2e9f82] print:hidden" title="Open"><ExternalLink size={12} /></Link>}
                            </td>
                            <td className="py-2 px-3 text-[#3d3b35] whitespace-pre-line">{r.system}{r.date && <div className="text-xs text-[#8a8780] mt-0.5">{fmtDate(r.date)}</div>}</td>
                            <td className="py-2 px-3 text-[#3d3b35]">{r.nextStep}</td>
                            <td className="py-2 px-3 text-[#3d3b35]">{r.note ? <><div className="whitespace-pre-line">{r.note.body}</div><div className="text-xs text-[#8a8780] mt-0.5">{noteSign(r.note)}</div></> : <span className="text-[#9b9890]">—</span>}</td>
                            <td className="py-2 px-3 text-[#26241f]">{r.responsible ?? '—'}</td>
                            <td className="py-2 px-3 pr-4"><span className={`inline-block text-xs font-semibold rounded-lg px-2 py-1 ${TONE_CLASS[toneOf(r.since, r.tone)]}`}>{r.state}</span>{pendingFor(r.since) && <div className="text-xs text-[#8a8780] mt-1">{pendingFor(r.since)}</div>}</td>
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
