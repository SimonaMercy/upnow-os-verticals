'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — behaviour unchanged. */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, FileSignature, Clock, CreditCard, RotateCcw, X, AlertCircle, Check, UploadCloud, Eye, ExternalLink, Pencil, ClipboardCheck, Wallet } from 'lucide-react';
import { DocsLinkButton } from '@/components/upnow/DocsLinkButton';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import { PlanAttachCell } from '@/components/upnow/PlanAttachCell';
import { slotOfDoc, fileNameOfDoc, isPaymentAdviceKey, chequeReadingOf, sameChequeNumber, type ChequeReading } from '@/lib/planAttach';
import { SegregatedPlanView } from '@/components/upnow/SegregatedPlanView';
import { segRowsFromContract, buildSegregatedPlan, rentSlotLabels, planOrder } from '@/lib/segregatedPlan';
import { buildCurrentPlan } from '@/lib/currentPlan';
import { openDocViewer } from '@/lib/docViewer';
import { DeleteDocumentButton } from '@/components/upnow/DeleteDocumentButton';
import { moveOutReasonLabel } from '@/lib/moveOutReasons';
import RenewalNoticeDelivery from '@/components/contract/RenewalNoticeDelivery';
import { ContractDoc, ContractPayment, DerivedState, PAYMENT_METHODS, STEPS_NEW, STEPS_RENEWAL, StepContent, StepHandlers, StepKey, feeActive, fmtAed, fmtDate, isDone } from './shared';
import { SignatureAuditTrail } from './signing';

export function Completed({ title, sub, onUndo, undoLabel, viewUrl, viewLabel, onView }: { title: string; sub?: string; onUndo?: () => void; undoLabel?: string; viewUrl?: string | null; viewLabel?: string; onView?: () => void }) {
  // `onView` routes customer-uploaded documents through the in-app viewer; the
  // `viewUrl` link is reserved for the generated Ejari PDF and in-app workspace
  // routes (move-out inspection / settlement), which stay externally openable.
  const hasView = !!onView || !!viewUrl;
  return (
    <div className="donepanel">
      <span className="dp-ic"><Check size={18} /></span>
      <div>
        <div className="dp-t">{title}</div>
        {sub && <div className="dp-s">{sub}</div>}
      </div>
      {onView
        ? <button type="button" onClick={onView} className="btn btn-ghost btn-sm cursor-pointer" style={{ marginLeft: 'auto' }}><ExternalLink size={13} /> {viewLabel || 'View'}</button>
        : viewUrl && <a href={viewUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}><ExternalLink size={13} /> {viewLabel || 'View'}</a>}
      {onUndo && <button className="btn btn-ghost btn-sm" style={{ marginLeft: hasView ? 8 : 'auto' }} onClick={onUndo}>{undoLabel || 'Update'}</button>}
    </div>
  );
}

/** RP review of the customer-uploaded utility proof: view the bill + confirm or reject. */
export function UtilityReview({ proof, accountNumber, onConfirm, onReject, onUpload, lock }: {
  proof: ContractDoc; accountNumber?: string | null; onConfirm: () => void; onReject: () => void; onUpload: () => void; lock?: boolean;
}) {
  return (
    <>
      <div className="upbox">
        <span className="uf">
          <span className="ufi"><FileText size={15} /></span>
          {proof.displayName ?? 'Utility proof'}{accountNumber ? ` · ${accountNumber}` : ''}
        </span>
        <button type="button" onClick={() => openDocViewer({ fileUrl: proof.fileUrl, caption: proof.displayName ?? 'Utility proof' })} className="mini-btn view cursor-pointer" style={{ marginLeft: 'auto' }}><ExternalLink size={12} /> View bill</button>
      </div>
      {!lock && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="btn btn-jade btn-sm" onClick={onConfirm}>
            <Check size={13} /> Confirm utility account
          </button>
          <button className="mini-btn no cursor-pointer" onClick={onReject}>
            <X size={13} /> Reject
          </button>
        </div>
      )}
      {!lock && <button className="ca" style={{ justifySelf: 'start', marginTop: 4, padding: 0 }} onClick={onUpload}>Upload a different proof</button>}
    </>
  );
}

export function ChkRow({
  on, label, hint, onToggle, actionLabel, onAction, locked,
}: {
  on: boolean;
  label: string;
  hint?: string | null;
  onToggle: () => void;
  actionLabel?: string;
  onAction?: () => void;
  /** When true: hide the right-side Undo/action button entirely and
   *  make the checkbox a no-op. Used post-activation so the signing
   *  record can't be silently un-signed. */
  locked?: boolean;
}) {
  return (
    <div className={'chkrow ' + (on ? 'on' : '')}>
      <span className="cb" onClick={locked ? undefined : onToggle}>
        {on ? <Check size={12} /> : null}
      </span>
      <span className="ct">
        {label}
        {hint && <span style={{ color: 'var(--mute)', fontWeight: 500 }}> — {hint}</span>}
      </span>
      {!locked && (on
        ? <button className="ca" onClick={onToggle}>Undo</button>
        : onAction && <button className="ca" onClick={onAction}>{actionLabel}</button>)}
    </div>
  );
}

export function UploadAction({
  fileLabel, onUpload, onMark, uploadLabel = 'Upload & register',
}: { fileLabel: string; onUpload: () => void; onMark?: () => void; uploadLabel?: string }) {
  return (
    <>
      <div className="upbox">
        <span className="uf">
          <span className="ufi"><FileText size={15} /></span> {fileLabel}
        </span>
        <button className="btn btn-jade btn-sm" style={{ marginLeft: 'auto' }} onClick={onUpload}>
          <UploadCloud size={13} /> {uploadLabel}
        </button>
      </div>
      {onMark && (
        <button className="ca" style={{ justifySelf: 'start', marginTop: -4, padding: 0 }} onClick={onMark}>
          Mark as already on file
        </button>
      )}
    </>
  );
}

/** A labelled sub-section inside the renewal "Terms agreed" step — the former
 *  Documents and Cheques / PDC steps live here now, actions unchanged. */
export function TermsSubSection({ n, title, done, children }: { n: string; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: '1px dashed var(--mist-strong)', paddingTop: 14, marginTop: 14, display: 'grid', gap: 10 }} aria-label={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="eyebrow">{n} · {title}</span>
        <span className={'flag' + (done ? '' : ' waiting')} style={{ marginLeft: 'auto' }}>
          {done ? <><Check size={12} /> Done</> : 'Open'}
        </span>
      </div>
      {children}
    </section>
  );
}

/** Increment the trailing number of a cheque serial, e.g. "CK001234" -> "CK001235".
 *  Cheques come off one book, so recording the first one gives every later row a
 *  sensible default. Mirrors the lead card's helper of the same name. */
export function nextSerial(base: string, offset = 1): string {
  const m = base.match(/^(.*?)(\d+)$/);
  if (!m) return base;
  const [, prefix, digits] = m;
  return prefix + (parseInt(digits, 10) + offset).toString().padStart(digits.length, '0');
}

/** The renewal's Payment Summary with one attach control per payment row — the
 *  SAME card, rows and tag rule as the customer's Payments step (spaces/v2), so
 *  the file the customer attached to Instalment 1 is Instalment 1's file here,
 *  and one the landlord attaches here is the customer's too. Files sent "all
 *  together" (no tag, or a tag the plan no longer has) list underneath with a
 *  Tag-to control, the same as the customer's own untagged bucket. */
export function RenewalChequeAttachments({ h, chequeDocs, canEdit }: { h: StepHandlers; chequeDocs: ContractDoc[]; canEdit: boolean }) {
  const [uploading, setUploading] = useState(0);
  const [tagBusy, setTagBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = segRowsFromContract(h.contract, h.contract.payments ?? []);
  const plan = buildCurrentPlan(h.contract, h.contract.payments ?? []);
  // Every slot label the card will render — rent per instalment, the other
  // groups once at their heading (SegregatedPlanView's own terms).
  const slotLabels = buildSegregatedPlan(rows).groups.flatMap(g =>
    g.key === 'rental' ? g.lines.map(l => `Rent — ${l.item}`) : [g.title],
  );
  // A scan holding several cheques carries no single tag: it is matched when a
  // payment points at it (payments.document_id), which the reader sets.
  const linkedDocIds = new Set([...(h.contract.payments ?? []), ...(h.contract.fees ?? [])].map(p => p.documentId).filter((id): id is number => id != null));
  const untagged = chequeDocs.filter(d => { const t = slotOfDoc(d.displayName); return (!t || !slotLabels.includes(t)) && !linkedDocIds.has(d.id); });
  const onFiles = async (label: string, files: FileList | null, replaceIds?: number[]) => {
    setErr(null); setUploading(files?.length ?? 0);
    try { await h.onAttachChequeForSlot(label, files, replaceIds); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(0); }
  };
  const onRemove = async (id: number) => {
    setErr(null);
    try { await h.onRemoveChequeDoc(id); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the file'); }
  };
  const onTag = async (id: number, label: string) => {
    setErr(null); setTagBusy(id);
    try { await h.onTagChequeDoc(id, label); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not tag the file'); }
    finally { setTagBusy(null); }
  };
  // First visit: read whatever is on file and not yet read (nothing is sent to
  // the reader twice), so cheques the customer attached arrive already placed.
  useEffect(() => {
    if (h.chequeIntake == null && !h.chequeReading && chequeDocs.length > 0 && !h.contract.pdcConfirmed) void h.onReadCheques();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.chequeIntake, chequeDocs.length]);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Each cheque is attached against its own payment on the schedule (owner,
          6 Oct 2026: no bulk box). The reader runs on every file attached. */}
      {h.chequeReading && <p className="note" style={{ margin: 0 }}>Reading the cheques…</p>}
      {h.chequeIntake?.removed?.map(r => (
        <div key={r.name + r.reason} className="errline">{r.name} was not accepted and has been removed: {r.reason}</div>
      ))}
      {/* No separate list of what was read: the Payment Summary shows each
          cheque on its payment, and the Payments rows below carry the read
          facts. Only a refusal needs its own line. */}
      <PaymentPlanCard
        plan={plan}
        rows={rows}
        refLabel={h.contract.ref}
        contractType={h.contract.contractType}
        tenantName={h.contract.tenant.companyName || h.contract.tenant.name}
        landlordName={h.contract.landlord.bankAccountName || h.contract.landlord.companyName || h.contract.landlord.name}
        unitNumber={h.contract.unit.number}
        buildingName={h.contract.property.buildingName}
        community={h.contract.property.community || h.contract.property.emirate}
        periodStart={h.contract.startDate}
        periodEnd={h.contract.endDate}
        bankDetails={h.contract.landlord.bankDetails}
        renderAttach={(slot) => {
          // A fee group already paid on an instalment's cheque takes no file of its own.
          if (!slot.label.startsWith('Rent \u2014 ')) {
            const feeRows = [...(h.contract.payments ?? []), ...(h.contract.fees ?? [])].filter(p => !['rental_income', 'rent', 'security_deposit'].includes((p.paymentType ?? '').toLowerCase()));
            const rentNos = new Set((h.contract.payments ?? []).filter(p => ['rental_income', 'rent'].includes((p.paymentType ?? '').toLowerCase())).map(p => p.chequeNumber).filter(Boolean));
            const paidBy = feeRows.length > 0 && feeRows.every(p => p.chequeNumber && rentNos.has(p.chequeNumber)) ? feeRows[0].chequeNumber : null;
            if (paidBy) return <span style={{ fontSize: 11.5, color: 'var(--jade-deep, #1a7a52)', fontWeight: 600 }}>Paid on cheque {paidBy}</span>;
          }
          return (
            <PlanAttachCell
              slot={slot}
              refs={chequeDocs.filter(d => slotOfDoc(d.displayName) === slot.label).map(d => ({ id: d.id, imageUrl: d.fileUrl ?? null }))}
              uploading={uploading}
              onFiles={(label, files, replaceIds) => void onFiles(label, files, replaceIds)}
              onRemove={(id) => void onRemove(id)}
              readOnly={!canEdit}
            />
          );
        }}
      />
      {/* Files not matched to a payment — sent before per-payment attach existed,
          or tagged to a slot the plan no longer has. Tag each to its payment
          here. There is no "send them all together" box any more (same on the
          customer's side): a cheque attached against its own payment is the one
          the reader can check against that payment. */}
      {untagged.length > 0 && (
        <div className="doclist">
          <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>Not matched to a payment</span>
            <span style={{ color: 'var(--mute)', fontWeight: 600 }}>{untagged.length} file{untagged.length === 1 ? '' : 's'}</span>
          </div>
          {untagged.map((doc, i) => {
            const label = fileNameOfDoc(doc.displayName) || `Cheque ${i + 1}`;
            const open = () => doc.fileUrl && openDocViewer({ fileUrl: doc.fileUrl, caption: label });
            return (
              <div key={doc.id} className="uprow">
                <button type="button" className="upthumb" onClick={open} disabled={!doc.fileUrl} aria-label={`Preview ${label}`}>
                  {doc.fileUrl && !doc.fileUrl.toLowerCase().split('?')[0].endsWith('.pdf')
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={doc.fileUrl} alt={label} />
                    : <FileText size={16} />}
                </button>
                <div className="upmeta">
                  <div className="dn">{label}</div>
                  <div className="ds">Not tagged to a payment yet</div>
                  <div className="upctl">
                    {doc.fileUrl && <button type="button" className="mini-btn view" onClick={open}><Eye size={12} /> View</button>}
                    {canEdit && (
                      <select className="qinput" style={{ width: 210 }} aria-label={`Tag ${label} to a payment`} value=""
                        disabled={tagBusy === doc.id} onChange={e => { if (e.target.value) void onTag(doc.id, e.target.value); }}>
                        <option value="">Tag to payment…</option>
                        {slotLabels.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    )}
                    {canEdit && <button type="button" className="mini-btn" onClick={() => void onRemove(doc.id)}>Remove</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {err && <div className="errline">{err}</div>}
    </div>
  );
}

/** Renewal Cheques/PDC step body (RP side). Before the customer submits, a waiting
 *  panel. Once submitted: the RP records each cheque against the payment plan
 *  (number / method / date / status via the existing payments PATCH), views the
 *  customer's uploaded cheque(s) filed as Payment Advice, then marks collected —
 *  which sets pdcConfirmed and unlocks Signatures. */
export function RenewalChequeCollect({ h }: { h: StepHandlers }) {
  const submitted = !!h.contract.tenantChequesSubmittedAt;
  const canEdit = h.perms.collections;
  const rows: ContractPayment[] = [
    ...(h.contract.payments ?? []).filter(p => (p.paymentType ?? '') !== 'security_deposit'),
    ...(h.contract.fees ?? []),
  ];
  // The cheque images / PDFs, filed as Payment Advice — the same set the
  // customer's Payments step reads (lib/planAttach).
  const chequeDocs = (h.contract.documents ?? []).filter(d => isPaymentAdviceKey(d.documentKey));

  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Method + reference typed against a row but NOT yet committed. Nothing is
   *  written until "Record" — exactly like the lead card, where filling the two
   *  fields is preparation and Record is the act of recording the cheque. */
  const [draft, setDraft] = useState<Record<number, { method?: string; ref?: string; bank?: string }>>({});
  /** Rows the RP re-opened to correct after recording. */
  const [reopened, setReopened] = useState<Set<number>>(new Set());
  /** Rows whose cheque is shown inline, under the row, so the number, amount
   *  and date on the paper can be checked against the row without a popup
   *  covering it (owner, 6 Oct 2026). */
  const [shown, setShown] = useState<Set<number>>(new Set());
  const chequeFileFor = (r: ContractPayment): ContractDoc | undefined =>
    (r.documentId != null ? chequeDocs.find(d => d.id === r.documentId) : undefined)
    ?? (h.chequeIntake?.files.find(f => f.cheques.some(c => c.paymentIds.includes(r.id)))
      ? chequeDocs.find(d => d.id === h.chequeIntake!.files.find(f => f.cheques.some(c => c.paymentIds.includes(r.id)))!.documentId)
      : undefined);

  /** Commit a row. Returns false (and shows the reason) when the PATCH fails, so
   *  the caller doesn't clear the draft the RP would then have to retype. */
  const patchRow = async (id: number, patch: Parameters<StepHandlers['onUpdatePayment']>[1]): Promise<boolean> => {
    setBusyId(id); setErr(null);
    try { await h.onUpdatePayment(id, patch); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to record'); return false; }
    finally { setBusyId(null); }
  };

  // Every payment being COLLECTED on this renewal in one numbered series — fees
  // and rent instalments together, ordered the way the lead's Record Cheques card
  // orders them (due date, then deposit → fee → instalment), so #3 means the same
  // payment on both sides. Fees live on `contract.fees`, rent on `contract.payments`.
  // The security deposit is deliberately absent: on a renewal it was collected on
  // the previous term and carried forward, so there is no cheque to record for it
  // here. (It is still shown, held, in the Payments record below.) A deposit that
  // IS this contract's own payment row stays in the series.
  // Same sequence as the Payment Summary above: rent instalments, then the
  // management fees, then third party (owner, 6 Oct 2026).
  const payRows: ContractPayment[] = [
    ...(h.contract.payments ?? []),
    ...(h.contract.fees ?? []),
  ]
    .sort((a, b) => planOrder(
      { paymentType: a.paymentType ?? null, amount: a.amount || 0, transactionDate: a.transactionDate ?? null },
      { paymentType: b.paymentType ?? null, amount: b.amount || 0, transactionDate: b.transactionDate ?? null },
    ));
  // Bounced / cancelled cheques are void — they stay in the list as history but
  // are out of the header total, the same rule the Payments table applies.
  const payTotal = payRows.reduce((t, r) => t + (feeActive(r) ? (r.amount || 0) : 0), 0);

  // What the reader found on the cheque attached against each rent instalment.
  // One file per instalment is the only case offered: a slot holding several
  // files, or a group attached once at its heading, has no single cheque to
  // read a row's reference from.
  const slotOf = rentSlotLabels(h.contract.payments ?? []);
  const readingOf = (r: ContractPayment): { read: ChequeReading | null; failed: boolean } => {
    // The cheque the reader placed on this payment — also right for a scan that
    // holds several cheques, and for a fee paid on the rent's cheque.
    for (const f of h.chequeIntake?.files ?? []) {
      const q = f.cheques.find(c => c.outcome === 'matched' && c.paymentIds.includes(r.id));
      if (q) return { read: { chequeNumber: q.chequeNumber, bankName: q.bankName, amountFils: q.amount != null ? Math.round(q.amount * 100) : null, date: q.date, payeeName: q.payeeName, accountNumber: null }, failed: false };
    }
    const label = slotOf.get(r);
    const files = label ? chequeDocs.filter(d => slotOfDoc(d.displayName) === label) : [];
    if (files.length !== 1) return { read: null, failed: false };
    return { read: chequeReadingOf(files[0].reading), failed: files[0].reading?.status === 'failed' };
  };

  // Cheque paperwork can already be in hand while the collection was never
  // CONFIRMED — an imported lease, or one demoted back to ISSUED after it ran.
  // Saying "waiting for the customer" there blames the wrong party and hides the
  // fact that the only outstanding thing is the RP's own confirmation, so the
  // panel names the real gap and points at the action that closes it.
  // Only a FILE is evidence. A cheque number typed on the plan used to count
  // too, so the step said "already on file" over an empty slot (owner, 22 Sep
  // 2026, lease 379).
  const evidenceOnFile = chequeDocs.length > 0;

  if (!submitted) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--saffron-soft, #fff7ed)', color: 'var(--saffron-deep, #c2410c)', fontSize: 13, fontWeight: 600 }}>
          {evidenceOnFile
            ? <>Cheques for this renewal are already on file, but their collection was never confirmed — so this lease cannot go live. Check them below, then mark them on file to record the collection.</>
            : <>Waiting for {h.contract.tenant.name || 'the customer'} to upload &amp; submit their cheques. Once they do, record each cheque here and mark them collected to unlock signing.</>}
        </div>
        {/* The SAME Payment Summary the customer attaches on — one cheque per
            payment row, read and written by the same tag on both sides. The
            landlord can attach on the customer's behalf (cheques handed over at
            the office) and then mark them on file. */}
        <RenewalChequeAttachments h={h} chequeDocs={chequeDocs} canEdit={canEdit} />
        {canEdit && evidenceOnFile && (
          <button type="button" className="btn btn-jade btn-block" onClick={() => void h.onMarkChequesOnFile()}>
            <Check size={15} /> Mark cheques as on file
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <RenewalChequeAttachments h={h} chequeDocs={chequeDocs} canEdit={canEdit} />
      {/* The SAME Record-Cheques card the new lease uses on the lead
          (ChequesSection in leads/[id]): Instalment · Method · Reference ·
          Record, one row per planned payment, numbered, with the cheque total in
          the header. Method + reference are a draft until "Record" commits them
          — the button means the same thing on both sides. The renewal used to
          get a cut-down ledger instead, which is a different job from recording
          a cheque. Shares the .paygrid / .payrow styles by name. */}
      <div className="chqbox">
        <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span><CreditCard size={13} style={{ verticalAlign: '-2px' }} /> Payments</span>
          <span style={{ color: 'var(--mute)', fontWeight: 600 }}>{payRows.length} &middot; {fmtAed(payTotal)}</span>
        </div>
        {err && <div className="errline">{err}</div>}
        <div className="paygrid">
          <div className="payhead">
            <span>Instalment</span><span>Method</span><span>Reference</span><span>Bank</span><span>Record</span>
          </div>
          {payRows.map((r, i) => {
            const d = draft[r.id] ?? {};
            const method = d.method ?? r.paymentMethod ?? 'cheque';
            const { read, failed: readFailed } = readingOf(r);
            // Offered, not recorded: the number read off the cheque fills an EMPTY
            // reference, and "Record" is still the RP's act.
            const offered = d.ref == null && !r.chequeNumber ? (read?.chequeNumber ?? '') : '';
            const reference = d.ref ?? r.chequeNumber ?? offered;
            // The bank: typed, else on the row, else what the reader found.
            const bank = d.bank ?? r.bankName ?? read?.bankName ?? '';
            const readNotes: string[] = [];
            if (read) {
              if (read.chequeNumber && r.chequeNumber && !sameChequeNumber(read.chequeNumber, r.chequeNumber)) readNotes.push(`the cheque reads No. ${read.chequeNumber}, recorded as ${r.chequeNumber}`);
              if (read.amountFils != null) {
                // One cheque often pays the instalment AND the fees due with it
                // (rent + admin + registration on the first cheque). So the cheque
                // is right when it equals this payment alone, or the payments
                // recorded on the same cheque number, or those due the same day.
                const sum = (rows: ContractPayment[]) => rows.reduce((t, x) => t + (feeActive(x) ? (x.amount || 0) : 0), 0);
                const sameCheque = r.chequeNumber ? sum(payRows.filter(x => sameChequeNumber(x.chequeNumber, r.chequeNumber))) : null;
                const sameDay = sum(payRows.filter(x => (x.transactionDate ?? '').slice(0, 10) === (r.transactionDate ?? '').slice(0, 10)));
                const expected = [r.amount || 0, sameCheque, sameDay].filter((v): v is number => v != null);
                const readAed = read.amountFils / 100;
                if (!expected.some(v => Math.abs(readAed - v) < 0.01)) {
                  readNotes.push(`the cheque is for ${fmtAed(readAed)}, ${expected.length > 1 && Math.max(...expected) !== (r.amount || 0) ? `this payment is ${fmtAed(r.amount)} (${fmtAed(Math.max(...expected))} with the fees on it)` : `this payment is ${fmtAed(r.amount)}`}`);
                }
              }
              if (read.date && r.transactionDate && read.date !== r.transactionDate.slice(0, 10)) readNotes.push(`the cheque is dated ${fmtDate(read.date)}, this payment is due ${fmtDate(r.transactionDate)}`);
            }
            // A row counts as recorded once its cheque reference is on the row —
            // the contract equivalent of the lead's lead_cheques record.
            const recorded = !!r.chequeNumber && !reopened.has(r.id);
            return (
              <div key={r.id} className="payrow">
                <div className="payrow-info">
                  <span className="payrow-n">#{i + 1}</span>
                  <span className="payrow-lbl">
                    <span className="payrow-desc" title={r.description ?? undefined}>{r.description ?? 'Payment'}</span>
                    {/* Two short lines: what the payment is, then the cheque that
                        pays it — one line, read off the paper when it was, with
                        a tick; the number is never printed twice. */}
                    <span className="payrow-sub">
                      {fmtAed(r.amount)}{r.transactionDate ? ` \u00b7 due ${fmtDate(r.transactionDate)}` : ''}
                    </span>
                  </span>
                </div>
                <select
                      className="qinput payrow-ctl"
                      aria-label={`${r.description ?? 'Payment'} method`}
                      value={method}
                      disabled={!canEdit || recorded}
                      onChange={e => setDraft(v => ({ ...v, [r.id]: { ...v[r.id], method: e.target.value } }))}
                    >
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <input
                      className="qinput payrow-ctl"
                      type="text"
                      aria-label={`${r.description ?? 'Payment'} reference`}
                      placeholder="Cheque # / ID…"
                      value={reference}
                      disabled={!canEdit || recorded}
                      onChange={e => setDraft(v => ({ ...v, [r.id]: { ...v[r.id], ref: e.target.value } }))}
                      // Cheques come off one book, so the rest of the series is
                      // the same serial counting up. Fill the empty rows below
                      // rather than making the RP type eight near-identical
                      // numbers — same courtesy the lead card gives.
                      onBlur={e => {
                        const val = e.currentTarget.value.trim();
                        if (!val) return;
                        setDraft(v => {
                          const next = { ...v };
                          let step = 1;
                          for (let k = i + 1; k < payRows.length; k++) {
                            const t = payRows[k];
                            if ((next[t.id]?.ref ?? t.chequeNumber ?? '').trim()) continue;
                            next[t.id] = { ...next[t.id], ref: nextSerial(val, step) };
                            step += 1;
                          }
                          return next;
                        });
                      }}
                    />
                    <input
                      className="qinput payrow-ctl"
                      type="text"
                      aria-label={`${r.description ?? 'Payment'} bank`}
                      placeholder="Bank…"
                      value={bank}
                      disabled={!canEdit || recorded}
                      onChange={e => setDraft(v => ({ ...v, [r.id]: { ...v[r.id], bank: e.target.value } }))}
                    />
                    <div className="payrow-rec">
                      {recorded ? (
                        <>
                          <select
                            className={'qinput cstat ' + (r.chequeStatus ?? 'pending')}
                            aria-label={`${r.description ?? 'Payment'} status`}
                            value={r.chequeStatus ?? 'pending'}
                            disabled={!canEdit || busyId === r.id}
                            onChange={e => void patchRow(r.id, { chequeStatus: e.target.value })}
                          >
                            <option value="pending">Pending</option>
                            <option value="cleared">Cleared</option>
                            <option value="bounced">Bounced</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          {canEdit && (
                            // Correct a mistyped cheque — re-opens the two fields.
                            // Never a delete: a payment line is history, and fee
                            // lines are never removed.
                            <button type="button" className="mini-btn view" title="Correct this cheque"
                              onClick={() => setReopened(prev => new Set(prev).add(r.id))}>
                              <Pencil size={12} />
                            </button>
                          )}
                        </>
                      ) : canEdit ? (
                        <button
                          type="button"
                          className="btn btn-jade btn-sm"
                          disabled={busyId === r.id}
                          onClick={async () => {
                            const serial = reference.trim();
                            if (!serial) { setErr(`Type the cheque # in Reference for #${i + 1} first`); return; }
                            const ok = await patchRow(r.id, { chequeNumber: serial, bankName: bank.trim() || null, paymentMethod: method, chequeStatus: r.chequeStatus ?? 'pending' });
                            if (ok) {
                              setReopened(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                              setDraft(v => { const n = { ...v }; delete n[r.id]; return n; });
                            }
                          }}
                        >
                          {busyId === r.id ? '\u2026' : 'Record'}
                        </button>
                      ) : (
                        <span className={'cstat ' + (r.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>{r.chequeStatus ?? 'pending'}</span>
                  )}
                </div>
                {/* Second line, full width: the cheque that pays this row. */}
                {(read || recorded || readFailed || readNotes.length > 0) && (
                  <div className="payrow-cheque">
                    {(read || recorded) && (() => {
                      const no = read?.chequeNumber ?? r.chequeNumber;
                      const bank = read?.bankName ?? r.bankName;
                      const sharedWith = read?.chequeNumber ? payRows.filter(x => sameChequeNumber(x.chequeNumber, read.chequeNumber)).length : 0;
                      return (
                        <span className="chqstrip">
                          {read ? (
                            <span className="chqcell"><span className="v" style={{ color: 'var(--jade-deep)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Check size={12} /> Read from the cheque{read.amountFils != null ? ` \u00b7 ${fmtAed(read.amountFils / 100)}` : ''}{read.date ? ` \u00b7 ${fmtDate(read.date)}` : ''}{sharedWith > 1 ? ` \u00b7 pays ${sharedWith} payments` : ''}
                            </span></span>
                          ) : (
                            <span className="chqcell"><span className="v" style={{ color: 'var(--mute)', fontWeight: 600 }}>Typed{no ? ` \u00b7 ${no}` : ''}{bank ? ` \u00b7 ${bank}` : ''}</span></span>
                          )}
                        </span>
                      );
                    })()}
                    {chequeFileFor(r) && (
                      <button type="button" className="linkbtn" style={{ fontSize: 11.5, padding: 0, marginLeft: 'auto' }}
                        onClick={() => setShown(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                        <Eye size={11} /> {shown.has(r.id) ? 'Hide cheque' : 'Show cheque here'}
                      </button>
                    )}
                    {readFailed && <span className="payrow-sub">The cheque could not be read &mdash; type the reference.</span>}
                    {readNotes.map(n => (
                      <span key={n} className="payrow-sub" style={{ color: 'var(--saffron-deep, #c2410c)', fontWeight: 600 }}>Check: {n}</span>
                    ))}
                  </div>
                )}
                {shown.has(r.id) && (() => {
                  const f = chequeFileFor(r)!;
                  const isPdf = f.fileUrl.toLowerCase().split('?')[0].endsWith('.pdf');
                  return (
                    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--mist-strong, #e5e2da)', paddingTop: 8 }}>
                      {isPdf
                        ? <iframe title={`Cheque for ${r.description ?? 'payment'}`} src={f.fileUrl} style={{ width: '100%', height: 420, border: '1px solid var(--mist-strong, #e5e2da)', borderRadius: 8, background: '#fff' }} />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={f.fileUrl} alt={`Cheque for ${r.description ?? 'payment'}`} style={{ width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--mist-strong, #e5e2da)', background: '#fff' }} />}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
      {canEdit && (
        <button
          type="button"
          className="btn btn-jade btn-block"
          disabled={confirming}
          onClick={() => { setConfirming(true); setErr(null); void h.onConfirmPdc().catch(e => setErr(e instanceof Error ? e.message : 'Failed to confirm payment')).finally(() => setConfirming(false)); }}
        >
          <Check size={15} /> {confirming ? 'Confirming…' : 'Confirm payment received'}
        </button>
      )}
      <p className="note" style={{ margin: 0 }}>Confirm once every cheque above is in hand, or the bank transfer has been received — this unlocks the signature step and counts the lease's rent.</p>
    </div>
  );
}

/** Renewal Documents step body (RP side). Reuses the SAME per-document
 *  View / Approve / Reject pattern as the lead + new-lease KYC review (backed by
 *  POST /documents/:id/verify and /reject) so the RP's experience is consistent
 *  across flows. The customer re-uploads the KYC docs that expired since the last
 *  lease; once every flagged doc has a fresh (non-expired, non-rejected) copy, the
 *  RP presses "Accept documents & unlock cheques" to advance the renewal. */
export function RenewalDocReview({ h }: { h: StepHandlers }) {
  const canEdit = h.perms.renewals || h.perms.agreements;
  const remaining = h.contract.expiredKycDocKeys ?? [];
  // Of the flagged bases, the ones stuck only for want of an expiry date. Splitting these
  // out is what keeps the step from dead-ending: a copy nobody dated can't be fixed by the
  // customer sending the same undated copy again, but the RP is looking right at the date.
  const undated = h.contract.kycExpiryMissingKeys ?? [];
  const awaitingCustomer = remaining.filter(b => !undated.includes(b));
  const LABELS: Record<string, string> = {
    emirates_id: 'Emirates ID', passport: 'Passport', visa: 'UAE Visa / Residency', trade_license: 'Trade License',
  };
  // The slot(s) each flagged base is uploaded into — the SAME keys the customer's
  // own renewal step writes to (spaces v2 BASE_SLOTS), so a copy sent through the
  // upload link refreshes the base here instead of landing as a stray file.
  // Emirates ID is TWO slots, front and back, as it is everywhere else.
  const UPLOAD_SLOTS: Record<string, { key: string; label: string; category: string }[]> = {
    emirates_id: [
      { key: 'emirates_id_front', label: 'Emirates ID — Front', category: 'identity' },
      { key: 'emirates_id_back',  label: 'Emirates ID — Back',  category: 'identity' },
    ],
    passport:      [{ key: 'passport',      label: 'Passport',             category: 'identity' }],
    visa:          [{ key: 'uae_visa',      label: 'UAE Visa / Residency', category: 'identity' }],
    trade_license: [{ key: 'trade_license', label: 'Trade License',        category: 'license'  }],
  };
  const baseOf = (k: string): string | null => {
    const s = (k ?? '').toLowerCase();
    if (s.includes('emirates_id') || s.includes('eid')) return 'emirates_id';
    if (s.includes('passport')) return 'passport';
    if (s.includes('visa')) return 'visa';
    if (s.includes('trade_license') || s.includes('licen')) return 'trade_license';
    return null;
  };
  // Collect ALL docs per flagged KYC base — Emirates ID is two files (front + back),
  // so View must open both, not just one side. `freshestByBase` is the representative
  // used for the status/expiry line (prefer latest future expiry, else id).
  // `!!d.fileUrl` — a document REQUESTED through the upload link is a row with no
  // file yet. It must not stand in as the base's freshest copy, or the row would
  // read "Pending review" for a document nobody has sent.
  const kycDocs = (h.contract.documents ?? []).filter(d => !!d.fileUrl && baseOf(d.documentKey ?? ''));
  const docsByBase = new Map<string, ContractDoc[]>();
  const freshestByBase = new Map<string, ContractDoc>();
  for (const d of kycDocs) {
    const b = baseOf(d.documentKey ?? '')!;
    (docsByBase.get(b) ?? docsByBase.set(b, []).get(b)!).push(d);
    const prev = freshestByBase.get(b);
    if (!prev) { freshestByBase.set(b, d); continue; }
    const de = d.expiryDate ? Date.parse(d.expiryDate) : 0;
    const pe = prev.expiryDate ? Date.parse(prev.expiryDate) : 0;
    if (de > pe || (de === pe && d.id > prev.id)) freshestByBase.set(b, d);
  }
  // Only what this renewal still needs is listed for review: the papers flagged
  // expired or undated. A paper already approved and in date is not put in front
  // of the RP again with Approve / Reject on it (owner, 6 Oct 2026, lease 434 — a
  // second renewal of the same customer showed all five freshly approved papers
  // "to approve" again); those are summed up in one line below the list.
  const bases = Array.from(new Set(remaining));
  const alreadyValid = Array.from(freshestByBase.entries())
    .filter(([b, d]) => !remaining.includes(b) && !!d.expiryDate && Date.parse(d.expiryDate) >= Date.now())
    .map(([b, d]) => `${LABELS[b] ?? b} (to ${fmtDate(d.expiryDate)})`);
  const uploadSlots = bases.flatMap(b => UPLOAD_SLOTS[b] ?? [{ key: b, label: LABELS[b] ?? b, category: 'identity' }]);
  // The customer has pressed "Submit for review" on their side — their part is done,
  // so the footer must stop telling the RP to wait on them.
  const custSubmittedAt = h.contract.renewalDocsSubmittedAt ?? null;

  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState<Record<string, string>>({});
  const [savingBase, setSavingBase] = useState<string | null>(null);
  const allRefreshed = remaining.length === 0;

  const accept = async () => {
    setAccepting(true); setErr(null);
    try { await h.onAcceptDocs(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to accept'); }
    finally { setAccepting(false); }
  };

  // Record the expiry the RP read off the copy. A future date drops the base out of
  // `remaining` on reload; a past one keeps it flagged but flips the row to a truthful
  // "expired — awaiting a fresh copy". Either way, entering the real date resolves it.
  const saveExpiry = async (base: string, docId: number, fallback?: string) => {
    const date = expiryDraft[base] ?? fallback;
    if (!date) return;
    setSavingBase(base); setErr(null);
    try {
      await h.onApproveDocWithExpiry(docId, date);
      setExpiryDraft(d => { const n = { ...d }; delete n[base]; return n; });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save expiry'); }
    finally { setSavingBase(null); }
  };

  return (
    // minWidth:0 — grid items default to min-width:auto, which would let the widest doc row
    // stretch the whole step panel past the card instead of wrapping inside it.
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {/* Same View / Approve / Reject row pattern as the lead + new-lease KYC review. */}
      <div className="doclist" style={{ minWidth: 0 }}>
        {/* One row per SLOT, as the customer sees it: the Emirates ID is front and
            back, each with its own copy, View, expiry date and verdict. Every row
            with a copy takes a date — not only an undated one — so an expiry read
            off the paper can be corrected without a re-upload. */}
        {bases.flatMap(b => (UPLOAD_SLOTS[b] ?? [{ key: b, label: LABELS[b] ?? b, category: 'identity' }]).map(slot => {
          const side = slot.key.endsWith('_front') ? 'front' : slot.key.endsWith('_back') ? 'back' : null;
          const forSlot = (docsByBase.get(b) ?? []).filter(d => {
            if (!side) return true;
            const k = (d.documentKey ?? '').toLowerCase();
            // A combined scan (no side in the key) shows both sides.
            return k.includes(side) || (!k.includes('front') && !k.includes('back'));
          });
          const doc = forSlot.reduce<ContractDoc | undefined>((best, d) => {
            if (!best) return d;
            const de = d.expiryDate ? Date.parse(d.expiryDate) : 0, be = best.expiryDate ? Date.parse(best.expiryDate) : 0;
            return de > be || (de === be && d.id > best.id) ? d : best;
          }, undefined);
          const multi = forSlot.length > 1;
          const stillMissing = remaining.includes(b);
          const needsExpiry = undated.includes(b);
          const awaitingUpload = stillMissing && !needsExpiry;
          const lbl = slot.label;
          const ok = !!doc && ['processed', 'complete'].includes(doc.status ?? '');
          const rejected = !!doc && doc.status === 'rejected';
          const stt = stillMissing ? 'pending' : ok ? 'approved' : rejected ? 'rejected' : 'pending';
          const draftKey = slot.key;
          const draft = expiryDraft[draftKey] ?? (doc?.expiryDate ? doc.expiryDate.slice(0, 10) : '');
          const changed = !!doc && draft !== (doc.expiryDate ? doc.expiryDate.slice(0, 10) : '');
          return (
            <div key={slot.key} className={'docitem review ' + stt + (canEdit && doc && needsExpiry ? ' needsexp' : '')}>
              <FileText size={14} />
              <div style={{ minWidth: 0 }}>
                <div className="dn">{lbl}</div>
                <div className="ds" title={!doc ? undefined : doc.expiryDate ? `Expiry on file: ${fmtDate(doc.expiryDate)}` : 'No expiry on file'}>
                  {!doc ? 'Not on file'
                    : needsExpiry && !doc.expiryDate ? 'No expiry date on file — add it to verify this copy'
                    : rejected ? 'Rejected — awaiting a fresh copy'
                    : awaitingUpload ? (doc.expiryDate ? `Expired ${fmtDate(doc.expiryDate)} — awaiting a fresh copy` : 'Awaiting a fresh copy from the customer')
                    : ok ? (doc.expiryDate ? `Approved · expires ${fmtDate(doc.expiryDate)}` : 'Approved')
                    : doc.expiryDate ? `Pending review · expires ${fmtDate(doc.expiryDate)}` : 'Pending review'}
                </div>
              </div>
              <div className="dacts">
                {doc && (
                  <button type="button" className="mini-btn view cursor-pointer" onClick={() => openDocViewer(forSlot.map(d => ({ fileUrl: d.fileUrl, caption: d.displayName ?? lbl })), lbl)}>
                    <ExternalLink size={12} /> {multi ? `View ${forSlot.length}` : 'View'}
                  </button>
                )}
                {h.perms.deleteDocuments && doc && !multi && (
                  <DeleteDocumentButton docId={doc.id} label={lbl} onDeleted={h.onDocsChanged} />
                )}
                {/* Every copy: a date box, Approve and Reject — always. Approve
                    records the date in the box (changed or not) and verifies the
                    copy; the landlord may hold the renewed paper in hand even
                    when the customer has not sent a new scan. */}
                {canEdit && doc && (
                  <>
                    <input
                      type="date" className="dexp" aria-label={`${lbl} expiry date`}
                      value={draft}
                      onChange={e => setExpiryDraft(d => ({ ...d, [draftKey]: e.target.value }))}
                    />
                    {(!ok || changed) && (
                      <button
                        type="button" className="mini-btn ok cursor-pointer"
                        disabled={savingBase === draftKey || (changed && !draft)}
                        onClick={() => void (draft ? saveExpiry(draftKey, doc.id, draft) : h.onApproveDoc(doc.id))}
                      >
                        <Check size={12} /> {savingBase === draftKey ? 'Saving…' : changed ? 'Save date' : 'Approve'}
                      </button>
                    )}
                    {!rejected && (
                      <button type="button" className="mini-btn no cursor-pointer" onClick={() => h.onRejectDoc(doc.id, lbl)}><X size={12} /> Reject</button>
                    )}
                  </>
                )}
                {/* The chip only says what the status line already says; with
                    verdict buttons on the row it is just width. */}
                {awaitingUpload && !(canEdit && doc) && <span className="cstat bounced">Pending</span>}
              </div>
            </div>
          );
        }))}
      </div>
      {alreadyValid.length > 0 && (
        <p className="note" style={{ margin: 0 }}>Already valid, not asked again: {alreadyValid.join(', ')}.</p>
      )}
      {/* One upload link carrying exactly the documents still owed — the customer
          attaches them all without logging in, and without the RP re-typing the
          list into a request picker. Same control as the lead docs step. */}
      {canEdit && h.contract.tenant.id && bases.length > 0 && (
        <div style={{ paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #14201a)', marginBottom: 6 }}>
            Customer document upload link
          </div>
          {/* Every KYC document on this renewal, refreshed or not — the customer's
              page marks what is already on file and what is still expected. */}
          <DocsLinkButton
            tenantId={h.contract.tenant.id}
            contractId={h.contract.id}
            variant="inline"
            label={`Send upload link (${uploadSlots.length})`}
            presetDocs={uploadSlots.map(s => ({
              key: s.key, label: s.label, category: s.category,
            }))}
          />
        </div>
      )}
      {err && <p className="note" style={{ color: 'var(--brick)' }}>{err}</p>}
      {allRefreshed ? (
        canEdit && (
          <button type="button" className="btn btn-jade btn-block" disabled={accepting} onClick={() => void accept()}>
            <Check size={15} /> {accepting ? 'Accepting…' : 'Accept documents & unlock cheques'}
          </button>
        )
      ) : canEdit ? (
        // Something is still owed — the landlord decides. A customer who cannot
        // renew a paper yet has declared so on their side; the renewal must not
        // stall on it. Whatever is outstanding stays on the manager's lists.
        <div style={{ display: 'grid', gap: 8 }}>
          <p className="note" style={{ margin: 0 }}>
            Still outstanding: {[
              ...awaitingCustomer.map(b => `${LABELS[b] ?? b} (expired, awaiting a fresh copy)`),
              ...undated.map(b => `${LABELS[b] ?? b} (no expiry date recorded)`),
            ].join(', ')}.
            {custSubmittedAt ? ` ${h.contract.tenant.name || 'The customer'} submitted on ${fmtDate(custSubmittedAt)}.` : ''}
            {' '}You can accept now; what is outstanding stays on the manager&rsquo;s lists until a valid copy is on file.
          </p>
          <button type="button" className="btn btn-jade btn-block" disabled={accepting} onClick={() => void accept()}>
            <Check size={15} /> {accepting ? 'Accepting…' : 'Accept documents & unlock cheques'}
          </button>
        </div>
      ) : awaitingCustomer.length === 0 ? (
        // Every blocker is RP-side — don't tell them to wait on a customer who has nothing to send.
        <p className="note">
          {custSubmittedAt ? `${h.contract.tenant.name || 'The customer'} submitted their documents on ${fmtDate(custSubmittedAt)}. ` : ''}
          Add the missing expiry date{undated.length === 1 ? '' : 's'} above to unlock the cheques step.
        </p>
      ) : (
        <p className="note">
          Waiting for {h.contract.tenant.name || 'the customer'} to re-upload {awaitingCustomer.length === 1 ? 'a document' : `${awaitingCustomer.length} documents`}. You can accept once every copy is refreshed{undated.length ? ', including the expiry dates above' : ''}.
        </p>
      )}
    </div>
  );
}

export function stepContent(key: StepKey, st: DerivedState, h: StepHandlers, mode: 'new' | 'renewal'): StepContent {
  const TEN = h.contract.tenant.name || 'the customer';
  // Renewal branch is 4 steps (Terms agreed → Signatures → Contract Registration
  // renewal → Active); the new-lease pipeline stays 6.
  const totalSteps = mode === 'renewal' ? 4 : 6;
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n} of ${totalSteps}` : `Stop ${n} of ${totalSteps}`;

  // Once a contract is active/terminated/expired, the activation steps
  // are frozen: no Re-upload, no undo toggles, no "Revert to draft".
  // Only the read-only "complete" panel shows.
  const lock = h.readOnlyWorkflow;

  if (key === 'issue') {
    const done = isDone('issue', st);
    return done
      ? {
          tone: 'celebrate', icon: 'document', sub: 'Stop 1 · complete', label: 'Issued',
          headline: 'Contract issued.',
          body: `Sent to ${TEN} — the signing process is underway.`,
          timing: null,
          node: (
            <Completed
              title="Issued to customer"
              sub="Signing in progress"
              onUndo={lock ? undefined : h.onRevertToDraft}
              undoLabel="Revert to draft"
            />
          ),
        }
      : {
          tone: 'action', icon: 'document', sub: stopOf(1), label: 'Draft',
          headline: 'Issue this contract.',
          body: `Review the terms below, then send it to ${TEN} to begin signing.`,
          timing: null,
          node: (
            <button className="btn btn-jade btn-lg btn-block" onClick={() => h.onIssue()}>
              <FileSignature size={15} /> Issue contract to {TEN}
            </button>
          ),
        };
  }

  if (key === 'documents') {
    // Renewal-only KYC re-verification step — the customer re-uploads expired /
    // undated KYC docs (EID / passport / visa / trade licence); the RP reviews and
    // ACCEPTS them before cheques unlock, matching the Operations renewal kanban.
    const done = isDone('documents', st);
    if (done && !st.renewalDocsRequired) {
      // No re-verification was ever needed for this renewal — nothing to show.
      return {
        tone: 'celebrate', icon: 'document', sub: 'Renewal · Stop 2 · complete', label: 'Documents current',
        headline: 'KYC documents are current.',
        body: 'No document refresh was needed for this renewal.',
        timing: null,
        node: (
          <div className="chklist">
            <ChkRow on locked label="KYC documents up to date" onToggle={() => {}} />
          </div>
        ),
      };
    }
    return done
      ? {
          tone: 'celebrate', icon: 'document', sub: 'Renewal · Stop 2 · complete', label: 'Documents accepted',
          headline: 'Refreshed documents accepted.',
          body: `You reviewed and accepted ${TEN}'s refreshed KYC documents — the renewal can proceed to cheques.`,
          timing: null,
          node: (
            <div className="chklist">
              <ChkRow on locked label="Refreshed KYC documents accepted" onToggle={() => {}} />
            </div>
          ),
        }
      : {
          tone: 'action', icon: 'document', sub: stopOf(2), label: 'Documents',
          headline: 'Review the refreshed documents.',
          body: `${TEN} is re-uploading KYC documents that expired since the last lease. Review each one below, then accept to unlock the cheques step.`,
          timing: null,
          node: <RenewalDocReview h={h} />,
        };
  }

  if (key === 'cheques') {
    // Renewal-only Cheques/PDC step — collect + confirm the post-dated cheques
    // BEFORE signatures, matching the Operations renewal kanban.
    const done = isDone('cheques', st);
    return done
      ? {
          tone: 'celebrate', icon: 'wallet', sub: 'Renewal · Stop 3 · complete', label: 'Cheques collected',
          headline: 'Renewal cheques collected.',
          body: 'The post-dated cheques are confirmed — the renewal is ready for signature.',
          timing: null,
          node: (
            <div className="chklist">
              <ChkRow on locked label="Post-dated cheques confirmed" onToggle={() => {}} />
            </div>
          ),
        }
      : {
          tone: 'action', icon: 'wallet', sub: stopOf(3), label: 'Cheques / PDC',
          headline: 'Collect the renewal cheques.',
          body: `${TEN} uploads their post-dated cheques against the schedule; record each one's number, method and status, view their upload, then mark them collected to unlock signing.`,
          timing: null,
          node: <RenewalChequeCollect h={h} />,
        };
  }

  if (key === 'sign') {
    const done = isDone('sign', st);
    return done
      ? st.sigsOnFile
        ? {
            tone: 'celebrate', icon: 'pen', sub: 'Stop 2 · complete', label: 'Signed — on file',
            headline: 'Signed on paper — on file.',
            body: 'This lease was signed physically before it was imported. Digital signature fields are not applicable.',
            timing: null,
            node: (
              <>
                <div className="chklist">
                  <ChkRow on locked label={`${TEN} signed (on file)`} onToggle={() => {}} />
                  <ChkRow on locked label="Landlord signed (on file)" onToggle={() => {}} />
                </div>
                <SignatureAuditTrail contractId={h.contract.id} />
              </>
            ),
          }
        : {
          tone: 'celebrate', icon: 'pen', sub: 'Stop 2 · complete', label: 'Signed',
          headline: 'Both parties have signed.',
          body: 'Customer and landlord signatures are on file.',
          timing: null,
          node: (
            <>
              <div className="chklist">
                <ChkRow on locked={lock} label={`${TEN} signed`} onToggle={() => h.setState({ tenantSigned: false })} />
                <ChkRow on locked={lock} label="Landlord signed" onToggle={() => h.setState({ landlordSigned: false })} />
              </div>
              <SignatureAuditTrail contractId={h.contract.id} />
            </>
          ),
        }
      : {
          tone: 'action', icon: 'pen', sub: stopOf(2), label: 'Signatures',
          headline: 'Capture both signatures.',
          body: `${TEN} signs from their portal and you countersign here — or, for a paper-signed / imported lease, mark both as already on file.`,
          timing: 'Takes ~2 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow
                  on={st.tenantSigned}
                  label={`${TEN} signed`}
                  hint={st.tenantSigned ? undefined : 'awaiting customer'}
                  onToggle={() => h.setState({ tenantSigned: !st.tenantSigned })}
                />
                <ChkRow
                  on={st.landlordSigned}
                  label="Landlord signed (you)"
                  onToggle={() => h.setState({ landlordSigned: !st.landlordSigned })}
                  actionLabel={h.perms.signLandlord ? 'Sign now' : undefined}
                  onAction={h.perms.signLandlord ? () => h.openModal('sign') : undefined}
                />
              </div>
              {h.perms.signLandlord && (
                <button
                  className="ca"
                  style={{ justifySelf: 'start', marginTop: 4, padding: 0 }}
                  onClick={() => h.onMarkSignedOnFile()}
                >
                  Mark as signed on file (paper / imported)
                </button>
              )}
              <SignatureAuditTrail contractId={h.contract.id} />
            </>
          ),
        };
  }

  if (key === 'ejari') {
    const done = isDone('ejari', st);
    // The uploaded certificate — base key first, then any extra slots (ejari_certificate_2…).
    const ejariDoc = (h.contract.documents ?? []).find(d => d.documentKey === 'ejari_certificate')
      ?? (h.contract.documents ?? []).find(d => d.documentKey.startsWith('ejari'));
    return done
      ? {
          tone: 'celebrate', icon: 'stamp', sub: 'Stop 3 · complete', label: 'Contract Registration',
          headline: mode === 'renewal' ? 'Contract Registration renewed.' : 'Contract Registration completed.',
          body: 'Certificate is on file with the Dubai Land Department.',
          timing: null,
          node: <Completed title="Registered with DLD" sub={ejariDoc?.displayName ?? 'Contract-Registration-Certificate.pdf'} viewUrl={ejariDoc?.fileUrl} viewLabel="View Contract Registration" />,
        }
      : {
          tone: 'action', icon: 'stamp', sub: stopOf(3), label: 'Contract Registration',
          headline: 'Register the Contract Registration Certificate with the DLD.',
          // One action: upload → register → activate (skipped when already active).
          body: h.contract.status === 'active'
            ? 'Upload the certificate — it is recorded and the contract registered in one step.'
            : 'Upload the certificate — it is recorded, the contract registered and the tenancy activated in one step.',
          timing: '2–5 business days',
          node: <UploadAction fileLabel="Contract-Registration-Certificate.pdf" onUpload={h.onUploadEjari}
            uploadLabel={h.contract.status === 'active' ? 'Upload & register' : 'Upload & activate'} />,
        };
  }

  if (key === 'utility') {
    const done = isDone('utility', st);
    // Move-in utility activation proof. The RP now writes the SAME shared doc the
    // customer reads (`utility_proof_of_payment`), so prefer that — it guarantees
    // both sides show the same file. Fall back to the newest legacy RP-uploaded
    // copy ("utility_registration_*" / "utility_<ts>") for older contracts.
    // Clearance / final-bill are move-out docs and must NOT count here.
    const utilDocs = (h.contract.documents || []).filter(d =>
      d.documentKey === 'utility_proof_of_payment' ||
      d.documentKey === 'utility' ||
      /^utility_\d/.test(d.documentKey) ||
      /^utility_registration(_|$)/.test(d.documentKey));
    const proof = utilDocs.find(d => d.documentKey === 'utility_proof_of_payment')
      ?? utilDocs.reduce<ContractDoc | undefined>((best, d) => (!best || (d.id ?? 0) > (best.id ?? 0) ? d : best), undefined);
    const acc = h.contract.utilityAccountNumber;
    const accSub = acc ? `Utility account ${acc}` : 'Utility activation proof on file';
    // A customer submission awaiting RP review only while status is `submitted`.
    // After a reject the status drops back to `not_submitted` (awaiting the
    // customer's fresh upload), so we don't re-open the review over a stale proof.
    const awaitingReview = h.contract.utilityStatus === 'submitted' && !!proof;
    return done
      ? {
          tone: 'celebrate', icon: 'bolt', sub: 'Stop 4 · complete', label: 'Utility',
          headline: 'Utility account confirmed.',
          body: proof ? `${TEN}'s utility proof is on file.` : 'Utility activation proof is on file.',
          timing: null,
          node: <Completed title="Utility account confirmed" sub={accSub} onView={proof?.fileUrl ? () => openDocViewer({ fileUrl: proof.fileUrl, caption: proof.displayName ?? 'Utility proof' }) : undefined} viewLabel="View bill" />,
        }
      : {
          tone: 'action', icon: 'bolt', sub: stopOf(4), label: 'Utility',
          headline: awaitingReview ? `${TEN} uploaded the utility proof.` : 'Attach the utility activation.',
          body: awaitingReview
            ? 'Review the proof the customer uploaded, then confirm the utility account to advance — or reject it to send it back for a new upload.'
            : `Add the utility proof, let ${TEN} upload it, or mark it on file for imported leases.`,
          timing: awaitingReview ? null : 'Takes ~1 min',
          node: awaitingReview
            ? <UtilityReview proof={proof} accountNumber={acc} onConfirm={() => h.onVerifyUtility()} onReject={() => h.onRejectUtility()} onUpload={h.onUploadUtility} lock={lock} />
            : <UploadAction fileLabel="Utility-activation.pdf" onUpload={h.onUploadUtility} onMark={() => h.onMarkUtility()} />,
        };
  }

  if (key === 'movein') {
    const done = isDone('movein', st);
    // Completed via the uploaded move-in document (backlog escape hatch) rather
    // than a full counter-signed inspection — show the doc instead of the
    // "counter-signed" panel so the UI never claims a signature that isn't there.
    const moveInReport = (h.contract.documents ?? []).find(d =>
      /^move_?in/i.test(d.documentKey || '') || /move-?in/i.test(d.displayName || ''));
    const doneByDoc = done && !st.moveIn.rpCounterSig;
    return done
      ? {
          tone: 'celebrate', icon: 'key', sub: 'Stop 5 · complete', label: 'Move-in',
          headline: 'Move-in complete.',
          body: doneByDoc
            ? 'Move-in document is on file — keys handed over.'
            : 'Inspection signed by both parties — keys handed over.',
          timing: null,
          node: doneByDoc
            ? <Completed title="Move-in document on file" sub={moveInReport?.displayName ?? 'Move-in-report.pdf'} onView={moveInReport?.fileUrl ? () => openDocViewer({ fileUrl: moveInReport.fileUrl, caption: moveInReport.displayName ?? 'Move-in report' }) : undefined} viewLabel="View document" />
            : <Completed title="Inspection counter-signed" sub="Keys handed to customer" />,
        }
      : {
          tone: 'action', icon: 'key', sub: stopOf(5), label: 'Move-in',
          headline: 'Complete the move-in inspection.',
          body: 'Walk the unit, collect signatures and sign. Open the inspection page to act.',
          timing: 'Takes ~2 min',
          node: (
            <>
              {/* `locked`: these three are a read-out of the inspection's real
                  signature state, not switches. Their Undo buttons were wired to
                  a no-op toggle — clicking one did nothing at all, and a
                  submission or a customer's signature is not undoable from here
                  anyway. Progress is driven from the inspection workspace. */}
              <div className="chklist">
                <ChkRow locked on={st.moveIn.rpSubmitted} label="Inspection submitted" onToggle={() => {}} />
                <ChkRow locked on={st.moveIn.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow locked on={st.moveIn.rpCounterSig} label="Manager / Landlord Sign" onToggle={() => {}} />
              </div>
              <Link href={h.inspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open inspection workspace
              </Link>
            </>
          ),
        };
  }

  if (key === 'moveout') {
    const done = isDone('moveout', st);
    const eff = h.contract.termination?.effectiveDate;
    return done
      ? {
          tone: 'celebrate', icon: 'key', sub: 'Move-out · complete', label: 'Move-out',
          headline: 'Move-out inspection complete.',
          body: 'Both parties signed the move-out condition report. Proceed to the deposit settlement.',
          timing: null,
          node: <Completed title="Move-out inspection counter-signed" sub="Ready for final settlement" viewUrl={h.moveOutInspectionUrl} viewLabel="View inspection" />,
        }
      : {
          tone: 'action', icon: 'key', sub: 'Wind-down', label: 'Move-out',
          headline: 'Complete the move-out inspection.',
          body: `Walk the unit against the move-in report${eff ? ` before ${fmtDate(eff)}` : ''}, record the move-out condition, collect the customer signature and counter-sign.`,
          timing: 'Takes ~3 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow locked on={st.moveOut.rpSubmitted} label="Move-out inspection submitted" onToggle={() => {}} />
                <ChkRow locked on={st.moveOut.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow locked on={st.moveOut.rpCounterSig} label="Manager / Landlord Sign" onToggle={() => {}} />
              </div>
              <Link href={h.moveOutInspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open move-out inspection
              </Link>
              <p className="note" style={{ marginTop: 8 }}>
                Lease is outdated? Upload the move-out document instead of a full inspection.
              </p>
              <button className="btn btn-ghost btn-block" onClick={h.onUploadMoveOutDoc}>
                <UploadCloud size={14} /> Upload move-out document instead
              </button>
            </>
          ),
        };
  }

  if (key === 'closeout') {
    const docs = h.contract.documents || [];
    const clearanceDoc = docs.find(d => (d.documentKey || '').startsWith('utility_clearance') || /clearance/i.test(d.displayName || ''));
    const finalBillDoc = docs.find(d => (d.documentKey || '').startsWith('utility_final_bill') || /final.?bill/i.test(d.displayName || ''));
    const both = st.closeout.clearance && st.closeout.finalBill;
    return {
      tone: both ? 'celebrate' : 'action', icon: 'bolt', sub: 'Wind-down', label: 'Closeout',
      headline: both ? 'Utility closeout complete.' : 'Close out the utility account.',
      body: both
        ? 'Utility clearance and final bill are on file. Proceed to the deposit settlement to close the lease.'
        : 'Attach the utility clearance and final bill from the provider. This step is optional — you can proceed to settlement.',
      timing: null,
      node: (
        <>
          <div className="chklist">
            <div className={'chkrow ' + (st.closeout.clearance ? 'on' : '')}>
              <span className="cb">{st.closeout.clearance ? <Check size={12} /> : null}</span>
              <span className="ct">Utility clearance</span>
              {clearanceDoc
                ? <button type="button" onClick={() => openDocViewer({ fileUrl: clearanceDoc.fileUrl, caption: clearanceDoc.displayName ?? 'Utility clearance' })} className="ca cursor-pointer"><ExternalLink size={12} /> View</button>
                : <button className="ca" onClick={h.onUploadCloseoutClearance}>Upload</button>}
            </div>
            <div className={'chkrow ' + (st.closeout.finalBill ? 'on' : '')}>
              <span className="cb">{st.closeout.finalBill ? <Check size={12} /> : null}</span>
              <span className="ct">Utility final bill</span>
              {finalBillDoc
                ? <button type="button" onClick={() => openDocViewer({ fileUrl: finalBillDoc.fileUrl, caption: finalBillDoc.displayName ?? 'Utility final bill' })} className="ca cursor-pointer"><ExternalLink size={12} /> View</button>
                : <button className="ca" onClick={h.onUploadCloseoutFinalBill}>Upload</button>}
            </div>
          </div>
          <p className="note" style={{ marginTop: 8 }}>Optional — you can proceed to settlement.</p>
          {h.perms.settleDeposits && (
            <Link href={h.settlementUrl} className="btn btn-jade btn-block">
              <Wallet size={14} /> Proceed to settlement
            </Link>
          )}
        </>
      ),
    };
  }

  if (key === 'settlement') {
    const ss = st.settlementStatus;
    if (ss === 'paid') {
      return {
        tone: 'celebrate', icon: 'wallet', sub: 'Settlement · complete', label: 'Settlement',
        headline: 'Deposit settled.',
        body: 'The deposit refund has been reconciled and marked paid. This tenancy is fully closed out.',
        timing: null,
        node: <Completed title="Deposit refund paid" sub="Settlement closed" viewUrl={h.settlementUrl} viewLabel="View settlement" />,
      };
    }
    const statusLine =
      ss === 'agreed' ? `${TEN} agreed — pay the refund and mark it paid.`
      : ss === 'sent' ? `Sent to ${TEN} — awaiting their agreement.`
      : 'Reconcile the deposit: deductions, dues, and the net refund.';
    return {
      tone: 'action', icon: 'wallet', sub: 'Wind-down', label: 'Settlement',
      headline: 'Settle the security deposit.',
      body: statusLine,
      timing: null,
      node: (
        <>
          <div className="chklist">
            {/* "Sent" can be undone (pull back to draft) until the customer
               agrees; once agreed the figures are committed, so it locks.
               This is live wind-down management (like recording a payment), so
               it is NOT gated by readOnlyWorkflow — the lease stays active
               through settlement, which would otherwise lock it permanently.
               A manager without the settle-deposits permission sees it
               locked (read-only). */}
            <ChkRow on={ss === 'sent' || ss === 'agreed'} label="Settlement sent to customer"
              onToggle={h.onUnsendSettlement} locked={ss === 'agreed' || !h.perms.settleDeposits} />
            {/* The customer's agreement and the payout are not the RP's to undo here. */}
            <ChkRow on={ss === 'agreed'} label={`${TEN} agreed`} onToggle={() => {}} locked />
            <ChkRow on={false} label="Refund marked paid" onToggle={() => {}} locked />
          </div>
          {h.perms.settleDeposits && (
            <Link href={h.settlementUrl} className="btn btn-jade btn-block">
              <Wallet size={14} /> Open settlement workspace
            </Link>
          )}
        </>
      ),
    };
  }

  if (key === 'terms') {
    // Renewal step 1 of 4. The offer itself (below, unchanged) plus the former
    // Documents and Cheques / PDC steps folded in as sub-sections — same bodies,
    // same actions — so nothing that used to be reachable is lost. The step is
    // done only when all three are (isDone('terms')).
    const offer = termsOffer();
    const docsDone = isDone('documents', st);
    const chequesDone = isDone('cheques', st);
    const docs = stepContent('documents', st, h, mode);
    const cheques = stepContent('cheques', st, h, mode);
    const offerAgreed = offer.tone === 'celebrate';
    const head: Pick<StepContent, 'tone' | 'label' | 'headline' | 'body' | 'timing'> = !offerAgreed
      ? offer
      : !docsDone
        ? { tone: 'action', label: 'Renewal documents', headline: docs.headline,
            body: `${TEN} accepted the new terms. ${TEN} is re-uploading KYC documents that expired since the last lease — review each one under Renewal documents, then accept them. The cheques must also be collected before signing.`,
            timing: null }
        : !chequesDone
          ? { tone: 'action', label: 'Cheques / PDC', headline: cheques.headline,
              body: `${TEN} accepted the new terms. Record each post-dated cheque under Cheques & PDC — number, method and status, view their upload — then mark them collected to unlock signing.`,
              timing: null }
          : offer;
    return {
      ...head,
      icon: 'envelope',
      sub: isDone('terms', st) ? 'Renewal · Stop 1 · complete' : stopOf(1),
      node: (
        <>
          {offer.node}
          <TermsSubSection n="1a" title="Renewal documents" done={docsDone}>{docs.node}</TermsSubSection>
          <TermsSubSection n="1b" title="Cheques & PDC" done={chequesDone}>{cheques.node}</TermsSubSection>
        </>
      ),
    };
  }

  function termsOffer(): StepContent {
    // The 'terms' step reflects the REAL offer state — it is NOT agreed the moment
    // the RP sends it. renewalAccepted: 'accepted' → locked in; 'pending' → sent &
    // awaiting the customer; null/'draft' → not yet sent. In the two not-yet-agreed
    // states the RP sees the FULL proposed terms (the exact schedule + rent/fees/
    // discount the customer received), reusing the same PaymentPlanCard rendering as
    // the "Payment Plan" binder — plus a link to preview the full renewal contract.
    const ra = h.contract.renewalAccepted;
    // A live lease (already active/issued) or an accepted proposal → terms agreed.
    // Only a still-'pending' proposal that hasn't been accepted shows the
    // "sent/draft, awaiting" state below (status guards against the overloaded
    // renewalAccepted on an active lease that has its OWN renewal in flight).
    const isPendingProposal = h.contract.status === 'pending';
    if (!isPendingProposal || ra === 'accepted') {
      return {
        tone: 'celebrate', icon: 'envelope', sub: 'Renewal · step 1', label: 'Terms agreed',
        headline: 'Renewal terms agreed.',
        body: `${TEN} accepted the new annual rent of ${fmtAed(h.contract.annualRent)}.`,
        timing: null,
        node: <Completed title="Customer accepted the terms" sub="Renewal locked in" />,
      };
    }
    const sent = ra === 'pending';
    const proposedPlan = buildCurrentPlan(h.contract, h.contract.payments ?? []);
    return {
      tone: sent ? 'waiting' : 'action', icon: 'envelope', sub: 'Renewal · step 1', label: 'Terms',
      headline: sent ? `Renewal sent — awaiting ${TEN}.` : 'Renewal draft — not yet sent.',
      body: sent
        ? `These are the exact terms ${TEN} received. They haven't accepted yet.`
        : `Review the proposed terms below, then send them to ${TEN} from the Active step.`,
      timing: sent ? `Awaiting ${TEN}'s decision` : null,
      node: (
        <>
          <PaymentPlanCard
            plan={proposedPlan}
            rows={segRowsFromContract(h.contract, h.contract.payments ?? [])}
            refLabel={h.contract.ref}
            contractType={h.contract.contractType}
            tenantName={h.contract.tenant.companyName || h.contract.tenant.name}
            landlordName={h.contract.landlord.bankAccountName || h.contract.landlord.companyName || h.contract.landlord.name}
            unitNumber={h.contract.unit.number}
            buildingName={h.contract.property.buildingName}
            community={h.contract.property.community || h.contract.property.emirate}
            periodStart={h.contract.startDate}
            periodEnd={h.contract.endDate}
            bankDetails={h.contract.landlord.bankDetails}
          />
          <Link href={h.printUrl} target="_blank" className="btn btn-ghost btn-block" style={{ marginTop: 12 }}>
            <Eye size={14} /> Preview full renewal contract
          </Link>
        </>
      ),
    };
  }

  // active
  if (h.contract.termination && h.contract.termination.response === 'pending' && h.contract.termination.requestedByRole === 'tenant') {
    return {
      tone: 'action', icon: 'alert', sub: 'Response required', label: 'Termination requested',
      headline: `${TEN} wants to end the lease early.`,
      body: 'Review the reason and effective date, then accept or reject.',
      timing: 'Awaiting your response',
      node: (
        <>
          <div className="qbanner action">
            <span className="bic"><AlertCircle size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
              <p className="bp">Requested {fmtDate(h.contract.termination.requestedAt)}</p>
              {h.contract.termination.reasonCode && <p className="bp">Reason: {moveOutReasonLabel(h.contract.termination.reasonCode)}</p>}
              {h.contract.termination.reason && <div className="quote">&ldquo;{h.contract.termination.reason}&rdquo;</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-brick" data-action="accept-termination"><Check size={14} /> Accept termination</button>
            <button className="btn btn-ghost" data-action="reject-termination"><X size={14} /> Reject</button>
          </div>
        </>
      ),
    };
  }
  if (h.contract.termination && h.contract.termination.response === 'pending' && h.contract.termination.requestedByRole === 'rental_provider') {
    return {
      tone: 'waiting', icon: 'clock', sub: 'Awaiting customer', label: 'Termination sent',
      headline: 'Termination request sent.',
      body: `The lease stays active until ${TEN} accepts.`,
      timing: 'Awaiting customer response',
      node: (
        <div className="qbanner waiting">
          <span className="bic"><Clock size={18} /></span>
          <div style={{ flex: 1 }}>
            <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
            {h.contract.termination.reasonCode && <p className="bp">Reason: {moveOutReasonLabel(h.contract.termination.reasonCode)}</p>}
            {h.contract.termination.reason && <div className="quote">&ldquo;{h.contract.termination.reason}&rdquo;</div>}
          </div>
        </div>
      ),
    };
  }
  if (
    h.contract.termination && h.contract.termination.response === 'accepted'
    && (h.contract.status === 'active'
        || (h.contract.status === 'expired' && h.contract.termination.method === 'direct'))
  ) {
    const isDirect = h.contract.termination.method === 'direct';
    return {
      tone: 'waiting', icon: 'clock', sub: 'Winding down', label: 'Terminating',
      headline: isDirect ? 'Direct close-out in progress.' : 'Move-out scheduled.',
      body: isDirect
        ? 'Complete the move-out, utility closeout, then mark the settlement paid to close this lease.'
        : `The tenancy stays active until ${fmtDate(h.contract.termination.effectiveDate)}, then auto-terminates.`,
      timing: isDirect ? null : 'Until effective date',
      node: (
        <>
          <div className="qbanner waiting">
            <span className="bic"><Clock size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
              <p className="bp">
                {isDirect
                  ? 'Direct termination — the lease stays active until you mark the settlement paid.'
                  : 'Both parties have agreed. Complete the move-out inspection, then settle the security deposit.'}
              </p>
              {h.contract.termination.reasonCode && <p className="bp">Reason: {moveOutReasonLabel(h.contract.termination.reasonCode)}</p>}
            </div>
          </div>
          <Link href={h.moveOutInspectionUrl} className="btn btn-jade btn-block">
            <ClipboardCheck size={14} /> {st.moveOut.rpCounterSig ? 'View move-out inspection' : 'Open move-out inspection'}
          </Link>
          {h.perms.agreements && (
            <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => void h.onCancelTermination()}>
              <RotateCcw size={14} /> Cancel termination — keep lease active
            </button>
          )}
        </>
      ),
    };
  }

  // Terminated — closed-out terminal record (direct or mutual).
  if (h.contract.status === 'terminated') {
    const isDirect = h.contract.termination?.method === 'direct';
    return {
      tone: 'celebrate', icon: 'active', sub: 'Lease ended', label: 'Terminated',
      headline: 'Lease terminated.',
      body: isDirect
        ? 'This lease was closed out via a direct termination.'
        : 'This lease has been terminated.',
      timing: null,
      node: (
        <div className="stats">
          <div className="stat">
            <div className="sl">Deposit held</div>
            <div className="sv jade">{fmtAed(h.contract.securityDepositHeld ?? h.contract.securityDepositAmount)}</div>
          </div>
        </div>
      ),
    };
  }

  // Expired (natural end) with no close-out yet — for outdated leases where the
  // customer already vacated, offer a direct termination + wind-down right here
  // instead of the misleading "Activate" override.
  if (h.contract.status === 'expired') {
    return {
      tone: 'action', icon: 'active', sub: 'Lease expired', label: 'Expired',
      headline: 'This lease has expired.',
      body: 'The term has ended. If the customer has already vacated, terminate it directly to record the move-out, utility closeout and final settlement.',
      timing: null,
      node: (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {h.perms.agreements && (
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
              onClick={() => h.openModal('direct-terminate')}
            >
              <X size={14} /> Terminate directly
            </button>
          )}
        </div>
      ),
    };
  }

  if (isDone('active', st)) {
    return {
      tone: 'celebrate', icon: 'active', sub: mode === 'renewal' ? 'Renewal · live' : 'Stop 6 · live',
      label: mode === 'renewal' ? 'Renewal active' : 'Active tenancy',
      headline: mode === 'renewal' ? 'The renewal is live.' : 'This tenancy is live.',
      body: 'Manage payments, propose a renewal, or end the tenancy at any time.',
      timing: null,
      node: (
        <>
          {/* Rent · term · deposit · collected · next payment all read off the
              segregated summary below (and the page header), so the tiles that
              used to sit here only repeated them. The DISCOUNT is the one figure
              the plan does not carry, so it stays — as a single line. */}
          {(h.contract.discountAmount ?? 0) > 0 && (
            <div className="flag" style={{ justifySelf: 'flex-start', background: '#fdf1f1', borderColor: '#f3c9c9', color: '#b91c1c' }}>
              Discount applied
              {h.contract.listedRent != null && (
                <>
                  {' · '}
                  <span style={{ textDecoration: 'line-through', opacity: 0.75 }}>{fmtAed(h.contract.listedRent)}</span>
                  {' → '}
                  <strong>{fmtAed(h.contract.annualRent)}</strong>
                </>
              )}
              {' · '}− {fmtAed(h.contract.discountAmount!)}
            </div>
          )}
          {/* Only the PARENT lease (which owns the proposal) has a renewalChild.
              The child proposal itself sees a mirrored renewalAccepted='pending'
              (from getContractById) but renewalChild=null — gate on renewalChild
              so the banner never self-references on the proposal row. */}
          {h.contract.renewalAccepted === 'pending' && h.contract.renewalChild && (
            <div className="flag waiting" style={{ justifySelf: 'flex-start' }}>
              <RotateCcw size={13} /> Renewal proposed — awaiting {TEN}
              {' · '}
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                View proposal · CID-{h.contract.renewalChild.id}
              </Link>
            </div>
          )}
          {/* Was the notice actually EMAILED — from the delivery record kept on
              every send. Production runs with most email off. */}
          {h.contract.renewalAccepted === 'pending' && h.contract.renewalChild && (
            <RenewalNoticeDelivery
              parentContractId={h.contract.id}
              refreshAfter={h.noticeSentAt ?? undefined}
              onResend={h.perms.renewals ? () => void h.onRenewalDraft('send') : undefined}
            />
          )}
          {/* Renewal DRAFT — saved for RP review; the customer has NOT been
              notified yet (gated on renewalAccepted='pending'). RP reviews then
              sends or discards. */}
          {h.contract.renewalStatus === 'draft' && h.contract.renewalAccepted !== 'pending' && h.contract.renewalChild && (
            <div className="flag" style={{ justifySelf: 'flex-start', background: '#fdf7ea', borderColor: '#e7d8a8', color: '#8a6d1f' }}>
              <RotateCcw size={13} /> Renewal draft ready — not yet sent to {TEN}
              {' · '}
              <Link href={`${h.operationsBase}/${h.contract.renewalChild.id}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                Review draft · CID-{h.contract.renewalChild.id}
              </Link>
            </div>
          )}
          {/* Customer accepted — the renewal now lives in its own contract.
              Without this block the renewal VANISHED from the parent page the
              moment it was accepted/issued. */}
          {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
            <div className="flag" style={{ justifySelf: 'flex-start', background: 'var(--jade-soft, #e7f5ef)', borderColor: 'var(--jade, #047246)', color: 'var(--jade-deep, #1a7a5a)' }}>
              <RotateCcw size={13} /> Renewal agreed — {fmtDate(h.contract.renewalChild.startDate ?? null)} → {fmtDate(h.contract.renewalChild.endDate ?? null)}
              {h.contract.renewalChild.annualRent ? <> @ {fmtAed(h.contract.renewalChild.annualRent)}</> : null}
            </div>
          )}
          {/* Payment summary — the SAME segregated view the Payment Plan document
              renders (Security Deposit · Rental Income · Management Fee · Third
              Party, each with its lines and total), built from the one canonical
              grouping in segregatedPlan.ts rather than a second look-alike table.
              It replaces the Record payment / Propose renewal / Terminate directly
              buttons that used to sit here: all three already exist on this page,
              so repeating them added noise instead of information. */}
          <SegregatedPlanView
            plan={buildSegregatedPlan(segRowsFromContract(h.contract, h.contract.payments ?? []))}
            style={{ padding: 0 }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} className="btn btn-jade">
                <RotateCcw size={14} /> Open renewal contract · CID-{h.contract.renewalChild.id}
              </Link>
            )}
            {/* Draft review action — send the reviewed draft to the customer. */}
            {h.contract.renewalStatus === 'draft' && h.contract.renewalAccepted !== 'pending' && h.perms.renewals && (
              <button className="btn btn-jade" onClick={() => void h.onRenewalDraft('send')}>
                <RotateCcw size={14} /> Send to {TEN}
              </button>
            )}
          </div>
        </>
      ),
    };
  }

  // not yet active — manual activation override
  const stepsAll = mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  const missing = stepsAll.filter(s => s.key !== 'active' && !isDone(s.key, st)).map(s => s.label);
  return {
    tone: 'action', icon: 'active', sub: mode === 'renewal' ? 'Renewal · activate' : `Stop 6 of 6`, label: 'Activate',
    headline: 'Activate the tenancy.',
    body: 'Go live now and backfill any records later, or finish the open steps first — your call.',
    timing: null,
    node: (
      <>
        {missing.length > 0 && (
          <div className="qbanner waiting">
            <span className="bic"><AlertCircle size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Still open</p>
              <p className="bp">{missing.join(' · ')}. You can activate anyway and complete these afterwards.</p>
            </div>
          </div>
        )}
      </>
    ),
  };
}
