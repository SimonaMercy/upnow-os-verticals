'use client';
import { openDocViewerByIds } from '@/lib/docViewer';

/**
 * Legal pipeline — "Export case file" (spec §7.3). Renders GET
 * /legal/disputes/:id/case-file as one clean, print-ready document: cover,
 * lease + registration number, notice + proof, statement of account, payment
 * history, the escalated breach's timeline + attachments, the case documents
 * and the case timeline. "Print / Save as PDF" calls window.print(); the print
 * CSS hides the app chrome and lays the page out for A4.
 *
 * Bundling the attached PDF binaries into one file is out of scope — each
 * attachment is listed by name with its link (footer says so).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { legalApi, CASE_EVENT_TYPE_LABELS, BREACH_EVENT_TYPE_LABELS, BREACH_REPORTED_BY_LABELS, type CaseFile, type LegalDoc } from '@/lib/legal';
import { fmtD, fmtDT, money, claimLabel, errText } from '@/components/legal/StartNoticeModal';

const CHEQUE_LABEL: Record<string, string> = { pending: 'Pending', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled' };

const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-[13px] font-extrabold tracking-[.04em] uppercase text-[#1c1f1d] border-b-2 border-[#1c1f1d] pb-1 mt-7 mb-3 break-after-avoid">{children}</h2>;
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="grid grid-cols-[180px_1fr] gap-3 py-1 border-b border-[#eef0ee] text-[12px]"><span className="text-[#5b615e]">{k}</span><span className="font-semibold">{v ?? '—'}</span></div>
);
const DocList = ({ docs, empty }: { docs: LegalDoc[]; empty: string }) => docs.length === 0 ? <p className="text-[12px] text-[#8a8f8c]">{empty}</p> : (
  <ol className="list-decimal pl-5 text-[12px] space-y-1">
    {docs.map(x => <li key={x.id}><span className="font-semibold">{x.name}</span> <span className="text-[#8a8f8c]">· {fmtD(x.createdAt)}</span> <a href={x.fileUrl} className="text-[#1a7a52] underline break-all print:text-[10px]" target="_blank" rel="noreferrer">{x.fileUrl}</a></li>)}
  </ol>
);

export function CaseFilePrint({ disputeId, base, rp, backHref }: { disputeId: number; base: string; rp?: number | null; backHref: string }) {
  const [cf, setCf] = useState<CaseFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { legalApi.caseFile(base, rp ?? undefined, disputeId).then(setCf).catch(e => setErr(errText(e, 'Could not build the case file.'))); }, [base, rp, disputeId]);

  if (err) return <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-[#b42318]">{err} <Link href={backHref} className="underline ml-2">Back to the case</Link></div>;
  if (!cf) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Building the case file…</div>;

  const d = cf.dispute; const l = cf.lease; const soa = cf.statementOfAccount;
  const timeline = [...cf.timeline].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id); // oldest first reads as a record

  return (
    <div className="case-file-root">
      <style>{`
        @page { size: A4; margin: 16mm 14mm; }
        @media print {
          body * { visibility: hidden !important; }
          .case-file-root, .case-file-root * { visibility: visible !important; }
          .case-file-root { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
          .case-file-root .no-print { display: none !important; }
          .case-file-paper { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; max-width: none !important; }
          .break-after-avoid { break-after: avoid; }
          table { break-inside: auto; } tr { break-inside: avoid; }
        }
      `}</style>
      <div className="max-w-[820px] mx-auto px-4 py-6 text-[#1c1f1d]">
        <div className="no-print flex items-center justify-between gap-3 mb-4 flex-wrap">
          <Link href={backHref} className="text-[12px] font-semibold text-[#5b615e] hover:text-[#1c1f1d] inline-flex items-center gap-1 no-underline"><ArrowLeft size={13} /> Back to case #{d.id}</Link>
          <button type="button" onClick={() => window.print()} className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer inline-flex items-center gap-1.5"><Printer size={13} /> Print / Save as PDF</button>
        </div>

        <div className="case-file-paper bg-white border border-[#e6e8e6] rounded-[14px] px-8 py-8">
          {/* cover */}
          <div className="border-b-4 border-[#1c1f1d] pb-4">
            <div className="text-[10px] font-bold tracking-[.12em] text-[#8a8f8c]">CASE FILE</div>
            <h1 className="text-[22px] font-extrabold tracking-[-.01em] mt-1">Case #{d.id} · {d.typeLabel}</h1>
            <p className="text-[12.5px] text-[#5b615e] mt-1">{d.stageLabel}{d.outcomeLabel ? ` · ${d.outcomeLabel}` : ''} · {d.filedByLabel}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 mt-4">
            <div>
              <Row k="Customer" v={l?.customerName} />
              <Row k="Unit" v={l ? `Unit ${l.unitNumber ?? '—'} · ${l.buildingName ?? ''}` : '—'} />
              <Row k="Lease" v={l ? `CID-${l.id} · ${fmtD(l.startDate)} → ${fmtD(l.endDate)}` : '—'} />
              <Row k="Registration number" v={cf.registration.number ?? <span className="text-[#b42318]">none on record</span>} />
            </div>
            <div>
              <Row k="Rental authority" v={d.config.authorityDisplayName} />
              <Row k="Authority case no." v={d.authorityCaseNumber} />
              <Row k="Filing date" v={d.filingDate ? fmtD(d.filingDate) : '—'} />
              <Row k="Generated" v={fmtDT(cf.generatedAt)} />
            </div>
          </div>

          <H>1 · Lease</H>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Row k="Annual rent" v={money(l?.annualRent)} />
              <Row k="Status" v={l?.status ? l.status.replace(/_/g, ' ') : '—'} />
              <Row k="Registration number" v={cf.registration.number ?? 'none on record'} />
            </div>
            <div>
              <Row k={claimLabel(d.filedBy)} v={money(d.claimAmount)} />
              <Row k="Legal costs paid" v={money(d.costTotals?.paid ?? 0)} />
              <Row k="Charged to customer" v={money(d.costTotals?.recoverableCharged ?? 0)} />
              <Row k="Representative" v={d.contactName ? `${d.contactName}${d.contactPhone ? ` · ${d.contactPhone}` : ''}` : '—'} />
            </div>
          </div>
          <div className="mt-3"><div className="text-[11px] font-bold text-[#5b615e] mb-1">Lease documents (contract, registration certificate)</div><DocList docs={cf.leaseDocuments} empty="No lease documents on record." /></div>
          <div className="mt-3"><div className="text-[11px] font-bold text-[#5b615e] mb-1">Customer KYC documents ({cf.lease?.customerType === 'company' ? 'company' : 'individual'})</div><DocList docs={d.customerDocuments ?? []} empty="No KYC documents on the customer record." /></div>

          <H>2 · Notice</H>
          <Row k="Notice type" v={d.noticeTypeLabel} />
          <Row k="Served on" v={cf.notice.servedDate ? fmtD(cf.notice.servedDate) : '—'} />
          <Row k="Deadline" v={cf.notice.deadline ? fmtD(cf.notice.deadline) : '—'} />
          {d.breachReasonLabels.length > 0 && <Row k="Grounds" v={d.breachReasonLabels.join('; ')} />}
          <Row k="Proof of service" v={cf.notice.proof ? <>{cf.notice.proof.name} · <a href="#" onClick={e => { e.preventDefault(); void openDocViewerByIds([{ id: cf.notice.proof!.id, caption: cf.notice.proof!.name, mimeType: cf.notice.proof!.mimeType }], cf.notice.proof!.name); }} className="text-[#1a7a52] underline break-all" target="_blank" rel="noreferrer">{cf.notice.proof.fileUrl}</a></> : <span className="text-[#b42318]">not filed</span>} />

          <H>3 · Statement of account</H>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Row k="Annual rent" v={money(soa.annualRent)} />
              <Row k="Collected (cleared)" v={money(soa.collected)} />
              <Row k="Bounced" v={<span className={soa.bounced > 0 ? 'text-[#b42318]' : ''}>{money(soa.bounced)}</span>} />
            </div>
            <div>
              <Row k="Pending" v={money(soa.pending)} />
              <Row k={claimLabel(d.filedBy)} v={money(soa.claimAmount)} />
            </div>
          </div>

          <H>4 · Payment history</H>
          {cf.paymentHistory.length === 0 ? <p className="text-[12px] text-[#8a8f8c]">No payments on record.</p> : (
            <table className="w-full text-[11.5px] border-collapse">
              <thead><tr className="text-left text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#1c1f1d]">
                <th className="py-1.5 pr-2">DATE</th><th className="py-1.5 pr-2">DESCRIPTION</th><th className="py-1.5 pr-2">CHEQUE</th><th className="py-1.5 pr-2 text-right">AMOUNT</th><th className="py-1.5 pr-2">STATUS</th><th className="py-1.5">HELD BY</th>
              </tr></thead>
              <tbody>
                {cf.paymentHistory.map(p => (
                  <tr key={p.id} className="border-b border-[#eef0ee]">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{fmtD(p.transactionDate)}</td>
                    <td className="py-1.5 pr-2">{p.description ?? p.paymentType ?? `Payment #${p.id}`}</td>
                    <td className="py-1.5 pr-2">{p.chequeNumber ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold whitespace-nowrap">{money(p.amount)}</td>
                    <td className={`py-1.5 pr-2 font-semibold ${p.chequeStatus === 'bounced' ? 'text-[#b42318]' : p.chequeStatus === 'cleared' ? 'text-[#1a7a52]' : ''}`}>{CHEQUE_LABEL[p.chequeStatus] ?? p.chequeStatus}</td>
                    <td className="py-1.5">{p.heldByLabel ?? '—'}{p.collectedByName ? ` · ${p.collectedByName}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {cf.breach && (
            <>
              <H>5 · Escalated breach #{cf.breach.id} · {cf.breach.categoryLabel}</H>
              <Row k="Opened" v={fmtD(cf.breach.openedDate)} />
              <Row k="Reported by" v={BREACH_REPORTED_BY_LABELS[cf.breach.reportedBy] ?? cf.breach.reportedBy} />
              {cf.breach.description && <Row k="Description" v={cf.breach.description} />}
              {cf.breach.warningSentDate && <Row k="Warning issued" v={`${fmtD(cf.breach.warningSentDate)} — correct by ${fmtD(cf.breach.correctionDeadline)}`} />}
              {cf.breach.finalWarningDate && <Row k="Final warning" v={`${fmtD(cf.breach.finalWarningDate)} — by ${fmtD(cf.breach.finalDeadline)}`} />}
              <div className="mt-3 text-[11px] font-bold text-[#5b615e] mb-1">Warning timeline</div>
              <table className="w-full text-[11.5px] border-collapse">
                <tbody>
                  {[...cf.breach.events].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(e => (
                    <tr key={e.id} className="border-b border-[#eef0ee] align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap w-[90px]">{fmtD(e.date)}</td>
                      <td className="py-1.5 pr-3 font-semibold whitespace-nowrap w-[130px]">{BREACH_EVENT_TYPE_LABELS[e.type] ?? e.type}</td>
                      <td className="py-1.5">{e.description ?? ''}{e.document && <div className="text-[10.5px] text-[#5b615e]">Attachment: {e.document.name}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3"><div className="text-[11px] font-bold text-[#5b615e] mb-1">Breach attachments</div><DocList docs={cf.breach.documents} empty="No attachments on the breach." /></div>
            </>
          )}

          <H>{cf.breach ? 6 : 5} · Case documents</H>
          <DocList docs={cf.caseDocuments} empty="No documents linked to the case." />

          <H>{cf.breach ? 7 : 6} · Case timeline</H>
          <table className="w-full text-[11.5px] border-collapse">
            <tbody>
              {timeline.map(e => (
                <tr key={e.id} className="border-b border-[#eef0ee] align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap w-[90px]">{fmtD(e.date)}</td>
                  <td className="py-1.5 pr-3 font-semibold whitespace-nowrap w-[130px]">{CASE_EVENT_TYPE_LABELS[e.type] ?? e.type}</td>
                  <td className="py-1.5">{e.description ?? ''}{e.amount != null && <span className="font-semibold"> · {money(e.amount)}</span>}{e.document && <div className="text-[10.5px] text-[#5b615e]">Attachment: {e.document.name}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {d.notes && (<><H>Notes</H><p className="text-[12px] whitespace-pre-wrap">{d.notes}</p></>)}

          <p className="text-[10px] text-[#8a8f8c] mt-8 pt-3 border-t border-[#eef0ee]">
            Generated {fmtDT(cf.generatedAt)} from the case record. Attached files are listed by name with their links; bundling the attachment PDFs into this file is not part of this export — open each from the case’s Documents card.
          </p>
        </div>
      </div>
    </div>
  );
}
