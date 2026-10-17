'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — behaviour unchanged. */
import { useState, useEffect, useRef, useMemo, Fragment, Children, isValidElement } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { REQUESTABLE_DOCS, groupRequestNames } from '@/lib/requestableDocs';
import { SECTION_LABEL, SECTION_ORDER, acceptedNamesFor, normDocName, sectionForCategory, sectionForDocKey, type DocSection } from '@/lib/documentCatalogue';
import { getRequiredDocs, getRenewalRequiredDocs, CONTRACT_DOCS, type DocReq } from '@/lib/docRequirements';
import { FileText, Stamp, BadgeCheck, ChevronDown, Building2, CreditCard, Paperclip, ClipboardList, X, Check, StickyNote, UploadCloud, Download, ExternalLink, Pencil, Send, Plus, Link2 } from 'lucide-react';
import { DirhamSign } from '@/components/ui/DirhamSign';
import { CustomerDocsModal } from '@/components/upnow/CustomerDocsModal';
import { DownloadDocButton } from '@/components/upnow/DownloadDocButton';
import { openDocsTogether } from '@/lib/openDocsTogether';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import { segRowsFromContract } from '@/lib/segregatedPlan';
import { isTaxLabel } from '@/lib/chargeTax';
import { AmountWithVat } from '@/components/upnow/VatChoice';
import { splitVat, vatFormFromStored, type VatMode } from '@/lib/vatSplit';
import { isRentVatable } from '@/lib/unitTaxonomy';
import { chequeStatusDisplay } from '@/lib/chequeStatusDisplay';
import { groupReplacementsUnderBounce, MAX_REPLACEMENT_DEPTH } from '@/lib/chequeReplacementGroups';
import { EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { openDocViewer } from '@/lib/docViewer';
import { ReturnChequeDialog, RETURN_REASON_WORD } from '@/components/upnow/ReturnChequeDialog';
import { uploadLeaseDocument } from '@/lib/leaseDocumentUpload';
import { DeleteDocumentButton } from '@/components/upnow/DeleteDocumentButton';
import { docLabel } from '@/lib/docLabel';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';
import { BreachesSection } from '@/components/legal/BreachesSection';
import { EmailsCard } from '@/components/email/EmailsCard';
import { WhatsAppCard } from '@/components/whatsapp/WhatsAppCard';
import { landlordLinkShows, landlordLinkShowsByDefault } from '@/lib/landlordLinkDocs';
import { ActorPerms, BASE_DOC_TYPES, CANCEL_REASONS, CANCEL_REASON_WORD, CancelReason, ContractDetail, ContractDoc, ContractNote, ContractPayment, CustodyAction, CustodyHandler, DRAWER_TABS, DocReplaceTarget, DocTypeOption, DrawerTab, EXPIRY_DOC_KEYS, INCURRED_FEE_TYPES, MGMT_FEE_TYPES, PAYMENT_METHODS, PAY_STATUS_CELL, REC_TYPE_OPTIONS, RULE_FEE_DEFS, RULE_FEE_LABELS, clearedSum, feeActive, fmtAed, fmtDate, fmtMethod, isFeesVat } from './shared';


/** Generates + emails the tenant a secure magic link, deep-linked to the section
 *  relevant to where it's shown (documents vs the contract review/sign page),
 *  and shows the link so the RP can copy/share it directly (e.g. WhatsApp). */
export function SendTenantLinkButton({ tenantId, contractId, section = 'documents', label = 'Get / send link', role = 'tenant', disabled = false }: {
  tenantId: number; contractId: number; section?: 'documents' | 'contract' | 'move_in' | 'move_out' | 'settlement'; label?: string; role?: 'tenant' | 'inspector' | 'landlord'; disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        // Each link is scoped to one purpose — the backend enforces it and
        // returns a ready-to-share URL already deep-linked to the right page.
        body: JSON.stringify({ tenantId, contractId, purpose: section, signerRole: role }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const finalLink = d.link ?? '';
      setLink(finalLink); setEmail(d.email ?? null); setState('done');
      if (finalLink) { try { await navigator.clipboard.writeText(finalLink); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };

  if (state === 'done' && link) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', maxWidth: 360 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
          <input readOnly value={link} onFocus={e => e.currentTarget.select()}
            style={{ flex: 1, fontSize: 11, padding: '4px 8px', border: '1px solid var(--line, #e4e9e5)', borderRadius: 8, background: '#f6f8f6', color: '#14201a' }} />
          <button type="button" className="mini-btn ok" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <a href={link} target="_blank" rel="noreferrer" className="mini-btn view"><ExternalLink size={12} /> Open</a>
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--mute, #8a948d)' }}>
          {email ? `Emailed to ${email} · ` : ''}
          {role === 'inspector'
            ? 'share this link with your inspection manager to fill the inspection, attach photos & counter-sign on site (valid 14 days)'
            : role === 'landlord'
              ? 'share this link with the landlord / authorised signatory to review every document & sign as the lessor — no login (valid 14 days)'
              : 'share this link with the customer to upload & sign (valid 14 days)'}
        </span>
      </div>
    );
  }
  return (
    <button type="button" className="mini-btn view" onClick={send} disabled={disabled || state === 'sending'}
      style={disabled ? { opacity: .5, cursor: 'not-allowed' } : undefined}
      title={disabled ? 'Choose the documents to request first' : 'Generate a secure link for the tenant'}>
      <Send size={12} /> {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drawer
// ────────────────────────────────────────────────────────────────────────────

export function DRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="drow2">
      <span className="k">{k}</span>
      <span className="v">{v ?? '—'}</span>
    </div>
  );
}

/** Shared fixed column widths for BOTH payment tables (deposit/rent + fees) so
 *  every section's columns — amounts especially — line up in one vertical grid. */
/**
 * A status pill with its own menu — replaces the browser's native <select> for
 * cheque / deposit / custody statuses. It is a drop-in: the SAME <option>
 * children (so every row keeps its own option list, labels and disabled rules)
 * and the SAME onChange handler, called with a select-shaped { target: { value } }
 * — so "Cancelled…" still opens the reason picker and "Returned" the return
 * dialog. Fixed-position menu, so no card's overflow can clip it. While open it
 * is a role="dialog", which the report's J/K/Esc lease navigation stands down for.
 */
export function StatusMenu({ className, style, value, disabled, title, onChange, children }: {
  className?: string; style?: React.CSSProperties; value: string; disabled?: boolean; title?: string;
  onChange: (e: { target: { value: string } }) => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const opts = Children.toArray(children)
    .filter((c): c is React.ReactElement<{ value: string; disabled?: boolean; children?: React.ReactNode }> => isValidElement(c))
    .map(c => ({ value: String(c.props.value), label: c.props.children, disabled: !!c.props.disabled }));
  const current = opts.find(o => o.value === value);
  const toggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const h = opts.length * 34 + 10;
      const below = window.innerHeight - r.bottom > h + 8;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 196)), top: below ? r.bottom + 6 : Math.max(8, r.top - h - 6) });
    }
    setOpen(o => !o);
  };
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    (menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)') ?? items()[0])?.focus();
    const down = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    const shut = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', shut, true);
    };
  }, [open]);
  return (
    <>
      <button ref={btnRef} type="button" className={(className ?? '') + ' cstat-btn'} style={style} disabled={disabled} title={title}
        aria-haspopup="listbox" aria-expanded={open} onClick={toggle}
        onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); toggle(); } }}>
        <span>{current?.label ?? value}</span>
        <ChevronDown size={12} className={'cstat-chev' + (open ? ' up' : '')} />
      </button>
      {open && pos && (
        <div ref={menuRef} role="dialog" aria-label={title ?? 'Change status'} className="cstat-menu" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 130 }}>
          <div role="listbox">
            {opts.map(o => {
              const on = o.value === value;
              return (
                <button key={o.value} type="button" role="option" aria-selected={on} disabled={o.disabled}
                  className={'cstat-opt' + (on ? ' on' : '')}
                  onClick={() => { setOpen(false); btnRef.current?.focus(); if (!on) onChange({ target: { value: o.value } }); }}>
                  <span className={'cstat-dot ' + o.value} aria-hidden />
                  <span className="lb">{o.label}</span>
                  {on && <Check size={13} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export function PayCols() {
  return (
    <colgroup>
      <col style={{ width: '15%' }} />{/* # / Fee */}
      <col style={{ width: '21%' }} />{/* Description */}
      <col style={{ width: '12%' }} />{/* Amount */}
      <col style={{ width: '14%' }} />{/* Reference */}
      <col style={{ width: '10%' }} />{/* Method */}
      <col style={{ width: '12%' }} />{/* Due date */}
      <col style={{ width: '16%' }} />{/* Status */}
    </colgroup>
  );
}

/** A segregation-group divider row inside the Payments/Fees tables — the same
 *  Security Deposit / Rental Income / Management Fee / Third Party rail used by the
 *  read-only plan view, so the working (editable) table reads in the same four groups. */
export function PaySegRail({ title, extra, onAdd }: { title: string; extra?: React.ReactNode; onAdd?: () => void }) {
  return (
    <tr className="segrail">
      <td colSpan={7} style={{ borderLeft: '3px solid #0f4f36', background: 'var(--jade-tint, #eef2f0)', padding: '6px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 750, fontSize: 13, letterSpacing: '-.01em' }}>{title}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {extra != null && <span className="note segcount" style={{ fontWeight: 400 }}>{extra}</span>}
            {onAdd && <button type="button" className="mini-btn view" onClick={onAdd}><Plus size={11} /> Add</button>}
          </span>
        </div>
      </td>
    </tr>
  );
}

/**
 * The security deposit, as its own section of the contract.
 *
 * It sat inside the Payments table until migration 0191 — the first rail, above
 * Rental Income — which was wrong twice over. It put money the landlord HOLDS in
 * the same list as money the customer OWES, and because a deposit could be
 * recorded either as a `payments` row or as a register row, the table rendered
 * whichever it found first: the payment-backed version had no Settle button, so
 * the four leases signed in the app could not settle their deposit at move-out.
 *
 * One record now (the register), one section, and every action it actually needs
 * in one place: record, correct, clear/bounce the cheque, settle at move-out, and
 * the receipt number. A lease with NO deposit still gets the section — an empty
 * state that offers Add is how a deposit nobody recorded stops being invisible.
 */
export function ContractDepositSection({
  deposit: sd, agreedAmount, contractBase, refs, perms,
  adding, editing, busy, statusBusy, err, statusErr,
  form, setForm, onStartAdd, onStartEdit, onCancel, onSaveNew, onSaveEdit, onChangeStatus,
}: {
  deposit: {
    depositId: number | null; amount: number; chequeNumber: string | null;
    recordedDate: string | null; dueDate: string | null; paymentMethod: string | null;
    chequeStatus: string | null; status: string | null; isCarried: boolean;
    sourceContractId: number | null; settledRefundAmount: number | null;
    settledDeductionAmount: number | null; settledOn: string | null; settledViaSettlementId: number | null;
  } | null;
  agreedAmount: number | null;
  contractBase: string;
  refs: PaymentRefs;
  perms: ActorPerms;
  adding: boolean; editing: boolean; busy: boolean; statusBusy: boolean;
  err: string | null; statusErr: string | null;
  form: { amount: string; chequeNumber: string; paymentMethod: string; dueDate: string; chequeStatus: string };
  setForm: React.Dispatch<React.SetStateAction<{ amount: string; chequeNumber: string; paymentMethod: string; dueDate: string; chequeStatus: string }>>;
  onStartAdd: () => void; onStartEdit: () => void; onCancel: () => void;
  onSaveNew: () => void; onSaveEdit: (depositId: number) => void;
  onChangeStatus: (depositId: number, status: string) => void;
}) {
  // Editable only on the lease that OWNS the record. A renewal carries the same
  // physical deposit and shows it read-only — editing it there would edit the
  // original lease's money from a page that does not own it.
  const editable = !!sd && !sd.isCarried && sd.depositId != null && perms.deposits;
  const settled = !!sd?.status && sd.status !== 'held';
  const form_ = (
    <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12, background: 'var(--jade-tint)' }}>
      <p className="subhead">{adding ? 'Record the security deposit' : 'Edit security deposit'}</p>
      <div className="grid2">
        <div className="field"><label>Amount (AED)</label>
          <input type="number" min="0" step="0.01" className="input" value={form.amount} autoFocus
            onChange={e => setForm(v => ({ ...v, amount: e.target.value }))} />
        </div>
        <div className="field"><label>Payment method</label>
          <select className="input" value={form.paymentMethod}
            onChange={e => setForm(v => ({ ...v, paymentMethod: e.target.value }))}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Cheque / reference no.</label>
          <input className="input" value={form.chequeNumber} placeholder="Cheque #, transfer ID…"
            onChange={e => setForm(v => ({ ...v, chequeNumber: e.target.value }))} />
        </div>
        <div className="field"><label>{form.chequeStatus === 'cleared' ? 'Date received' : 'Due date'}</label>
          <input type="date" className="input" value={form.dueDate}
            onChange={e => setForm(v => ({ ...v, dueDate: e.target.value }))} />
        </div>
        <div className="field"><label>Cheque status</label>
          <select className="input" value={form.chequeStatus}
            onChange={e => setForm(v => ({ ...v, chequeStatus: e.target.value }))}>
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
            <option value="bounced">Bounced</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      {/* Says what clearing it means before it is clicked — the receipt number is
          minted off this, and money in hand is what it asserts. */}
      <p className="note" style={{ marginTop: 6, fontSize: 11 }}>
        {form.chequeStatus === 'cleared'
          ? 'Cleared means the money is in hand — this mints the deposit receipt.'
          : 'The deposit is recorded as held either way; the status tracks the cheque.'}
      </p>
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-jade btn-sm" disabled={busy}
          onClick={() => (adding ? onSaveNew() : onSaveEdit(sd!.depositId!))}>
          <Check size={14} /> {busy ? 'Saving…' : adding ? 'Record deposit' : 'Save changes'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="sec">
      <div className="sech">
        <span className="si"><DirhamSign size={16} /></span>
        <span className="st">Security Deposit</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sd && !sd.isCarried && (
            <span className="note" style={{ fontSize: 11 }}>held against this lease</span>
          )}
          {sd?.isCarried && sd.sourceContractId != null && (
            <span className="note" style={{ fontSize: 11 }}>
              carried from{' '}
              <Link href={`${contractBase.replace(/\/\d+$/, '')}/${sd.sourceContractId}/v2`}
                style={{ color: 'var(--jade)', fontWeight: 600, textDecoration: 'underline' }}>
                CID-{sd.sourceContractId}
              </Link>
            </span>
          )}
        </span>
      </div>
      <div className="secb" style={{ padding: 14 }}>
        {!sd ? (
          // Nothing on record. The landlord's own tracker had six leases reading
          // this way, five of which were deposits filed somewhere else — so the
          // empty state states the fact and offers the fix rather than staying blank.
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 13 }}>No deposit on record for this tenancy</p>
              <p className="note" style={{ fontSize: 12 }}>
                {agreedAmount
                  ? `The lease agrees ${fmtAed(agreedAmount)} — record it here once the cheque or transfer is in hand.`
                  : 'If a deposit was collected, record it here so it can be evidenced and settled at move-out.'}
              </p>
            </div>
            {perms.deposits && !adding && (
              <button type="button" className="btn btn-jade btn-sm" style={{ marginLeft: 'auto' }} onClick={onStartAdd}>
                <Plus size={13} /> Add deposit
              </button>
            )}
          </div>
        ) : (
          <div className="dep-body" style={{ display: 'grid', gap: 10 }}>
            <div className="dep-top" style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div className="dep-amt">
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--jade-deep)', letterSpacing: '-.02em' }}>
                  {sd.amount ? fmtAed(sd.amount) : <span style={{ color: '#8a948d', fontSize: 15 }}>amount not recorded</span>}
                </div>
                {sd.depositId != null && <ReceiptRefTag refs={refs} id={sd.depositId} kind="deposit" />}
              </div>
              <div className="dep-facts" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, auto))', gap: '4px 22px', marginLeft: 'auto' }}>
                <DRow k="Reference" v={sd.chequeNumber ?? '—'} />
                <DRow k="Method"    v={sd.paymentMethod ? fmtMethod(sd.paymentMethod) : '—'} />
                <DRow k={sd.recordedDate ? 'Received' : 'Cheque date'} v={fmtDate(sd.recordedDate ?? sd.dueDate) || '—'} />
              </div>
            </div>

            <div className="dep-acts" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {editable && sd.amount ? (
                <StatusMenu className={'cstat ' + (sd.chequeStatus ?? 'pending')} style={{ cursor: 'pointer' }}
                  title="Cheque / banking status" value={sd.chequeStatus ?? 'pending'} disabled={statusBusy}
                  onChange={e => onChangeStatus(sd.depositId!, e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="cleared">Cleared</option>
                  <option value="bounced">Bounced</option>
                  <option value="cancelled">Cancelled</option>
                </StatusMenu>
              ) : (
                <span className={'cstat ' + (sd.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                  {(sd.chequeStatus ?? 'pending')}
                </span>
              )}
              {/* The settlement outcome is a different fact from the cheque status
                  — held vs returned/kept — so it gets its own chip, never merged. */}
              {settled && (
                <span className={'cstat ' + sd.status} style={{ textTransform: 'capitalize' }}>{sd.status!.replace('_', ' ')}</span>
              )}
              {editable && !adding && !editing && (
                <button type="button" className="mini-btn view" title="Correct the amount, reference, method or date"
                  onClick={onStartEdit}>
                  <Pencil size={12} /> {sd.amount ? 'Edit' : 'Set deposit'}
                </button>
              )}
              {perms.settleDeposits && sd.amount > 0 && !settled && (
                <Link href={`${contractBase}/settlement`} className="mini-btn view" title="Settle the deposit (refund / deduction)">
                  <Stamp size={12} /> Settle
                </Link>
              )}
              {statusErr && <span className="note" style={{ color: 'var(--brick)', fontSize: 11 }}>{statusErr}</span>}
            </div>

            {settled && (sd.settledRefundAmount != null || sd.settledDeductionAmount != null) && (
              <p className="note dep-note" style={{ fontSize: 12 }}>
                Refunded {fmtAed(sd.settledRefundAmount ?? 0)} · kept {fmtAed(sd.settledDeductionAmount ?? 0)}
                {sd.settledOn ? ` · ${fmtDate(sd.settledOn)}` : ''}
                {sd.settledViaSettlementId != null ? ' · via the move-out settlement' : ''}
              </p>
            )}
          </div>
        )}
        {(adding || (editing && editable)) && <div style={{ marginTop: 12 }}>{form_}</div>}
      </div>
    </div>
  );
}

/** Per-section subtotal row — closes each segment (Security Deposit / Rental Income /
 *  Management Fee / Third Party) with its own total, so no section is left un-summed
 *  and the totals never get lumped together. Optional sub-lines (e.g. Net rent / VAT). */
export function PaySegTotalRow({ label = 'Total', amount, sub, collected }: { label?: string; amount: number; sub?: { label: string; amount: number }[]; collected?: number }) {
  const tot: React.CSSProperties = { borderTop: '2px solid #bfe3d5', background: 'var(--jade-tint, #eef2f0)' };
  return (
    <>
      {(sub ?? []).map(s => (
        <tr key={s.label}>
          <td colSpan={2} style={{ color: 'var(--mute)' }}>{s.label}</td>
          <td className="amt" style={{ color: 'var(--mute)', fontWeight: 600 }}>{fmtAed(s.amount)}</td>
          <td colSpan={4} />
        </tr>
      ))}
      <tr className="segtot">
        <td colSpan={2} style={{ ...tot, fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#5f6b63' }}>{label}</td>
        <td className="amt" style={{ ...tot, fontWeight: 800, color: 'var(--jade-deep)' }}>{fmtAed(amount)}</td>
        {/* The rest of the band says where the section stands — collected vs
            still to come — so the total row is a status line, not dead space. */}
        <td colSpan={4} style={tot}>
          {collected != null && amount > 0 && (() => {
            const got = Math.min(collected, amount);
            const left = amount - got;
            const pct = Math.round((got / amount) * 100);
            return (
              <div className="segtot-prog">
                <span className="segtot-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
                {left <= 0
                  ? <span className="segtot-done"><Check size={13} /> Fully collected</span>
                  : <span className="segtot-txt"><b>{fmtAed(got)}</b> collected · <b className="due">{fmtAed(left)}</b> outstanding</span>}
              </div>
            );
          })()}
        </td>
      </tr>
    </>
  );
}
/** Where the cheque / cash is — the same select control the status uses, with
 *  the dated line under it: when it reached head office and who took it, or
 *  when it went back to the customer, by whom and why (owner, 23 Sep 2026).
 *  Nothing for a transfer / card / online row; "Banked" once cleared. Choosing
 *  "Returned to customer" opens the reason dialog (0325). */
export function CustodyCell({ p, can, headOffice, onCustody, onReturn, proof }: {
  p: ContractPayment; can: boolean;
  /** The return's reference image, rendered as a paperclip after the dated line. */
  proof?: React.ReactNode;
  /** The landlord gave this manager "Hand cheques to head office" (0326). Without it
   *  there is no head office in the trail: with us → banked, or → returned. */
  headOffice: boolean;
  onCustody?: CustodyHandler; onReturn: (p: ContractPayment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const c = p.custody;
  const toReturn = p.toReturn === true;
  if (!c) return null;
  // No head office and nothing to return: a live cheque has no custody to show.
  if (!headOffice && !toReturn && c !== 'returned') return null;
  if (c === 'banked') return <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>Banked</span>;
  const tone = c === 'returned' ? 'cancelled' : c === 'not_recorded' ? 'cancelled' : toReturn ? 'bounced' : c === 'with_head_office' ? 'cleared' : 'pending';
  // Short words — the control sits in the Method column. A failed cheque with us
  // reads "To return"; at head office it reads "Head office" (the tone says failed).
  // By LOCATION, failed cheque or not (owner, 23 Sep 2026: "instead of To
  // return, With us") — the status chip already says it bounced or was cancelled.
  const label = (v: string) => v === 'with_us' ? 'With us'
    : v === 'with_head_office' ? 'Head office' : v === 'not_recorded' ? 'Not recorded' : 'Returned';
  const opts: string[] = [
    // Collected before custody existed — pick where it is; the option goes once set.
    ...(c === 'not_recorded' ? ['not_recorded'] : []),
    'with_us',
    ...(headOffice ? ['with_head_office'] : []),
    ...(toReturn || c === 'returned' ? ['returned'] : []),
  ];
  const atHeadOffice = c === 'with_head_office';
  const meta = c === 'with_head_office' && p.handedOverAt
    ? `${fmtDate(p.handedOverAt)}${p.handedOverBy ? ` · ${p.handedOverBy}` : ''}`
    : c === 'returned' && p.returnedToCustomerAt
      ? `${fmtDate(p.returnedToCustomerAt)}${p.returnedToCustomerBy ? ` · ${p.returnedToCustomerBy}` : ''}${p.returnedToCustomerReason ? ` · ${RETURN_REASON_WORD[p.returnedToCustomerReason] ?? p.returnedToCustomerReason}` : ''}${p.returnedToCustomerNote ? ` — ${p.returnedToCustomerNote}` : ''}`
      : null;
  const change = async (v: string) => {
    if (v === c || !onCustody) return;
    if (v === 'returned') { onReturn(p); return; }
    const act: CustodyAction = v === 'with_head_office' ? 'submit' : c === 'returned' ? 'undo_return' : 'take_back';   // take_back also settles "not recorded" → with us
    setBusy(true);
    try { await onCustody([p.id], act); } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 4 }}>
      {can && onCustody ? (
        <StatusMenu className={'cstat ' + tone} style={{ cursor: 'pointer', maxWidth: '100%' }} value={c} disabled={busy} onChange={e => void change(e.target.value)}
          title={c === 'not_recorded' ? 'Collected before custody was tracked — say where it is' : atHeadOffice && toReturn ? 'At head office — take it back first, then return it to the customer' : 'Where the cheque / cash is'}>
          {opts.map(v => <option key={v} value={v} disabled={v === 'returned' && atHeadOffice}>{label(v)}</option>)}
        </StatusMenu>
      ) : (
        <span className={'cstat ' + tone}>{label(c)}</span>
      )}
      {meta && <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 2, whiteSpace: 'normal' }}>{meta}{c === 'returned' ? proof : null}</span>}
    </div>
  );
}

export function ReceiptDownload({ refs, id, base }: { refs: PaymentRefs; id: number; base: string }) {
  const ref = refs.receiptByPaymentId?.[id];
  if (!ref) return null;
  const isVoid = !!refs.voidedPaymentIds?.has(id);
  return (
    <a
      className="mini-btn view"
      href={`${base}?pid=${id}`}
      target="_blank"
      rel="noreferrer"
      // Icon only: the status cell already carries a dropdown and an Edit
      // button, and a third labelled control wrapped the row. The number lives
      // in the tooltip and is printed under the description besides.
      aria-label={isVoid ? `Receipt ${ref} — voided` : `Download receipt ${ref}`}
      title={isVoid
        ? `Receipt ${ref} — VOIDED (the cheque was reverted). Open it to see the void notice.`
        : `Open receipt ${ref} to download and send to the customer`}
      style={{ padding: '3px 6px', ...(isVoid ? { color: 'var(--brick)' } : null) }}
    >
      <Download size={13} />
    </a>
  );
}

export function ReceiptRefTag({ refs, id, kind = 'payment' }: { refs: PaymentRefs; id: number; kind?: 'payment' | 'deposit' }) {
  // A register-booked deposit is numbered against security_deposits.id, a payment
  // against payments.id — two separate id spaces, never interchangeable.
  const ref = kind === 'deposit' ? refs.receiptByDepositId[id] : refs.receiptByPaymentId[id];
  if (!ref) return null;
  const isVoid = kind === 'deposit' ? refs.voidedDepositIds.has(id) : refs.voidedPaymentIds.has(id);
  return (
    <span className={'note rcpt-ref' + (isVoid ? ' void' : '')}
      title={isVoid ? 'Receipt voided — cheque reverted to a non-cleared status; number retained for the gapless series' : 'Issued receipt number — for bank reconciliation'}
      style={{ display: 'block', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', color: isVoid ? '#b3261e' : '#0f4f36', marginTop: 2, textDecoration: isVoid ? 'line-through' : 'none' }}>
      Receipt <span style={{ whiteSpace: 'nowrap' }}>{ref}</span>{isVoid ? ' · VOID' : ''}
    </span>
  );
}

/** The record view's tabs — one list shared by DetailsDrawer's own tab bar and
 *  the page's kit Seg, so both always offer exactly the same sections. */
export function leaseRecordTabs({ financeOnly, notesCount, emails, hasLegal, hasTenant }: {
  financeOnly: boolean; notesCount: number;
  emails?: { showEmails: boolean; showWhatsapp: boolean };
  hasLegal: boolean; hasTenant: boolean;
}): { key: DrawerTab; label: string; count: number | null }[] {
  return [
    { key: 'payments' as DrawerTab, label: 'Payments', count: null as number | null },
    ...(!financeOnly ? [{ key: 'documents' as DrawerTab, label: 'Documents', count: null }] : []),
    ...(!financeOnly ? [{ key: 'notes' as DrawerTab, label: 'Notes & activity', count: notesCount }] : []),
    ...(!financeOnly && emails?.showEmails && hasTenant ? [{ key: 'emails' as DrawerTab, label: 'Emails', count: null }] : []),
    ...(!financeOnly && emails?.showWhatsapp && hasTenant ? [{ key: 'whatsapp' as DrawerTab, label: 'WhatsApp', count: null }] : []),
    ...(!financeOnly && hasLegal ? [{ key: 'breaches' as DrawerTab, label: 'Breaches', count: null }] : []),
  ];
}

export function DetailsDrawer({
  open, tab, setTab, onClose, inline, contract, payments, kycDocs, onApproveDoc, onRejectDoc,
  // onDeletePayment is intentionally not destructured — fee rows are corrected
  // via Edit / Status, never deleted, so the drawer no longer offers Delete.
  onRecordPayment, onUpdatePayment, onUpdateDeposit, onCreateDeposit, onSaveClauses, onConfirmPdc, onUploadDoc, onRequestDoc,
  notes, onAddNote, perms, onDocsChanged, paymentRefs = EMPTY_PAYMENT_REFS, showExtras = true, editLocked = false, legal, emails, financeOnly = false, onCustody,
  tabbed = false, tabBar = true,
}: {
  /** False when the page renders the record tab bar itself (kit Seg, Genspark layout). */
  tabBar?: boolean;
  /** Record page (owner, 13 Oct 2026 — the Leases design): the inline sections
   *  shown one at a time under a tab bar instead of stacked. Every section and
   *  every action inside it is the same; only which one is on screen changes. */
  tabbed?: boolean;
  /** Hand a cheque to head office / take it back / hand it back to the customer (0323, 0324). */
  onCustody?: CustodyHandler;
  /** The accountant's record: payments + deposit only — no documents, notes,
   *  emails, WhatsApp or breaches (owner, 23 Sep 2026). */
  financeOnly?: boolean;
  /** Email module scope — the manager's landlord (`rp`, null for the landlord themselves). */
  /** Email and WhatsApp on this lease. A team member sees each only with that channel's "read" authority;
   *  the landlord sees both. (The server refuses the rest either way — this keeps empty tabs off the screen.) */
  emails?: { rp: number | null; isManager: boolean; showEmails: boolean; showWhatsapp: boolean };
  /** Legal & Breach module scope — base path ('/legal' | '/manager/legal'), manager `rp`, and where a dispute page lives. */
  legal?: { base: string; rp?: number; disputeHrefOf: (disputeId: number) => string };
  /** Refetch after a document is removed — the list must come from the server. */
  onDocsChanged: () => void;
  open: boolean; tab: DrawerTab; setTab: (t: DrawerTab) => void; onClose: () => void;
  /** Inline mode (CEO doctrine): render ALL sections stacked in the page flow —
   *  no slide-in drawer, no tabs, nothing hidden behind a click. The property
   *  section is skipped (the header chain links to property/unit details
   *  instead of duplicating them) and clauses stay hidden (addendums are the
   *  mechanism). */
  inline?: boolean;
  /** When false, the Clauses & Notes sections are hidden — used by the read-only
   *  Leases "record" view (Summary + Payments + Documents only). Defaults to true
   *  (the Operations full view keeps them). */
  showExtras?: boolean;
  /** True once the contract is signed by any party (non-on_file signature) →
   *  the Clauses & Notes editor is read-only, matching the backend lock. */
  editLocked?: boolean;
  contract: ContractDetail; payments: ContractPayment[]; kycDocs: ContractDoc[];
  onApproveDoc: (id: number) => void; onRejectDoc: (id: number, label?: string) => void;
  /** POST /api/contracts/:id/payments — record a new instalment / payment / fee. */
  onRecordPayment: (body: {
    description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string; chequeStatus?: string;
    /** The cheque on this contract that this payment makes good — one that
     *  bounced, or one the customer swapped (cancelled, reason 'replaced'). */
    replacesPaymentId?: number | null;
    /** Raise the bounce / replacement charge in the same action, linked to the
     *  same cheque. Omitted or 0 raises nothing. */
    replacementFee?: number;
  }) => Promise<number | void>;
  /** PATCH /api/contracts/:id/payments/:paymentId — edit status / amount / VAT / reference / description. */
  onUpdatePayment: (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string; paymentType?: string;
    documentId?: number | null; replacesPaymentId?: number | null;
    /** Why a cheque is being cancelled — required when moving it into
     *  `cancelled` (migration 0245). */
    cancellationReason?: string | null;
  }) => Promise<void>;
  /** DELETE /api/contracts/:id/payments/:paymentId — remove a fee / payment line. */
  onDeletePayment: (paymentId: number) => Promise<void>;
  /** PATCH /api/contracts/:id/deposits/:depositId — edit a held security deposit. */
  onUpdateDeposit: (depositId: number, patch: {
    chequeStatus?: string; paymentMethod?: string | null; dueDate?: string | null;
    chequeNumber?: string | null; amount?: number; depositStatus?: string;
  }) => Promise<void>;
  /** POST /api/contracts/:id/deposits — record the deposit on a lease that has none. */
  onCreateDeposit: (body: {
    amount: number; chequeNumber?: string | null; paymentMethod?: string | null;
    dueDate?: string | null; chequeStatus?: string;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/clauses — save edited custom clauses + notes. */
  onSaveClauses: (customClauses: string[], notes: string | null) => Promise<void>;
  /** PATCH /api/contracts/:id/confirm-pdc — confirm post-dated cheques received. */
  onConfirmPdc: () => Promise<void>;
  /** upload-url → PUT → POST /api/documents — attach a contract document. */
  /** `replaceOf` = the stored row to overwrite in place (binder "Replace");
   *  omitted → a fresh timestamped row is added beside whatever is on file. */
  onUploadDoc: (file: File, meta: { key: string; label: string; category: string; section: DocSection }, visibleToTenant: boolean, expiryDate: string, replaceOf?: DocReplaceTarget, visibleOnLandlordLink?: boolean) => Promise<number | void>;
  /** POST /api/documents/request — request a document from the tenant. */
  onRequestDoc: (label: string, notes: string) => Promise<void>;
  /** Running tenancy notes log (newest first). */
  notes: ContractNote[];
  /** POST /api/contracts/:id/notes — append a note to the tenancy log. */
  onAddNote: (body: string) => Promise<void>;
  /** Manager-permission gates for the editing affordances in this drawer
   *  (fees/payments/PDC → collections, deposit → deposits, notes → agreements).
   *  RP owners get `true` for every field. */
  perms: ActorPerms;
  /** RP reconciliation refs — plan number + per-payment receipt numbers. */
  paymentRefs?: PaymentRefs;
}) {
  // No `depositRow` any more: a deposit is never a payment row (migration 0191),
  // so there is exactly one place to read it from — contract.securityDeposit, the
  // register record — and exactly one section that renders it.
  // Receipt links must respect the portal (RP vs manager) — derive the base
  // the same way the page does, so manager links don't 404.
  const drawerPathname = usePathname();
  const contractBase = (drawerPathname?.startsWith('/dashboard/manager')
    ? '/dashboard/manager/contracts'
    : '/rental-provider/dashboard/contracts') + `/${contract.id}`;
  const receiptBase = `${contractBase}/print/receipt`;
  // ── Record-payment form state (Flow 1) ──
  const [showRec, setShowRec] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [recErr, setRecErr] = useState<string | null>(null);
  /** The cheque copy / transfer receipt the payment is recorded against —
   *  OPTIONAL (owner, 5 Oct 2026): a payment is often added before the cheque
   *  or transfer is in hand, and its copy is attached on the payment plan once
   *  it is received. Was required on every cheque and transfer since 23 Sep. */
  const [recFile, setRecFile] = useState<File | null>(null);
  const [feeFile, setFeeFile] = useState<File | null>(null);
  /** Files the cheque copy / transfer slip BEFORE the payment is recorded, so a
   *  refused upload stops the save rather than leaving a payment with nothing
   *  behind it; returns the document id to link. */
  const uploadProof = async (file: File | null, ref: string): Promise<number | undefined> => {
    if (!file) return undefined;
    const docId = await onUploadDoc(file, { key: 'payment_advice', label: `Payment Confirmation${ref ? ` · ${ref}` : ''}`, category: 'contract', section: 'tenancy' }, false, '');
    return typeof docId === 'number' ? docId : undefined;
  };
  const linkProof = async (paymentId: number | void, docId: number | undefined) => {
    if (typeof paymentId === 'number' && docId != null) await onUpdatePayment(paymentId, { documentId: docId });
  };
  const [rec, setRec] = useState({
    description: '', amount: '', paymentType: 'rental_income',
    // VAT on this rent cheque: none, +5% on top of the typed amount, or inside it.
    vatMode: 'none' as VatMode, vatOverride: '',
    paymentMethod: 'cheque', chequeNumber: '', transactionDate: '',
    // '' = an ordinary cheque; an id = this one makes good that bounced cheque.
    replacesPaymentId: '' as number | '',
    /** The bounce / replacement charge to raise alongside a linked replacement.
     *  Prefilled from the RP's rule when the link is chosen; '' raises nothing. */
    replacementFee: '',
  });
  // Which payment types this popup may offer. The popup is opened from a SEGMENT
  // rail ("Add" on Rental Income), so it only ever writes into that segment —
  // offering the other types let a rent cheque be filed as a fee and land in the
  // wrong section. Set by openRecordFor(); management / third-party fees have
  // their own VAT-aware fee popup.
  const [recTypes, setRecTypes] = useState<string[]>(['rental_income']);
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  // ── Inline cheque editor — correct amount / reference / description on existing rows ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    amount: '', chequeNumber: '', description: '', paymentMethod: 'cheque', transactionDate: '',
    vatMode: 'none' as VatMode, vatOverride: '',
    /** 'split' = the row is a charge that may carry VAT; 'all' = the whole row IS
     *  VAT ("5% VAT on Rent", a VAT cheque); 'none' = never taxed (deposit). */
    vatKind: 'split' as 'split' | 'all' | 'none',
    // '' = an ordinary cheque; an id = this row pays off that bounced cheque.
    replacesPaymentId: '' as number | '',
  });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  // ── Attribute an existing payment to the bounce it pays off ──
  // Separate from the cheque editor on purpose: the payments that settle a
  // bounce are usually already CLEARED, and a cleared row has no Edit button —
  // its amount/reference are locked because a receipt was minted against them.
  // Linking changes none of that, so it gets its own affordance rather than
  // unlocking the money fields on a receipted row.
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkValue, setLinkValue] = useState<number | ''>('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const startLink = (p: ContractPayment) => {
    setLinkingId(p.id); setLinkErr(null); setLinkValue(p.replacesPaymentId ?? '');
  };
  const saveLink = async (paymentId: number) => {
    setLinkBusy(true); setLinkErr(null);
    try {
      await onUpdatePayment(paymentId, { replacesPaymentId: linkValue === '' ? null : linkValue });
      setLinkingId(null);
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : 'Could not link this payment');
    } finally {
      setLinkBusy(false);
    }
  };
  /** How a row's VAT is edited — see editForm.vatKind. */
  const vatKindOf = (p: ContractPayment): 'split' | 'all' | 'none' => {
    const t = (p.paymentType ?? '').toLowerCase();
    if (t === 'security_deposit') return 'none';
    const vat = Number(p.vatAmount) || 0;
    if (t === 'vat' || (t === 'other' && isTaxLabel(p.description) && (vat <= 0 || Math.abs(vat - (p.amount ?? 0)) < 0.01))) return 'all';
    return 'split';
  };
  /** VAT the lease already collects on rent as a row of its own — a rent cheque
   *  given its own VAT on top of that would be taxed twice. */
  const rentVatOnOwnRow = payments.some(p => {
    const t = (p.paymentType ?? '').toLowerCase();
    return (t === 'vat' && !/fees/i.test(p.description ?? ''))
      || (t === 'other' && isTaxLabel(p.description) && /\brent/i.test(p.description ?? ''));
  });
  const startEdit = (p: ContractPayment) => {
    setEditingId(p.id); setEditErr(null);
    const vatKind = vatKindOf(p);
    setEditForm({
      ...(vatKind === 'split'
        ? vatFormFromStored(p.amount ?? 0, p.vatAmount ?? 0)
        : { amount: p.amount != null ? String(p.amount) : '', vatMode: 'none' as VatMode, vatOverride: '' }),
      vatKind,
      chequeNumber: p.chequeNumber ?? '',
      description: p.description ?? '',
      paymentMethod: p.paymentMethod ?? 'cheque',
      transactionDate: p.transactionDate ? p.transactionDate.slice(0, 10) : '',
      replacesPaymentId: p.replacesPaymentId ?? '',
    });
  };
  const saveEdit = async (paymentId: number) => {
    const typed = Number(editForm.amount);
    if (editForm.amount.trim() === '' || !Number.isFinite(typed) || typed < 0) { setEditErr('Enter a valid amount'); return; }
    const fig = splitVat(typed, editForm.vatMode, editForm.vatOverride.trim() ? Number(editForm.vatOverride) : null);
    if (editForm.vatKind === 'split' && (!Number.isFinite(fig.vat) || fig.vat < 0 || fig.vat > fig.total)) { setEditErr('Enter a valid VAT amount'); return; }
    setEditBusy(true); setEditErr(null);
    try {
      await onUpdatePayment(paymentId, {
        amount: editForm.vatKind === 'split' ? fig.total : typed,
        // A deposit sends none (never taxed); an all-VAT row is VAT to the fil.
        ...(editForm.vatKind === 'split' ? { vatAmount: fig.vat } : editForm.vatKind === 'all' ? { vatAmount: typed } : {}),
        chequeNumber: editForm.chequeNumber.trim() || null,
        description: editForm.description.trim() || null,
        paymentMethod: editForm.paymentMethod,
        transactionDate: editForm.transactionDate || null,
        // null unlinks — the corrective path when a row was attributed to the
        // wrong bounce (the bounce goes straight back to being owed).
        replacesPaymentId: editForm.replacesPaymentId === '' ? null : editForm.replacesPaymentId,
      });
      setEditingId(null);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setEditBusy(false);
    }
  };
  const submitRec = async () => {
    const typed = Number(rec.amount);
    if (!typed || typed <= 0) { setRecErr('Enter a valid amount'); return; }
    const recTaxed = rec.paymentType === 'rental_income';
    const fig = splitVat(typed, recTaxed ? rec.vatMode : 'none', rec.vatOverride.trim() ? Number(rec.vatOverride) : null);
    if (!Number.isFinite(fig.vat) || fig.vat < 0 || fig.vat > fig.total) { setRecErr('Enter a valid VAT amount'); return; }
    setRecBusy(true); setRecErr(null);
    try {
      const proofId = await uploadProof(recFile, rec.chequeNumber.trim());
      const newId = await onRecordPayment({
        description: rec.description.trim() || undefined,
        amount: fig.total,
        ...(recTaxed ? { vatAmount: fig.vat } : {}),
        paymentType: rec.paymentType,
        paymentMethod: rec.paymentMethod,
        chequeNumber: rec.chequeNumber.trim() || undefined,
        transactionDate: rec.transactionDate || undefined,
        replacesPaymentId: rec.replacesPaymentId === '' ? undefined : rec.replacesPaymentId,
        // Only meaningful on a linked replacement; the API ignores it otherwise.
        replacementFee: rec.replacesPaymentId === '' || !Number(rec.replacementFee)
          ? undefined : Number(rec.replacementFee),
      });
      await linkProof(newId, proofId);
      setRec({ description: '', amount: '', paymentType: 'rental_income', vatMode: 'none', vatOverride: '', paymentMethod: 'cheque', chequeNumber: '', transactionDate: '', replacesPaymentId: '', replacementFee: '' });
      setRecFile(null);
      setShowRec(false);
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setRecBusy(false);
    }
  };
  const changeStatus = async (paymentId: number, status: string, cancellationReason?: string) => {
    setStatusBusy(paymentId);
    try {
      await onUpdatePayment(paymentId, {
        chequeStatus: status,
        ...(status === 'cancelled' ? { cancellationReason } : {}),
      });
    }
    finally { setStatusBusy(null); }
  };
  // Cancelling asks WHY before it is applied (migration 0245). "Cancelled" had
  // come to mean three unrelated things — the customer swapped the cheque, the
  // paper went back, or the lease itself was cancelled — and only the first
  // leaves money collected on another row. Asking at the moment somebody knows
  // the answer is the only point at which it is cheap to record; a month later
  // nobody remembers, which is how the existing rows ended up needing a
  // migration to work it out from the notes people typed.
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason>('replaced');
  const [cancelBusy, setCancelBusy] = useState(false);
  const startCancel = (p: ContractPayment) => {
    setCancelId(p.id);
    setCancelReason((p.cancellationReason as CancelReason) ?? 'replaced');
  };
  const confirmCancel = async () => {
    if (cancelId == null) return;
    setCancelBusy(true);
    try { await changeStatus(cancelId, 'cancelled', cancelReason); setCancelId(null); }
    finally { setCancelBusy(false); }
  };
  // ── Deposit editor — only the home/oldest lease that OWNS the record; renewals carry it read-only ──
  const [depEditing, setDepEditing] = useState(false);
  const [depBusy, setDepBusy] = useState(false);
  const [depStatusBusy, setDepStatusBusy] = useState(false);
  const [depErr, setDepErr] = useState<string | null>(null);
  const [depForm, setDepForm] = useState({ amount: '', chequeNumber: '', paymentMethod: 'cheque', dueDate: '', chequeStatus: 'pending' });
  const startDepEdit = () => {
    const sd = contract.securityDeposit;
    if (!sd) return;
    setDepEditing(true); setDepErr(null);
    setDepForm({
      amount: sd.amount != null ? String(sd.amount) : '',
      chequeNumber: sd.chequeNumber ?? '',
      paymentMethod: sd.paymentMethod ?? 'cheque',
      dueDate: sd.dueDate ?? '',
      chequeStatus: sd.chequeStatus ?? 'pending',
    });
  };
  const saveDep = async (depositId: number) => {
    const amt = Number(depForm.amount);
    if (depForm.amount.trim() === '' || !Number.isFinite(amt) || amt < 0) { setDepErr('Enter a valid amount'); return; }
    setDepBusy(true); setDepErr(null);
    try {
      await onUpdateDeposit(depositId, {
        amount: amt,
        chequeNumber: depForm.chequeNumber.trim() || null,
        paymentMethod: depForm.paymentMethod || null,
        dueDate: depForm.dueDate || null,
        chequeStatus: depForm.chequeStatus,
      });
      setDepEditing(false);
    } catch (e) {
      setDepErr(e instanceof Error ? e.message : 'Failed to save deposit');
    } finally { setDepBusy(false); }
  };
  // ── Add a deposit — for a lease that has none on record ──
  //
  // The same form as the editor, opened from the section's Add button. Worth its
  // own state rather than reusing depEditing: "correct what we hold" and "record
  // a deposit we never captured" are different actions and the empty section has
  // to say which one it is offering.
  const [depAdding, setDepAdding] = useState(false);
  const startDepAdd = () => {
    setDepAdding(true); setDepErr(null);
    setDepForm({
      // Pre-fill the agreed figure when the contract carries one — the usual case
      // is that the deposit was agreed on the lease and simply never recorded.
      amount: contract.securityDepositAmount ? String(contract.securityDepositAmount) : '',
      chequeNumber: '', paymentMethod: 'cheque', dueDate: '', chequeStatus: 'pending',
    });
  };
  const saveNewDep = async () => {
    const amt = Number(depForm.amount);
    if (depForm.amount.trim() === '' || !Number.isFinite(amt) || amt <= 0) { setDepErr('Enter the deposit amount'); return; }
    setDepBusy(true); setDepErr(null);
    try {
      await onCreateDeposit({
        amount: amt,
        chequeNumber: depForm.chequeNumber.trim() || null,
        paymentMethod: depForm.paymentMethod || null,
        dueDate: depForm.dueDate || null,
        chequeStatus: depForm.chequeStatus,
      });
      setDepAdding(false);
    } catch (e) {
      setDepErr(e instanceof Error ? e.message : 'Failed to record the deposit');
    } finally { setDepBusy(false); }
  };
  // Surfaced when an inline status change (cheque or settlement) fails — otherwise
  // onUpdateDeposit rejects, reload() never runs, and the <select> silently snaps back.
  const [depStatusErr, setDepStatusErr] = useState<string | null>(null);
  const changeDepStatus = async (depositId: number, status: string) => {
    setDepStatusBusy(true); setDepStatusErr(null);
    try { await onUpdateDeposit(depositId, { chequeStatus: status }); }
    catch { setDepStatusErr('Could not update the cheque status. Please try again.'); }
    finally { setDepStatusBusy(false); }
  };
  // ── Clause editor state (Flow 2) — editable only while the contract is a draft
  //    AND not yet signed by any party (editLocked mirrors the backend guard on
  //    PATCH /contracts/:id/clauses; on-file/imported leases stay editable). ──
  const clausesEditable = contract.status === 'pending' && !editLocked;
  const [clauseList, setClauseList] = useState<string[]>(contract.customClauses ?? []);
  const [clauseNotes, setClauseNotes] = useState(contract.notes ?? '');
  const [clauseInput, setClauseInput] = useState('');
  const [clauseBusy, setClauseBusy] = useState(false);
  const [clauseSaved, setClauseSaved] = useState(false);
  const [clauseErr, setClauseErr] = useState<string | null>(null);
  // Keep the local editor in sync when the contract reloads.
  useEffect(() => {
    setClauseList(contract.customClauses ?? []);
    setClauseNotes(contract.notes ?? '');
  }, [contract.customClauses, contract.notes]);

  // ── Agreement Addendum ── attach the unit's layout addendum onto an existing
  //    contract. Unlike the draft-only file upload, this works on issued/active
  //    leases (snapshots the plan's current Agreement Addendum onto the lease).
  const [addendums, setAddendums] = useState<{ id: number; name: string | null }[]>([]);
  const [addendumRefresh, setAddendumRefresh] = useState(0);
  const [addendumBusy, setAddendumBusy] = useState(false);
  const [addendumErr, setAddendumErr] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    fetch(`/api/contracts/${contract.id}/addendums`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((a) => { if (ok) setAddendums(Array.isArray(a) ? a : []); })
      .catch(() => { if (ok) setAddendums([]); });
    return () => { ok = false; };
  }, [contract.id, addendumRefresh]);
  const addendumEnded = contract.status === 'terminated' || contract.status === 'expired';
  const onAttachLayoutAddendum = async () => {
    setAddendumBusy(true); setAddendumErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/addendums/from-layout`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(b?.message || `Error ${res.status}`);
      }
      setAddendumRefresh(n => n + 1);
    } catch (e) {
      setAddendumErr(e instanceof Error ? e.message : 'Failed to attach addendum');
    } finally { setAddendumBusy(false); }
  };

  const addClause = () => {
    const t = clauseInput.trim();
    if (t) { setClauseList(prev => [...prev, t]); setClauseInput(''); }
  };
  const saveClauses = async () => {
    setClauseBusy(true); setClauseErr(null); setClauseSaved(false);
    try {
      await onSaveClauses(clauseList, clauseNotes || null);
      setClauseSaved(true);
      setTimeout(() => setClauseSaved(false), 2500);
    } catch (e) {
      setClauseErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setClauseBusy(false);
    }
  };
  // ── Tenancy notes log (running hand-off journal) ──
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const submitNote = async () => {
    const t = noteDraft.trim();
    if (!t) return;
    setNoteBusy(true); setNoteErr(null);
    try {
      await onAddNote(t);
      setNoteDraft('');
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setNoteBusy(false);
    }
  };
  const rentRows = payments
    .filter(p => p.paymentType !== 'security_deposit')
    .slice()
    .sort((a, b) => (a.transactionDate ?? '').localeCompare(b.transactionDate ?? ''));
  // One-off leasing fees (admin / ejari / commission) — their own line items,
  // kept out of the rent schedule and rent totals.
  const feeRows = contract.fees ?? [];
  const feeGross = feeRows.reduce((s, p) => s + (p.amount || 0), 0);
  // Custom "Other" charges are stored as payments (payment_type 'other') — per-unit
  // taxes, service fees like "Fire Fighting". They are NOT rent, so pull them out of
  // the rent schedule + rent totals and show them under Fees (smallest → largest,
  // matching the receipt / payment-plan order). `rentRows` itself is left intact so
  // the live payment-plan (currentPlanItems below) still sees every row.
  const otherPaymentRows = rentRows
    .filter(p => (p.paymentType ?? '') === 'other')
    .slice()
    .sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
  // "Fees VAT" — the combined VAT cheque on admin/commission fees — is a
  // pass-through tax: it belongs under Third Party with the registration fee,
  // never inside the rent schedule (only rent + Rental VAT live there).
  const feesVatPaymentRows = rentRows.filter(p => isFeesVat(p));
  const rentScheduleRows = rentRows.filter(p => (p.paymentType ?? '') !== 'other' && !isFeesVat(p));
  // Same rows, re-ordered so every payment recorded against a bounced cheque sits
  // directly beneath it instead of at its own due date — see
  // chequeReplacementGroups.ts for why date order tells the story wrong.
  const rentScheduleGroups = groupReplacementsUnderBounce(rentScheduleRows);
  // Instalment numbering counts the schedule's own cheques. A replacement is part
  // of the bounce above it, not a further instalment, so it takes no number.
  const rentRowNumber = new Map<number, number>();
  for (const g of rentScheduleGroups) if (g.depth === 0) rentRowNumber.set(g.row.id, rentRowNumber.size + 1);
  /** Rows that head a group — the tint starts on the bounce, not on its first replacement. */
  const rentGroupHeadIds = new Set(rentScheduleGroups.map(g => g.parent?.id).filter((id): id is number => id != null));
  const rentReplacementCount = rentScheduleGroups.filter(g => g.depth > 0).length;
  const otherGross = otherPaymentRows.reduce((s, p) => s + (p.amount || 0), 0);
  // Fees split into the two segregation groups so the working table reads in the SAME
  // four sections as the plan/receipts: Admin + Commission → Management Fee; Ejari
  // (Contract Registration) + cheque-charge penalties → Third Party (with 'other' charges).
  // Management Fee = RP-charged fees: admin + commission + every Rules penalty/charge.
  // (Ejari / VAT / sub-lease / service charges stay Third Party — pass-through.)
  const managementFeeRows = feeRows.filter(f => MGMT_FEE_TYPES.has(f.paymentType ?? ''));
  const thirdPartyFeeRows = [
    ...feeRows.filter(f => !MGMT_FEE_TYPES.has(f.paymentType ?? '')),
    ...(feesVatPaymentRows as typeof feeRows),
  ];
  // Bounced / cancelled cheques are void — excluded from every section total and the
  // grand total, the same rule the header pass applies to the rent.
  const managementFeeTotal = managementFeeRows.reduce((s, f) => s + (feeActive(f) ? (f.amount || 0) : 0), 0);
  const otherActiveGross = otherPaymentRows.reduce((s, p) => s + (feeActive(p) ? (p.amount || 0) : 0), 0);
  const thirdPartyTotal = thirdPartyFeeRows.reduce((s, f) => s + (feeActive(f) ? (f.amount || 0) : 0), 0) + otherActiveGross;
  const feeLabel = (t: string | null) =>
    t === 'admin_fee' ? 'Admin fee' : t === 'ejari_fee' ? 'Contract Registration fee' : t === 'commission' ? 'Commission'
      : t === 'other' ? 'Other'
      : (t && RULE_FEE_LABELS[t]) ? RULE_FEE_LABELS[t]
      : (t ?? 'Fee');
  // ── Fees editor (admin-filled: admin / ejari / commission + cheque charges).
  //    Fees are never auto-fabricated — the RP enters them here. Amount is NET
  //    (excl. VAT); VAT is an optional separate figure; stored gross = net + VAT.
  //    The three cheque-charge types auto-fill their amount from Settings → Rules. ──
  // The whole RP Rules config (all penalty / admin-charge fields) so every rule type
  // can auto-fill its amount + show its basis in the Add-fee popup.
  const [rpRules, setRpRules] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { profile?: Record<string, unknown> } | null) => { if (alive) setRpRules(data?.profile ?? null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const annualRentForRules = contract.annualRent || 0;
  /** Suggested amount + a short basis label for a Rules fee type, from the RP config +
   *  this contract's rent: N months → months x monthly rent; daily → 0 (set at
   *  settlement); else the greater of the flat fee and % of annual rent. */
  const ruleSuggest = (pt: string): { amount: number; basis: string } => {
    const def = RULE_FEE_DEFS.find(d => d.pt === pt);
    if (!def || !rpRules) return { amount: 0, basis: '' };
    const num = (k?: string) => (k && rpRules[k] != null && rpRules[k] !== '' ? Number(rpRules[k]) : 0);
    const fee = num(def.feeK), pct = num(def.pctK), months = num(def.monthsK);
    const daily = def.dailyK ? !!rpRules[def.dailyK] : false;
    const aed = (n: number) => `AED ${Math.round(n).toLocaleString('en-AE')}`;
    if (months > 0) return { amount: Math.round(months * annualRentForRules / 12), basis: `${months} mo of rent` };
    if (daily) return { amount: 0, basis: 'per day of overstay' };
    const pctAmt = pct > 0 ? Math.round(pct / 100 * annualRentForRules) : 0;
    if (fee > 0 && fee >= pctAmt) return { amount: fee, basis: aed(fee) };
    if (pctAmt > 0) return { amount: pctAmt, basis: `${pct}% of rent` };
    return { amount: 0, basis: 'not set' };
  };
  const FEE_TYPE_OPTIONS = [
    { value: 'admin_fee', label: 'Admin fee' },
    { value: 'ejari_fee', label: 'Contract Registration fee' },
    { value: 'commission', label: 'Commission' },
    ...RULE_FEE_DEFS.map(d => ({ value: d.pt, label: d.label })),
    // Catch-all pass-through charge (service fee, per-unit tax, etc.) — lands under
    // Third Party; the RP names it via the Description field.
    { value: 'other', label: 'Other' },
  ];
  /** Auto-filled amount (form string) for a fee type from Settings → Rules, or ''. */
  const feeAutoAmount = (t: string): string => {
    const a = ruleSuggest(t).amount;
    return a > 0 ? String(a) : '';
  };
  /** Dropdown label with the rule's basis + amount, e.g. "Early termination · 3 mo of rent (AED 25,000)". */
  const feeOptionLabel = (t: string, base: string): string => {
    const { amount, basis } = ruleSuggest(t);
    if (!basis) return base;
    return amount > 0 ? `${base} · ${basis}` : `${base} · ${basis}`;
  };
  // `amount` is the figure as typed; `vatMode` says whether VAT is on top of it,
  // inside it, or not charged — the stored row is always gross + its VAT.
  const emptyFeeForm = { paymentType: 'admin_fee', amount: '', vatMode: 'none' as VatMode, vatOverride: '', transactionDate: '', description: '', paymentMethod: 'cheque', chequeNumber: '' };
  const feeFig = (f: typeof emptyFeeForm) => splitVat(Number(f.amount) || 0, f.vatMode, f.vatOverride.trim() ? Number(f.vatOverride) : null);
  const [showAddFee, setShowAddFee] = useState(false);
  const [feeAdd, setFeeAdd] = useState(emptyFeeForm);
  const [feeAddBusy, setFeeAddBusy] = useState(false);
  const [feeAddErr, setFeeAddErr] = useState<string | null>(null);
  const [feeEditId, setFeeEditId] = useState<number | null>(null);
  const [feeEdit, setFeeEdit] = useState(emptyFeeForm);
  const [feeEditBusy, setFeeEditBusy] = useState(false);
  const [feeEditErr, setFeeEditErr] = useState<string | null>(null);
  const submitAddFee = async () => {
    const typed = Number(feeAdd.amount); const { vat, total } = feeFig(feeAdd);
    if (!Number.isFinite(typed) || typed <= 0) { setFeeAddErr('Enter a valid amount'); return; }
    if (!Number.isFinite(vat) || vat < 0 || vat > total) { setFeeAddErr('Enter a valid VAT amount'); return; }
    setFeeAddBusy(true); setFeeAddErr(null);
    try {
      const proofId = await uploadProof(feeFile, feeAdd.chequeNumber.trim());
      const newId = await onRecordPayment({
        paymentType: feeAdd.paymentType,
        amount: total,   // backend stores GROSS
        vatAmount: vat,
        description: feeAdd.description.trim() || feeLabel(feeAdd.paymentType),
        transactionDate: feeAdd.transactionDate || undefined,
        paymentMethod: feeAdd.paymentMethod,
        chequeNumber: feeAdd.chequeNumber.trim() || undefined,
        chequeStatus: 'pending',
      });
      await linkProof(newId, proofId);
      setFeeAdd(emptyFeeForm); setFeeFile(null); setShowAddFee(false);
    } catch (e) { setFeeAddErr(e instanceof Error ? e.message : 'Failed to add fee'); }
    finally { setFeeAddBusy(false); }
  };
  const startFeeEdit = (f: ContractPayment) => {
    setFeeEditId(f.id); setFeeEditErr(null);
    setFeeEdit({
      paymentType: f.paymentType ?? 'admin_fee',
      ...vatFormFromStored(f.amount ?? 0, f.vatAmount ?? 0),
      transactionDate: f.transactionDate ? f.transactionDate.slice(0, 10) : '',
      description: f.description ?? '',
      paymentMethod: f.paymentMethod ?? 'cheque',
      chequeNumber: f.chequeNumber ?? '',
    });
  };
  const saveFeeEdit = async (paymentId: number) => {
    const typed = Number(feeEdit.amount); const { vat, total } = feeFig(feeEdit);
    if (!Number.isFinite(typed) || typed < 0) { setFeeEditErr('Enter a valid amount'); return; }
    if (!Number.isFinite(vat) || vat < 0 || vat > total) { setFeeEditErr('Enter a valid VAT amount'); return; }
    setFeeEditBusy(true); setFeeEditErr(null);
    try {
      await onUpdatePayment(paymentId, {
        amount: total,
        vatAmount: vat,
        description: feeEdit.description.trim() || null,
        transactionDate: feeEdit.transactionDate || null,
        paymentMethod: feeEdit.paymentMethod,
        chequeNumber: feeEdit.chequeNumber.trim() || null,
        paymentType: feeEdit.paymentType,
      });
      setFeeEditId(null);
    } catch (e) { setFeeEditErr(e instanceof Error ? e.message : 'Failed to save changes'); }
    finally { setFeeEditBusy(false); }
  };
  // Per-section "Add" → open the right popup pre-typed for that segment. Deposit + rent
  // use the payment popup; management + third-party fees use the fee popup (VAT-aware).
  const openRecordFor = (paymentType: string) => {
    setRec(v => ({ ...v, paymentType, amount: '', vatMode: 'none', vatOverride: '', chequeNumber: '', description: '', transactionDate: '', replacesPaymentId: '', replacementFee: '' }));
    setRecTypes([paymentType]);
    setShowAddFee(false); setRecErr(null); setShowRec(true);
  };
  // "Record replacement" on a bounced row — the same popup, pre-filled and
  // pre-linked. Recording the new cheque this way is what settles the bounce:
  // the link is what stops the dashboards counting it, and it must cover the
  // full face value (a part-payment leaves the balance owed, so the API rejects
  // it and the bounce stays open).
  const openReplacementFor = (p: ContractPayment) => {
    const swapped = isSwapped(p);
    setRec({
      description: swapped
        ? `Replacement for cheque${p.chequeNumber ? ` No. ${p.chequeNumber}` : ''}`
        : `Payment against bounced cheque${p.chequeNumber ? ` No. ${p.chequeNumber}` : ''}`,
      // Pre-fill what is still SHORT, not the face value — on a bounce already
      // part-paid, the face value would over-collect.
      amount: String(shortfallOf(p)),
      // The replacement carries the bounced cheque's VAT share — "VAT incl." so
      // the total stays exactly the shortfall the API checks it against.
      ...((Number(p.vatAmount) || 0) > 0 && (p.amount ?? 0) > 0
        ? { vatMode: 'inclusive' as VatMode, vatOverride: String(Math.round(shortfallOf(p) * (Number(p.vatAmount) / (p.amount ?? 1)) * 100) / 100) }
        : { vatMode: 'none' as VatMode, vatOverride: '' }),
      paymentType: p.paymentType ?? 'rental_income',
      paymentMethod: p.paymentMethod ?? 'cheque',
      chequeNumber: '',
      transactionDate: '',
      replacesPaymentId: p.id,
      // A swapped cheque carries the replacement fee, a bounced one the bounce
      // fee — two different rules in Settings → Rules. Prefilled, and the
      // manager can change it or clear it before saving.
      replacementFee: feeAutoAmount(swapped ? 'cheque_replacement_fee' : 'bounced_cheque_fee'),
    });
    setRecTypes([p.paymentType ?? 'rental_income']);
    setShowAddFee(false); setRecErr(null); setShowRec(true);
  };
  // The cheque → replacement links, both directions, so each row can say which
  // payments settled it / which one it goes against. A cancelled replacement
  // doesn't count — that cheque was voided, so the original is owed again.
  //
  // A cheque may be settled by SEVERAL payments (10,000 + 7,500 against a 17,500
  // cheque), so it is the SUM that matters: it stays open for whatever is still
  // short. Mirrors cheque-replacement.ts on the backend, INCLUDING the rule that
  // a fee raised against a cheque is not money that covers it — the replacement
  // fee points at the same cheque so the ledger can say what it is for, and
  // counting it would mark the cheque paid on money that was never rent.
  const FEE_NOT_COVERAGE = new Set(['bounced_cheque_fee', 'cheque_replacement_fee', 'cheque_deferral_fee']);
  const replacementsOf = new Map<number, ContractPayment[]>();
  const chargesOf = new Map<number, ContractPayment[]>();
  const replacedRow = new Map<number, ContractPayment>();
  for (const r of payments) {
    if (r.replacesPaymentId == null) continue;
    const target = payments.find(t => t.id === r.replacesPaymentId);
    if (target) replacedRow.set(r.id, target);
    if (FEE_NOT_COVERAGE.has((r.paymentType ?? '').toLowerCase())) {
      chargesOf.set(r.replacesPaymentId, [...(chargesOf.get(r.replacesPaymentId) ?? []), r]);
      continue;
    }
    if ((r.chequeStatus ?? '').toLowerCase() === 'cancelled') continue;
    replacementsOf.set(r.replacesPaymentId, [...(replacementsOf.get(r.replacesPaymentId) ?? []), r]);
  }
  /** Money recorded against a cheque so far. */
  const coveredOf = (id: number) => (replacementsOf.get(id) ?? []).reduce((s, r) => s + (r.amount || 0), 0);
  /** What is still owed on a cheque (0 = fully made good). */
  const shortfallOf = (p: ContractPayment) => Math.max(0, (p.amount || 0) - coveredOf(p.id));
  /** A cheque the customer SWAPPED rather than one that was simply voided — the
   *  only cancellation that may carry a replacement (migration 0245). */
  const isSwapped = (p: ContractPayment) =>
    (p.chequeStatus ?? '').toLowerCase() === 'cancelled'
    && (p.cancellationReason ?? '').toLowerCase() === 'replaced';
  /** Cheques that failed and are still short of being made good — a bounce, or a
   *  cheque marked as swapped whose replacement has not been recorded yet. */
  const unreplacedBounced = payments.filter(
    p => ((p.chequeStatus ?? '').toLowerCase() === 'bounced' || isSwapped(p)) && shortfallOf(p) > 1,
  );
  /**
   * The bounces an EXISTING row may be pointed at, and what each still needs.
   *
   * Computed with `rowId`'s own contribution taken out, so the row's current
   * target stays in the list (re-saving an edit must not silently unlink it) and
   * the amount shown is what would still be owed if this row moved elsewhere.
   * Two part-payments against one bounce is the normal case here: the first is
   * linked while the bounce is short by the full amount, the second while it is
   * short by the remainder.
   */
  const linkTargetsFor = (rowId: number) => {
    const me = payments.find(p => p.id === rowId);
    const myAmount = me?.amount || 0;
    const myDate = me?.transactionDate ? new Date(me.transactionDate.slice(0, 10)).getTime() : null;
    return payments
      // A bounce, or a cheque the customer swapped. The other two cancellation
      // reasons are genuine voids and the API refuses them, so they are never
      // offered here either.
      .filter(b => ((b.chequeStatus ?? '').toLowerCase() === 'bounced' || isSwapped(b)) && b.id !== rowId)
      .filter(b => !FEE_NOT_COVERAGE.has((b.paymentType ?? '').toLowerCase()))
      .map(b => {
        const mine = (replacementsOf.get(b.id) ?? []).find(r => r.id === rowId)?.amount ?? 0;
        return { row: b, owed: Math.max(0, (b.amount || 0) - (coveredOf(b.id) - mine)) };
      })
      // Same two guards the API enforces, so the list never offers a link that
      // would be rejected — or worse, one that looks plausible and is wrong:
      //  • money collected before the cheque bounced cannot be its replacement
      //    (an ordinary earlier instalment would otherwise settle it on paper
      //    while its money is already spoken for), 30 days of slack for a bank
      //    that returns a cheque early;
      //  • a payment larger than the shortfall belongs to something else too.
      .filter(o => {
        if (o.owed <= 1) return false;
        if (myAmount > o.owed + 1) return false;
        const failedDate = o.row.transactionDate ? new Date(o.row.transactionDate.slice(0, 10)).getTime() : null;
        if (myDate != null && failedDate != null && myDate < failedDate - 30 * 86_400_000) return false;
        return true;
      });
  };
  // What the charge on the record-payment popup is CALLED and what it prefills
  // to, both decided by the row the payment is being linked to: a cheque that
  // bounced carries the bounce fee, one the customer swapped carries the
  // replacement fee. Two rules, two lines on the customer's statement.
  const recChargeTarget = rec.replacesPaymentId === ''
    ? null : payments.find(b => b.id === rec.replacesPaymentId) ?? null;
  const recChargeIsSwap = recChargeTarget != null && isSwapped(recChargeTarget);
  const recChargeLabel = recChargeIsSwap ? 'Cheque replacement fee' : 'Bounced cheque fee';
  const recChargeAuto = feeAutoAmount(recChargeIsSwap ? 'cheque_replacement_fee' : 'bounced_cheque_fee');
  const openFeeFor = (paymentType: string) => {
    const auto = feeAutoAmount(paymentType);
    setFeeAdd({ ...emptyFeeForm, paymentType, ...(auto ? { amount: auto } : {}) });
    setShowRec(false); setFeeAddErr(null); setShowAddFee(true);
  };
  // A bounced or cancelled cheque is void (it never cleared / was replaced by a new
  // cheque), so it must NOT count toward the rent total — otherwise it double-counts
  // with its replacement. It still appears in the table above as history.
  const countsToTotal = (p: { chequeStatus?: string | null }) =>
    !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase());
  // Rent VAT (commercial/industrial): amounts are GROSS; split net vs VAT for display.
  const rentGross = rentScheduleRows.reduce((s, p) => s + (countsToTotal(p) ? (p.amount || 0) : 0), 0);
  const rentVat   = rentScheduleRows.reduce((s, p) => s + (countsToTotal(p) ? (p.vatAmount || 0) : 0), 0);
  const rentNet   = rentGross - rentVat;
  const showVat   = (contract.rentVatRate ?? 0) > 0 || rentVat > 0;
  // All four segments summed: rent + management + third party, plus the deposit ONLY
  // when it is this contract's own (a renewal carries it forward, never re-collected
  // → excluded here too).
  //
  // This is the LEDGER total — everything charged on the lease, penalties included —
  // so it exceeds the header pass's "Total payable" whenever the tenancy has incurred
  // one. That is deliberate: the pass states what the tenancy was AGREED at, this
  // states what it has been CHARGED. The pass prints the difference underneath
  // ("+ X charges incurred") so the gap reads as an answer rather than a discrepancy.
  // They used to be forced equal, which meant a bounced-cheque penalty silently
  // restated the agreed rent (contract 81: a 77,000 lease shown as 78,000).
  const grandDeposit = contract.contractType === 'renewal' ? 0 : (contract.securityDeposit?.amount ?? 0);
  const paymentsGrandTotal = grandDeposit + rentGross + managementFeeTotal + thirdPartyTotal;
  // What the tenancy was AGREED at, split back out of the grand total above. A
  // penalty is real money and belongs in the ledger, but rolling it into a single
  // figure meant a bounced cheque silently restated the rent: contract 81, a 77,000
  // lease, totalled 78,000 because of two 500 penalties. Showing both — agreed, plus
  // what the lease has since incurred — keeps the arithmetic honest AND keeps the
  // agreed figure legible, instead of making the reader choose which one is a lie.
  const incurredChargesTotal = feeRows.reduce(
    (s, f) => s + (feeActive(f) && INCURRED_FEE_TYPES.has(f.paymentType ?? '') ? (f.amount || 0) : 0), 0);
  const leaseAgreedTotal = paymentsGrandTotal - incurredChargesTotal;
  // ── Current payment plan (live) — what the customer is actually paying NOW,
  //    assembled from the contract's recorded rent cheques, fees, and deposit.
  //    Replaces the old origin-lead "offer" snapshot in the receipt modal.
  //    Contract money is whole AED; the modal expects fils, so ×100. ──
  const toFils = (aed: number) => Math.round((aed || 0) * 100);
  // Renewals carry the deposit from the original lease (read-only, never re-collected),
  // so it must not appear as a new line/instalment in the renewal's payment plan.
  const depositForPlan = contract.contractType === 'renewal'
    ? 0
    : (contract.securityDeposit?.amount
      ?? contract.securityDepositHeld ?? contract.securityDepositAmount ?? 0);
  let adminNet = 0, adminVat = 0, ejariNet = 0, ejariVat = 0, commNet = 0, commVat = 0;
  const customFees: { label: string; netFils: number; vatFils: number }[] = [];
  for (const f of feeRows) {
    const vat = f.vatAmount ?? 0;
    const net = (f.amount ?? 0) - vat;
    if (f.paymentType === 'admin_fee') { adminNet += net; adminVat += vat; }
    else if (f.paymentType === 'ejari_fee') { ejariNet += net; ejariVat += vat; }
    else if (f.paymentType === 'commission') { commNet += net; commVat += vat; }
    else customFees.push({ label: f.description || feeLabel(f.paymentType), netFils: toFils(net), vatFils: toFils(vat) });
  }
  const currentPlanItems: OfferPlan['items'] = [
    ...rentRows.map(p => ({
      amountFils: toFils(p.amount), vatFils: toFils(p.vatAmount ?? 0),
      dueDate: p.transactionDate ?? '', description: p.description ?? 'Rent',
      // Carry the real paymentType so the segregated PaymentPlanCard groups this
      // correctly (Rental Income) instead of falling through to Third Party.
      type: 'installment' as const, paymentType: p.paymentType ?? 'rental_income',
    })),
    ...feeRows.map(f => ({
      amountFils: toFils(f.amount), vatFils: toFils(f.vatAmount ?? 0),
      dueDate: f.transactionDate ?? '', description: f.description || feeLabel(f.paymentType),
      type: 'fee' as const, paymentType: f.paymentType ?? null,
    })),
    ...(depositForPlan > 0 ? [{
      amountFils: toFils(depositForPlan), vatFils: 0,
      dueDate: contract.securityDeposit?.dueDate ?? contract.securityDeposit?.recordedDate ?? '',
      description: 'Security deposit', type: 'security_deposit' as const, paymentType: 'security_deposit',
    }] : []),
  ].map((it, i) => ({ ...it, index: i + 1 }));
  // Headline rent = the contract's agreed current rent (annualRent is NET), so it
  // stays correct even before every cheque is recorded; the schedule below still
  // reflects the actual recorded cheques. VAT from the rate (commercial/industrial).
  const planRentNet = contract.annualRent || 0;
  const planRentVat = Math.round((planRentNet * (contract.rentVatRate ?? 0))) / 100;
  const currentPlan: OfferPlan = {
    totalAmountFils: toFils(planRentNet + planRentVat + feeGross + depositForPlan),
    rentFils: toFils(planRentNet),
    ...((contract.discountAmount ?? 0) > 0 && contract.listedRent != null
      ? { originalRentFils: toFils(contract.listedRent), discountFils: toFils(contract.discountAmount!) }
      : {}),
    installmentCount: rentRows.length || (contract.numberOfInstallments ?? 0),
    adminFeeFils: toFils(adminNet), adminFeeVatFils: toFils(adminVat),
    ejariFils: toFils(ejariNet), ejariVatFils: toFils(ejariVat),
    commissionFils: toFils(commNet), commissionVatFils: toFils(commVat),
    securityDepositFils: toFils(depositForPlan),
    rentVatRate: contract.rentVatRate ?? 0,
    rentVatFils: toFils(planRentVat),
    customFees,
    items: currentPlanItems,
  };
  // ── Upload document state (Flow 5) ──
  const docFileRef = useRef<HTMLInputElement>(null);
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan: scanDoc, scannerModal: docScannerModal } = useDocumentScanner();
  const [showUpload, setShowUpload] = useState(false);
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upType, setUpType] = useState('');
  const [upVisible, setUpVisible] = useState(false);
  // Whether the lease binder / landlord link will carry this document. Asked at
  // upload time (owner's call, 28 Sep 2026); pre-set from the default rule for
  // the picked type + section, and `upLandlordTouched` works like
  // upSectionTouched — an untouched control sends nothing, so the row stays on
  // the default rule (portal_hidden NULL) instead of freezing today's default.
  const [upLandlord, setUpLandlord] = useState(true);
  const [upLandlordTouched, setUpLandlordTouched] = useState(false);
  const landlordDefaultFor = (section: DocSection, key: string) =>
    section === 'kyc' ? true : landlordLinkShowsByDefault({ ownerType: 'tenancy_contract', documentKey: key });
  const [upExpiry, setUpExpiry] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  // What to CALL this particular file. The type says what kind of document it is
  // — one catalogue key, so every slot and checklist still matches — while the
  // name says which one: an NOC is a Vehicle NOC or a Property NOC, and the
  // reader needs to know which without opening it. Blank falls back to the
  // type's label, which is exactly what every upload did before.
  const [upName, setUpName] = useState('');
  // Document-type combobox. The list runs to ~60 entries, so it is searched
  // rather than scrolled; `upTypeQuery` doubles as the input's display value and
  // holds the chosen label whenever the menu is shut.
  const [upTypeQuery, setUpTypeQuery] = useState('');
  const [upTypeMenuOpen, setUpTypeMenuOpen] = useState(false);
  // The section the RP is filing under. Pre-selected from the picked type — the
  // catalogue knows a Passport is usually KYC — but theirs to change: only the
  // person holding the file knows whether THIS bank statement vets the customer
  // or evidences a payment on this lease. `upSectionTouched` keeps a deliberate
  // choice from being overwritten when they then switch document type.
  const [upSection, setUpSection] = useState<DocSection>('tenancy');
  const [upSectionTouched, setUpSectionTouched] = useState(false);
  // The stored document a binder "Replace" is superseding. Every upload used to
  // mint a fresh `${key}_${Date.now()}` row, so "Replace" on the Payment
  // Confirmation stacked a second (then third) file beside the one it was
  // meant to supersede — the slot flipped to "3 files · uploaded" and the
  // button to "Add". Carrying the row's own owner + key through to the POST
  // makes the backend's same-key upsert overwrite THAT row in place, keeping
  // its id (payments.document_id and audit rows point at it). Only honoured
  // while the picked type is still the slot the button was on — switching type
  // is a new document, not a replacement.
  const [upReplaceOf, setUpReplaceOf] = useState<{ slotKey: string; doc: ContractDoc } | null>(null);
  // Full mapped pack for the unit's category — KYC + commercial / industrial /
  // residential section (company promotions applied). Shown on new contracts;
  // renewals show only the re-verification slots (renewalDocs).
  const fullPackDocs = useMemo<DocReq[]>(
    // getRequiredDocs picks the identity pack by entity type — a company tenant
    // gets trade licence + authorised signatory, not personal KYC.
    () => getRequiredDocs(contract.unit.type, contract.tenant.entityType),
    [contract.unit.type, contract.tenant.entityType]);
  // Renewal-specific re-verification slots (empty for new contracts).
  const renewalDocs = useMemo<DocReq[]>(
    () => contract.contractType === 'renewal' ? getRenewalRequiredDocs(contract.unit.type) : [],
    [contract.contractType, contract.unit.type]);
  // Upload type picker = checklist types first (most relevant), then the
  // legacy generic types — so an upload lands on the exact checklist key. The
  // picker groups these by section, so "first" means first WITHIN its group.
  const DOC_TYPES = useMemo(() => {
    const fromChecklist: DocTypeOption[] = [];
    const seen = new Set<string>();
    for (const d of [...CONTRACT_DOCS, ...renewalDocs, ...fullPackDocs]) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      // A checklist key the catalogue doesn't carry (a renewal-only slot, say)
      // still gets a section — from its category, by the same rule.
      fromChecklist.push({
        value: d.key, label: d.label, category: d.category, needsExpiry: EXPIRY_DOC_KEYS.has(d.key),
        section: sectionForDocKey(d.key) ?? sectionForCategory(d.category),
      });
    }
    return [...fromChecklist, ...BASE_DOC_TYPES.filter(t => !seen.has(t.value))];
  }, [renewalDocs, fullPackDocs]);
  const uploadBoxRef = useRef<HTMLDivElement>(null);
  /** Checklist "Upload" / "Replace" → open the upload form with the slot's
   *  type preselected and pop the file picker. `replacing` = the stored row a
   *  binder "Replace" supersedes (see upReplaceOf); omitted for a plain upload. */
  const prefillUpload = (d: DocReq, replacing?: ContractDoc) => {
    setShowUpload(true);
    // Only preselect a type the picker actually knows — an unknown legacy key
    // would slip past submitUpload's lookup. Blank → the user picks the type.
    const known = DOC_TYPES.find(t => t.value === d.key);
    setUpType(known?.value ?? '');
    setUpTypeQuery(known?.label ?? '');
    setUpTypeMenuOpen(false);
    // A negative id is a cheque image synthesised from lead_cheques (contract
    // detail payload) — no documents row exists to overwrite, so it can only
    // be added beside. Only a real, type-known slot can be replaced in place.
    const target = replacing && replacing.id > 0 && known ? replacing : null;
    setUpReplaceOf(target ? { slotKey: known!.value, doc: target } : null);
    // Filing from a checklist row starts from that document's default section,
    // and the RP can still change it before saving. A replacement starts from
    // where the row is ALREADY filed — swapping the file is not a re-filing.
    const filedUnder = (target?.section === 'kyc' || target?.section === 'tenancy') ? target.section : null;
    setUpSection(filedUnder ?? known?.section ?? sectionForDocKey(d.key) ?? sectionForCategory(d.category));
    setUpSectionTouched(false);
    // Filling a named checklist slot — the slot's own wording is the right name.
    // A replacement keeps the name the row already carries (e.g. "Cheque 1")
    // unless it was just the slot label, which the type supplies anyway.
    setUpName(target?.displayName && normDocName(target.displayName) !== normDocName(d.label) ? target.displayName : '');
    // Same for visibility: the backend resets it on re-upload, so carry the
    // row's current setting into the form instead of silently going internal.
    setUpVisible(!!target?.isVisibleToTenant);
    setUpLandlord(target ? landlordLinkShows(target) : landlordDefaultFor(filedUnder ?? known?.section ?? sectionForDocKey(d.key) ?? sectionForCategory(d.category), d.key));
    setUpLandlordTouched(false);
    setUpExpiry('');
    setUpErr(null);
    requestAnimationFrame(() => {
      uploadBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      docFileRef.current?.click();
    });
  };
  const upSelected = DOC_TYPES.find(t => t.value === upType);
  const upShowExpiry = upSelected?.needsExpiry ?? false;
  /** The row this submit will overwrite — null once the type is changed away
   *  from the slot the Replace button was on (same rule submitUpload applies). */
  const upReplacing = upReplaceOf && upReplaceOf.slotKey === upType ? upReplaceOf.doc : null;
  // Types matching what has been typed. An empty query lists everything, so
  // opening the box still works as a plain browse.
  const upTypeMatches = useMemo(() => {
    const q = upTypeQuery.trim().toLowerCase();
    // The chosen label sits in the box; treat that as "no filter" so re-opening
    // shows the whole list rather than the one entry already selected.
    if (!q || q === DOC_TYPES.find(t => t.value === upType)?.label.toLowerCase()) return DOC_TYPES;
    return DOC_TYPES.filter(t => t.label.toLowerCase().includes(q));
  }, [upTypeQuery, upType, DOC_TYPES]);
  const pickUpType = (value: string) => {
    setUpType(value); setUpExpiry('');
    const t = DOC_TYPES.find(x => x.value === value);
    setUpTypeQuery(t?.label ?? '');
    if (t && !upSectionTouched) setUpSection(t.section);
    if (t && !upLandlordTouched) setUpLandlord(landlordDefaultFor(upSectionTouched ? upSection : t.section, value));
  };
  const submitUpload = async () => {
    if (!upFile || !upType) return;
    const meta = DOC_TYPES.find(t => t.value === upType)!;
    const replacing = upReplacing;
    setUpBusy(true); setUpErr(null);
    try {
      await onUploadDoc(
        upFile,
        { key: meta.value, label: upName.trim() || meta.label, category: meta.category, section: upSection },
        upVisible, upExpiry,
        replacing ? { ownerType: replacing.ownerType, ownerId: replacing.ownerId, documentKey: replacing.documentKey } : undefined,
        upLandlordTouched ? upLandlord : undefined,
      );
      setShowUpload(false); setUpFile(null); setUpType(''); setUpTypeQuery(''); setUpVisible(false); setUpExpiry('');
      setUpSection('tenancy'); setUpSectionTouched(false); setUpName(''); setUpReplaceOf(null);
      setUpLandlord(true); setUpLandlordTouched(false);
      if (docFileRef.current) docFileRef.current.value = '';
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUpBusy(false);
    }
  };
  // ── Request document state (Flow 6) ──
  const [reqLabel, setReqLabel] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqMenuOpen, setReqMenuOpen] = useState(false);
  const [showReqModal, setShowReqModal] = useState(false);
  /** Documents picked in the request popup (multi-select). */
  const [reqSelected, setReqSelected] = useState<string[]>([]);
  /** How many requests the last send recorded (drives the success note). */
  const [reqSent, setReqSent] = useState(0);
  const reqInputRef = useRef<HTMLInputElement>(null);
  /** Cross-lease document history popup (shared CustomerDocsModal). */
  const [showDocsHistory, setShowDocsHistory] = useState(false);
  /** "View all" popup — same modal, scoped to THIS contract's documents. */
  const [showContractDocs, setShowContractDocs] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  /** The cheque being handed back to the customer — the reason dialog is open. */
  const [returnFor, setReturnFor] = useState<ContractPayment | null>(null);
  /** The file a payment was recorded against — a paperclip beside its reference. */
  const attachmentOf = (docId?: number | null) => {
    if (docId == null) return null;
    const d = (contract.documents ?? []).find(x => x.id === docId);
    if (!d?.fileUrl) return null;
    return (
      <button type="button" title={`View attachment${d.displayName ? ` · ${d.displayName}` : ''}`}
        onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? 'Payment attachment' })}
        style={{ background: 'none', border: 0, padding: 0, marginLeft: 6, cursor: 'pointer', color: 'var(--jade-deep, #047246)', verticalAlign: 'middle' }}>
        <Paperclip size={12} />
      </button>
    );
  };
  const addReqDoc = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setReqSelected(prev => prev.some(x => x.toLowerCase() === n.toLowerCase()) ? prev : [...prev, n]);
    setReqLabel('');
    setReqMenuOpen(false);
  };
  const removeReqDoc = (name: string) =>
    setReqSelected(prev => prev.filter(x => x !== name));
  /** Checklist "Request" → open the request popup with that doc selected. */
  const prefillRequest = (d: DocReq) => {
    setReqSelected([d.label]);
    setReqLabel('');
    setReqNotes(d.hint ?? '');
    setReqMenuOpen(false);
    setReqErr(null);
    setReqSent(0);
    setShowReqModal(true);
  };
  const openBlankRequest = () => {
    setReqSelected([]); setReqLabel(''); setReqNotes(''); setReqErr(null); setReqMenuOpen(false); setReqSent(0);
    setShowReqModal(true);
  };
  const submitRequest = async () => {
    // Anything still typed in the search box counts as a selection too.
    const typed = reqLabel.trim();
    const labels = [...reqSelected];
    if (typed && !labels.some(l => l.toLowerCase() === typed.toLowerCase())) labels.push(typed);
    if (!labels.length) return;
    setReqBusy(true); setReqErr(null);
    try {
      for (const label of labels) await onRequestDoc(label, reqNotes.trim());
      setReqSelected(labels);
      setReqLabel('');
      setReqSent(labels.length);
    } catch (e) {
      setReqErr(e instanceof Error ? e.message : 'Failed to send request');
    } finally {
      setReqBusy(false);
    }
  };
  // Which sections are on screen: all of them inline, the active tab in the
  // drawer — and in tabbed mode (inline layout) only the active tab.
  const show = (k: DrawerTab) => (tabbed ? tab === k : (inline || tab === k));
  const recordTabs = tabbed ? leaseRecordTabs({ financeOnly, notesCount: notes.length, emails, hasLegal: !!legal, hasTenant: contract.tenant.id != null }) : [];
  return (
    <>
      {tabbed && tabBar && recordTabs.length > 1 && (
        <div className="rtabs" role="tablist">
          {recordTabs.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              className={'rtab ' + (tab === t.key ? 'on' : '')} onClick={() => setTab(t.key)}>
              {(() => { const Ic = DRAWER_TABS.find(d => d.key === t.key)?.icon; return Ic ? <Ic size={15} aria-hidden="true" /> : null; })()}
              {t.label}{t.count != null && <span className="n">{t.count}</span>}
            </button>
          ))}
        </div>
      )}
      {/* Backdrop only exists in drawer mode — in inline mode it would cover
          the whole page and swallow every click. */}
      {!inline && <div className={'scrim ' + (open ? 'open' : '')} onClick={onClose} />}
      <div className={inline ? 'sections-inline' : 'drawer ' + (open ? 'open' : '')}>
        {!inline && (
          <div className="dh">
            <span className="t">Contract details</span>
            <button className="x" onClick={onClose}><X size={18} /></button>
          </div>
        )}
        {!inline && (
          <div className="dtabs">
            {DRAWER_TABS.filter(({ key }) => (key !== 'emails' || !!emails?.showEmails) && (key !== 'whatsapp' || !!emails?.showWhatsapp)).map(({ key, label, icon: Ic }) => (
              <button key={key} className={'dtab ' + (tab === key ? 'on' : '')} onClick={() => setTab(key)}>
                <Ic size={13} /> {label}
              </button>
            ))}
          </div>
        )}
        <div className={inline ? ('dbody-inline' + (tabbed ? ' tabbed' : '')) : 'dbody'}>
          {/* Parties section removed (CEO: customer name + phone live in the
              page header; landlord details live on the settings page). */}
          {!inline && tab === 'property' && (
            <div className="sec">
              <div className="sech"><span className="si"><Building2 size={16} /></span><span className="st">Property &amp; unit</span></div>
              <div className="secb">
                <DRow k="Building"  v={contract.property.buildingName} />
                <DRow k="Community" v={contract.property.community} />
                <DRow k="Emirate"   v={contract.property.emirate} />
                <DRow k="Unit"      v={contract.unit.number ? `Unit ${contract.unit.number}` : null} />
                <DRow k="Type"      v={contract.unit.type} />
                <DRow k="Floor"     v={contract.unit.floor} />
                <DRow k="Bedrooms"  v={contract.unit.bedrooms} />
                <DRow k="Bathrooms" v={contract.unit.bathrooms} />
              </div>
            </div>
          )}
          {/* Rental period moved to the page-top info bar (next to the customer). */}
          {show('payments') && (
            <>
              {/* ── Security deposit — its OWN section, above the payments ledger ──
                  It used to be the first rail INSIDE the Payments table, which put
                  money the landlord is holding on behalf of the customer in the
                  same list as money the customer owes, and let a deposit be
                  recorded two different ways depending on which row the table
                  found first. A deposit is a liability held, not income: it has a
                  settlement, a proof, a held→returned lifecycle and it carries
                  across a renewal, none of which a rent cheque has. */}
              {returnFor && (
                <ReturnChequeDialog
                  what={`${returnFor.chequeNumber ? `Cheque ${returnFor.chequeNumber}` : `Payment #${returnFor.id}`} · ${fmtAed(returnFor.amount)}`}
                  onClose={() => setReturnFor(null)}
                  onConfirm={async (reason, note, file) => {
                    if (!onCustody) return;
                    const documentId = file
                      ? await uploadLeaseDocument(contract.id, file, { key: 'cheque_return', label: `Cheque returned${returnFor.chequeNumber ? ` · ${returnFor.chequeNumber}` : ''}` })
                      : undefined;
                    await onCustody([returnFor.id], 'returned', { reason, note, documentId });
                  }}
                />
              )}
              <span id="sec-deposit" />
              <ContractDepositSection
                deposit={contract.securityDeposit ?? null}
                agreedAmount={contract.securityDepositAmount ?? null}
                contractBase={contractBase}
                refs={paymentRefs}
                perms={perms}
                adding={depAdding}
                editing={depEditing}
                busy={depBusy}
                statusBusy={depStatusBusy}
                err={depErr}
                statusErr={depStatusErr}
                form={depForm}
                setForm={setDepForm}
                onStartAdd={startDepAdd}
                onStartEdit={startDepEdit}
                onCancel={() => { setDepAdding(false); setDepEditing(false); setDepErr(null); }}
                onSaveNew={saveNewDep}
                onSaveEdit={saveDep}
                onChangeStatus={changeDepStatus}
              />
              <span id="sec-payments" />
              <div className="sec">
                <div className="sech">
                  <span className="si"><CreditCard size={16} /></span>
                  <span className="st">Payments</span>
                </div>
                <div className="secb">
                  <table className="ptable" style={{ tableLayout: 'fixed' }}>
                    <PayCols />
                    <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                    <tbody>
                      {/* Counted the way the rows now read: the instalments, then
                          the payments made against a bounce among them — "6
                          cheques" against a schedule numbered 1–4 invited the
                          reader to hunt for two missing instalments. */}
                      <PaySegRail title="Rental Income" extra={rentScheduleRows.length
                        ? `${rentRowNumber.size} cheque${rentRowNumber.size === 1 ? '' : 's'}`
                          + (rentReplacementCount ? ` · ${rentReplacementCount} replacement${rentReplacementCount === 1 ? '' : 's'}` : '')
                        : undefined} onAdd={perms.collections ? () => openRecordFor('rental_income') : undefined} />
                      {rentScheduleGroups.map(({ row: p, depth, parent }) => (
                        <Fragment key={p.id}>
                        {/* A bounce and the payments made against it are shown as
                            one tinted block — the replacements indented beneath
                            the cheque they settle, instead of scattered to their
                            own due dates. See chequeReplacementGroups.ts. */}
                        <tr className={depth > 0 ? 'replgrp replkid' : rentGroupHeadIds.has(p.id) ? 'replgrp' : undefined}>
                          <td>
                            {depth > 0
                              ? <span className="replarrow" title="Recorded against the bounced cheque above">↳</span>
                              : rentRowNumber.get(p.id)}
                          </td>
                          <td style={depth > 0 ? { paddingLeft: 8 + Math.min(depth, MAX_REPLACEMENT_DEPTH) * 16 } : undefined}>
                            {depth > 0 && <span className="repltag">Replacement</span>}
                            {p.description ?? '—'}
                            <ReceiptRefTag refs={paymentRefs} id={p.id} />
                            {/* Both ends of a bounce → replacement pair, so the
                                table itself says why a bounced cheque is no
                                longer being chased — and, when it is only part
                                paid, exactly how much is still short. */}
                            {(replacementsOf.get(p.id)?.length ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                {shortfallOf(p) > 1
                                  ? `Part-replaced — ${fmtAed(coveredOf(p.id))} of ${fmtAed(p.amount)} · ${fmtAed(shortfallOf(p))} still owed`
                                  : `Replaced by ${replacementsOf.get(p.id)!
                                      .map(r => (r.chequeNumber ? `cheque ${r.chequeNumber}` : `payment #${r.id}`))
                                      .join(' + ')}`}
                              </span>
                            )}
                            {/* The charge that came with the swap. It is linked
                                to this cheque so the ledger says what it was
                                for, and it is deliberately NOT counted as money
                                replacing the cheque — it is a fee, not rent. */}
                            {(chargesOf.get(p.id)?.length ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                Charge raised: {chargesOf.get(p.id)!.map(f => fmtAed(f.amount)).join(' + ')}
                              </span>
                            )}
                            {/* Why it was cancelled — the answer to "cancelled
                                against what?". A swapped cheque says so even
                                before its replacement has been recorded, so a
                                half-finished swap is visible rather than
                                looking like an ordinary void. */}
                            {(p.chequeStatus ?? '').toLowerCase() === 'cancelled' && p.cancellationReason && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                Cancelled — {CANCEL_REASON_WORD[p.cancellationReason] ?? p.cancellationReason}
                                {isSwapped(p) && (replacementsOf.get(p.id)?.length ?? 0) === 0
                                  ? ' · the payment that replaced it has not been recorded yet'
                                  : ''}
                              </span>
                            )}
                            {/* Spelled out only when the pair could NOT be shown
                                together — the bounce sits in another section, or
                                was filtered out of this table. Under its own
                                bounce the indent already says it. */}
                            {parent == null && replacedRow.get(p.id) && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>
                                {FEE_NOT_COVERAGE.has((p.paymentType ?? '').toLowerCase()) ? 'Charged against' : 'Replaces'}
                                {' '}{isSwapped(replacedRow.get(p.id)!) ? 'swapped' : 'bounced'}{' '}
                                {replacedRow.get(p.id)!.chequeNumber
                                  ? `cheque ${replacedRow.get(p.id)!.chequeNumber}`
                                  : `payment #${replacedRow.get(p.id)!.id}`}
                              </span>
                            )}
                          </td>
                          <td className="amt">
                            {fmtAed(p.amount)}
                            {/* A VAT cheque is entirely VAT — the "incl. X VAT" note only applies to a gross rent cheque. */}
                            {p.paymentType !== 'vat' && (p.vatAmount ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(p.vatAmount ?? 0)} VAT</span>
                            )}
                          </td>
                          <td className="ref" style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.chequeNumber ?? '—'}{p.bankName ? <span className="bank" style={{ fontFamily: 'inherit', color: 'var(--mute)', fontSize: 11 }}><span className="dot"> · </span>{p.bankName}</span> : null}{attachmentOf(p.documentId)}</td>
                          <td>{fmtMethod(p.paymentMethod)}<CustodyCell p={p} can={perms.collections} headOffice={perms.headOffice} onCustody={onCustody} onReturn={setReturnFor} proof={attachmentOf(p.returnedToCustomerDocumentId)} /></td>
                          <td>{fmtDate(p.transactionDate)}</td>
                          <td>
                            <div style={PAY_STATUS_CELL}>
                              {/* A bounce that has been made good still reads as
                                  a bounce — red, and named as one — because it
                                  is an event that happened: it carries a
                                  penalty and it belongs in the customer's
                                  payment history. Showing it as a green
                                  "Cleared" made it indistinguishable from a
                                  cheque that never failed. What it says instead
                                  is what became of it. Whether it is still OPEN
                                  WORK is a separate question, answered by
                                  cheque-replacement's coverage rule, not by
                                  this chip. The dropdown is withheld on those
                                  rows on purpose: flipping a settled bounce's
                                  status without first voiding its replacement
                                  would leave the rent counted twice. The stored
                                  status is unchanged underneath. */}
                              {chequeStatusDisplay(p).statusLocked ? (
                                <span className={'cstat ' + chequeStatusDisplay(p).tone}>
                                  {chequeStatusDisplay(p).label}
                                </span>
                              ) : perms.collections ? (
                                <StatusMenu
                                  className={'cstat ' + (p.chequeStatus ?? 'pending')}
                                  style={{ cursor: 'pointer' }}
                                  value={p.chequeStatus ?? 'pending'}
                                  disabled={statusBusy === p.id}
                                  onChange={e => {
                                    // Cancelling is the one status that needs a
                                    // reason, so it opens the picker below
                                    // rather than applying straight away.
                                    if (e.target.value === 'cancelled') startCancel(p);
                                    else void changeStatus(p.id, e.target.value);
                                  }}
                                >
                                  <option value="pending">Pending</option>
                                  <option value="cleared">Cleared</option>
                                  <option value="bounced">Bounced</option>
                                  <option value="cancelled">Cancelled…</option>
                                </StatusMenu>
                              ) : (
                                <span className={'cstat ' + (p.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                                  {p.chequeStatus ?? 'pending'}
                                </span>
                              )}
                              {/* Right beside the status that produced it: the
                                  moment a cheque clears it has a receipt, and
                                  the manager can send it without leaving the
                                  row. */}
                              <ReceiptDownload refs={paymentRefs} id={p.id} base={receiptBase} />
                              {perms.collections && p.chequeStatus !== 'cleared' && (
                                <button
                                  type="button"
                                  className="mini-btn view"
                                  title="Edit amount / reference / description"
                                  onClick={() => editingId === p.id ? setEditingId(null) : startEdit(p)}
                                >
                                  <Pencil size={12} /> Edit
                                </button>
                              )}
                              {/* The one action a bounced cheque actually needs.
                                  Recording the new cheque here links the pair, so
                                  the lease stops showing as in arrears. */}
                              {perms.collections && ((p.chequeStatus ?? '') === 'bounced' || isSwapped(p)) && shortfallOf(p) > 1 && (
                                <button
                                  type="button"
                                  className="mini-btn view row-act"
                                  title="Record the money the customer handed over against this cheque"
                                  onClick={() => openReplacementFor(p)}
                                >
                                  <CreditCard size={12} /> {coveredOf(p.id) > 0 ? 'Record balance' : 'Record replacement'}
                                </button>
                              )}
                              {/* The other half of the job: a payment already on
                                  the ledger being attributed to the bounce it
                                  paid off. Offered on any non-bounced row while
                                  a bounce is short — including CLEARED rows,
                                  which is the common shape (the money landed and
                                  was banked before anyone connected it), and the
                                  only route for a bounce cleared in two
                                  instalments: link each payment in turn. */}
                              {perms.collections && (p.chequeStatus ?? '') !== 'bounced' && !isSwapped(p)
                                && (linkTargetsFor(p.id).length > 0 || p.replacesPaymentId != null) && (
                                <button
                                  type="button"
                                  className="mini-btn view row-act"
                                  title={p.replacesPaymentId != null
                                    ? 'Change or remove which cheque this payment goes against'
                                    : 'Record that this payment goes against a bounced or swapped cheque'}
                                  onClick={() => linkingId === p.id ? setLinkingId(null) : startLink(p)}
                                >
                                  <Link2 size={12} /> {p.replacesPaymentId != null ? 'Linked' : 'Link to cheque'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {cancelId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Why is this cheque being cancelled?</p>
                                <div className="field" style={{ margin: 0 }}>
                                  <select
                                    className="input"
                                    value={cancelReason}
                                    onChange={e => setCancelReason(e.target.value as CancelReason)}
                                  >
                                    {CANCEL_REASONS.map(r => (
                                      <option key={r.key} value={r.key}>{r.label}</option>
                                    ))}
                                  </select>
                                  <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                    {CANCEL_REASONS.find(r => r.key === cancelReason)?.hint}
                                  </span>
                                </div>
                                <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 8 }}>
                                  A cancelled cheque is left out of every total whichever reason you pick — this records what became of it.
                                </span>
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={cancelBusy} onClick={() => void confirmCancel()}>
                                    <Check size={14} /> {cancelBusy ? 'Saving…' : 'Cancel this cheque'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={cancelBusy} onClick={() => setCancelId(null)}>Keep it</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {linkingId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Which cheque does this payment go against?</p>
                                <div className="field" style={{ margin: 0 }}>
                                  <select
                                    className="input"
                                    value={linkValue === '' ? '' : String(linkValue)}
                                    onChange={e => setLinkValue(e.target.value === '' ? '' : Number(e.target.value))}
                                  >
                                    <option value="">No — an ordinary cheque</option>
                                    {linkTargetsFor(p.id).map(({ row: b, owed }) => (
                                      <option key={b.id} value={b.id}>
                                        {b.chequeNumber ? `Cheque ${b.chequeNumber}` : `Payment #${b.id}`} · {fmtAed(owed)} still owed{(b.amount || 0) !== owed ? ` of ${fmtAed(b.amount)}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                    A cheque that bounced, or one the customer swapped. Several payments can go against one — link each as it arrives, and it stops being chased once they add up to it. Amounts, references and receipts are untouched.
                                  </span>
                                </div>
                                {linkErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{linkErr}</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={linkBusy} onClick={() => void saveLink(p.id)}>
                                    <Check size={14} /> {linkBusy ? 'Saving…' : 'Save link'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={linkBusy} onClick={() => { setLinkingId(null); setLinkErr(null); }}>Cancel</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {editingId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Correct cheque details</p>
                                <div className="field"><label>Description</label>
                                  <input className="input" value={editForm.description} placeholder="e.g. Instalment 1"
                                    onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                </div>
                                <div className="grid2">
                                  <div className="field"><label>{editForm.vatKind === 'split' ? 'Amount (AED) · VAT' : editForm.vatKind === 'all' ? 'Amount (AED) — all VAT' : 'Amount (AED)'}</label>
                                    {editForm.vatKind === 'split' ? (
                                      <AmountWithVat amount={editForm.amount} onAmount={a => setEditForm(v => ({ ...v, amount: a }))}
                                        mode={editForm.vatMode} onMode={m => setEditForm(v => ({ ...v, vatMode: m }))}
                                        vatOverride={editForm.vatOverride} onVatOverride={o => setEditForm(v => ({ ...v, vatOverride: o }))} />
                                    ) : (
                                      <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                        onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                    )}
                                  </div>
                                  <div className="field"><label>Due date</label>
                                    <input type="date" className="input" value={editForm.transactionDate}
                                      onChange={e => setEditForm(v => ({ ...v, transactionDate: e.target.value }))} />
                                  </div>
                                </div>
                                <div className="grid2">
                                  <div className="field"><label>Payment method</label>
                                    <select className="input" value={editForm.paymentMethod}
                                      onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                  </div>
                                  <div className="field"><label>Cheque / reference no.</label>
                                    <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                      onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                  </div>
                                </div>
                                {/* Attribute a payment ALREADY on the ledger to the
                                    bounce it pays off. The record-payment popup can
                                    only link at the moment of entry, and that is not
                                    how this usually happens: the money arrives, whoever
                                    is on collections books it as an ordinary cheque, and
                                    the connection to the bounce is made afterwards —
                                    often twice, when a customer clears a bounce in two
                                    instalments. Without this field that attribution had
                                    no home in the UI at all. */}
                                {perms.collections && (linkTargetsFor(p.id).length > 0 || editForm.replacesPaymentId !== '') && (
                                  <div className="field" style={{ marginTop: 10 }}>
                                    <label>Goes against a bounced cheque</label>
                                    <select
                                      className="input"
                                      value={editForm.replacesPaymentId === '' ? '' : String(editForm.replacesPaymentId)}
                                      onChange={e => setEditForm(v => ({ ...v, replacesPaymentId: e.target.value === '' ? '' : Number(e.target.value) }))}
                                    >
                                      <option value="">No — an ordinary cheque</option>
                                      {linkTargetsFor(p.id).map(({ row: b, owed }) => (
                                        <option key={b.id} value={b.id}>
                                          {b.chequeNumber ? `Cheque ${b.chequeNumber}` : `Payment #${b.id}`} · {fmtAed(owed)} still owed{(b.amount || 0) !== owed ? ` of ${fmtAed(b.amount)}` : ''}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                      {editForm.replacesPaymentId === ''
                                        ? 'Link this payment to a bounced cheque so the bounce stops being chased once the amounts against it add up.'
                                        : 'Several payments may go against one bounce — link each as it arrives. Choosing “No” here unlinks this one, and the bounce goes straight back to being owed.'}
                                    </span>
                                  </div>
                                )}
                                {showVat && (
                                  <p className="note" style={{ marginTop: 2 }}>VAT ({contract.rentVatRate ?? 0}%) is recalculated from the corrected amount automatically.</p>
                                )}
                                {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(p.id)}>
                                    <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                      {rentScheduleRows.length === 0 && (
                        <tr><td colSpan={7}><span className="note">No payments recorded yet.</span></td></tr>
                      )}
                      {rentScheduleRows.length > 1 && (
                        <PaySegTotalRow
                          label={showVat ? 'Rental Income total (incl. VAT)' : 'Rental Income total'}
                          amount={rentGross}
                          collected={clearedSum(rentScheduleRows)}
                          sub={showVat ? [{ label: 'Net rent', amount: rentNet }, { label: `VAT${(contract.rentVatRate ?? 0) > 0 ? ` (${contract.rentVatRate}%)` : ''}`, amount: rentVat }] : undefined}
                        />
                      )}
                    </tbody>
                  </table>

                  {/* Fees — admin / ejari / commission as their own line items,
                      separate from the rent schedule above. Admin-filled: the RP
                      adds / edits / removes them here; nothing is auto-fabricated. */}
                  <div style={{ marginTop: 18 }}>
                    {perms.collections && (feeRows.length === 0 && otherPaymentRows.length === 0) && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6 }}>
                        <button type="button" className="mini-btn view" title="Add a fee line" onClick={() => openFeeFor('admin_fee')}>
                          <Plus size={12} /> Add fee
                        </button>
                      </div>
                    )}
                    <table className="ptable ptable-fees" style={{ tableLayout: 'fixed' }}>
                      <PayCols />
                      <thead><tr><th>Fee</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                      <tbody>
                        {[...managementFeeRows, ...thirdPartyFeeRows].map((f, i) => (
                          <Fragment key={f.id}>
                          {i === 0 && managementFeeRows.length > 0 && <PaySegRail title="Management Fee" onAdd={perms.collections ? () => openFeeFor('admin_fee') : undefined} />}
                          {i === managementFeeRows.length && thirdPartyFeeRows.length > 0 && <PaySegRail title="Third Party" onAdd={perms.collections ? () => openFeeFor('ejari_fee') : undefined} />}
                          <tr>
                            <td className="feecol"><span>{feeLabel(f.paymentType)}</span></td>
                            {/* Receipt number under the description, as on the rent rows — the
                                first column is too narrow to hold it. The record view hides
                                the Fee column and names the fee here instead, only when the
                                description doesn't already say it. */}
                            <td>
                              {f.description ?? feeLabel(f.paymentType)}
                              {f.description && f.description.trim().toLowerCase() !== feeLabel(f.paymentType).toLowerCase() && (
                                <span className="note fee-kind" style={{ display: 'none', fontSize: 11 }}>{feeLabel(f.paymentType)}</span>
                              )}
                              <ReceiptRefTag refs={paymentRefs} id={f.id} />
                            </td>
                            <td className="amt">
                              {fmtAed(f.amount)}
                              {f.vatAmount ? <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(f.vatAmount)} VAT</span> : null}
                            </td>
                            <td className="ref" style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{f.chequeNumber ?? '—'}{attachmentOf(f.documentId)}</td>
                            <td>{f.paymentMethod ? fmtMethod(f.paymentMethod) : '—'}<CustodyCell p={f} can={perms.collections} headOffice={perms.headOffice} onCustody={onCustody} onReturn={setReturnFor} proof={attachmentOf(f.returnedToCustomerDocumentId)} /></td>
                            <td>{fmtDate(f.transactionDate)}</td>
                            <td>
                              <div style={PAY_STATUS_CELL}>
                                {perms.collections ? (
                                  <StatusMenu
                                    className={'cstat ' + (f.chequeStatus ?? 'pending')}
                                    style={{ cursor: 'pointer' }}
                                    value={f.chequeStatus ?? 'pending'}
                                    disabled={statusBusy === f.id}
                                    onChange={e => void changeStatus(f.id, e.target.value)}
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="cleared">Cleared</option>
                                    <option value="bounced">Bounced</option>
                                    <option value="cancelled">Cancelled</option>
                                  </StatusMenu>
                                ) : (
                                  <span className={'cstat ' + (f.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>
                                    {f.chequeStatus ?? 'pending'}
                                  </span>
                                )}
                                {/* The replacement fee's own receipt, on the row
                                    that raised it — the second of the two files a
                                    manager sends after a cheque fails. */}
                                <ReceiptDownload refs={paymentRefs} id={f.id} base={receiptBase} />
                                {/* A cleared fee is received money (and may carry an issued
                                    receipt number) — not editable once cleared.
                                    Fees are never DELETED from a lease: an agreed
                                    charge stays on the record and is corrected via
                                    Edit (or cancelled through Status), so the plan
                                    always reconciles against the receipts it issued. */}
                                {perms.collections && f.chequeStatus !== 'cleared' && (
                                  <button
                                    type="button"
                                    className="mini-btn view"
                                    title="Edit fee amount / VAT / method / reference / date"
                                    onClick={() => feeEditId === f.id ? setFeeEditId(null) : startFeeEdit(f)}
                                  >
                                    <Pencil size={12} /> Edit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {feeEditId === f.id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Edit {feeLabel(f.paymentType).toLowerCase()}</p>
                                  <div className="field"><label>Fee type</label>
                                    <select className="input" value={feeEdit.paymentType}
                                      onChange={e => {
                                        const nt = e.target.value;
                                        setFeeEdit(v => { const auto = feeAutoAmount(nt); return { ...v, paymentType: nt, ...(auto ? { amount: auto } : {}) }; });
                                      }}>
                                      {FEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{feeOptionLabel(o.value, o.label)}</option>)}
                                    </select>
                                    {feeAutoAmount(feeEdit.paymentType) && <p className="note" style={{ marginTop: 2 }}>Amount auto-filled from Settings → Rules ({fmtAed(Number(feeAutoAmount(feeEdit.paymentType)))}). Editable.</p>}
                                  </div>
                                  <div className="field"><label>Amount (AED) · VAT</label>
                                    <AmountWithVat amount={feeEdit.amount} onAmount={a => setFeeEdit(v => ({ ...v, amount: a }))}
                                      mode={feeEdit.vatMode} onMode={m => setFeeEdit(v => ({ ...v, vatMode: m }))}
                                      vatOverride={feeEdit.vatOverride} onVatOverride={o => setFeeEdit(v => ({ ...v, vatOverride: o }))} />
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Payment method</label>
                                      <select className="input" value={feeEdit.paymentMethod}
                                        onChange={e => setFeeEdit(v => ({ ...v, paymentMethod: e.target.value }))}>
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </div>
                                    <div className="field"><label>Cheque / reference no.</label>
                                      <input className="input" value={feeEdit.chequeNumber} placeholder="Cheque #, transfer ID…"
                                        onChange={e => setFeeEdit(v => ({ ...v, chequeNumber: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Due date</label>
                                      <input type="date" className="input" value={feeEdit.transactionDate}
                                        onChange={e => setFeeEdit(v => ({ ...v, transactionDate: e.target.value }))} />
                                    </div>
                                    <div className="field"><label>Description</label>
                                      <input className="input" value={feeEdit.description} placeholder={feeLabel(f.paymentType)}
                                        onChange={e => setFeeEdit(v => ({ ...v, description: e.target.value }))} />
                                    </div>
                                  </div>
                                  <p className="note" style={{ marginTop: 2 }}>Total charged: <strong>{fmtAed(feeFig(feeEdit).total)}</strong></p>
                                  {feeEditErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{feeEditErr}</p>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn btn-jade btn-sm" disabled={feeEditBusy} onClick={() => void saveFeeEdit(f.id)}>
                                      <Check size={14} /> {feeEditBusy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" disabled={feeEditBusy} onClick={() => { setFeeEditId(null); setFeeEditErr(null); }}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          {i === managementFeeRows.length - 1 && managementFeeRows.length > 1 && <PaySegTotalRow label="Management Fee total" amount={managementFeeTotal} collected={clearedSum(managementFeeRows)} />}
                          </Fragment>
                        ))}
                        {/* Custom "Other" charges (payment_type 'other') — per-unit taxes
                            and service fees, under Third Party. They are payments, so they
                            keep the payment status + edit controls (changeStatus / startEdit). */}
                        {thirdPartyFeeRows.length === 0 && otherPaymentRows.length > 0 && <PaySegRail title="Third Party" onAdd={perms.collections ? () => openFeeFor('ejari_fee') : undefined} />}
                        {otherPaymentRows.map(p => (
                          <Fragment key={p.id}>
                          <tr>
                            <td className="feecol"><span>Other</span></td>
                            <td>
                              {p.description ?? '—'}
                              {paymentRefs.receiptByPaymentId[p.id] && (
                                <span className="note" title="Issued receipt number — for bank reconciliation" style={{ display: 'block', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', color: '#0f4f36', marginTop: 2 }}>
                                  Receipt {paymentRefs.receiptByPaymentId[p.id]}
                                </span>
                              )}
                            </td>
                            <td className="amt">
                              {fmtAed(p.amount)}
                              {(p.vatAmount ?? 0) > 0 && <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(p.vatAmount ?? 0)} VAT</span>}
                            </td>
                            <td className="ref" style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.chequeNumber ?? '—'}{p.bankName ? <span className="bank" style={{ fontFamily: 'inherit', color: 'var(--mute)', fontSize: 11 }}><span className="dot"> · </span>{p.bankName}</span> : null}{attachmentOf(p.documentId)}</td>
                            <td>{p.paymentMethod ? fmtMethod(p.paymentMethod) : '—'}<CustodyCell p={p} can={perms.collections} headOffice={perms.headOffice} onCustody={onCustody} onReturn={setReturnFor} proof={attachmentOf(p.returnedToCustomerDocumentId)} /></td>
                            <td>{fmtDate(p.transactionDate)}</td>
                            <td>
                              <div style={PAY_STATUS_CELL}>
                                {perms.collections ? (
                                  <StatusMenu
                                    className={'cstat ' + (p.chequeStatus ?? 'pending')}
                                    style={{ cursor: 'pointer' }}
                                    value={p.chequeStatus ?? 'pending'}
                                    disabled={statusBusy === p.id}
                                    onChange={e => void changeStatus(p.id, e.target.value)}
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="cleared">Cleared</option>
                                    <option value="bounced">Bounced</option>
                                    <option value="cancelled">Cancelled</option>
                                  </StatusMenu>
                                ) : (
                                  <span className={'cstat ' + (p.chequeStatus ?? 'pending')} style={{ textTransform: 'capitalize' }}>{p.chequeStatus ?? 'pending'}</span>
                                )}
                                <ReceiptDownload refs={paymentRefs} id={p.id} base={receiptBase} />
                                {perms.collections && p.chequeStatus !== 'cleared' && (
                                  <button type="button" className="mini-btn view" title="Edit amount / reference / description" onClick={() => editingId === p.id ? setEditingId(null) : startEdit(p)}>
                                    <Pencil size={12} /> Edit
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {editingId === p.id && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Correct charge details</p>
                                  <div className="field"><label>Description</label>
                                    <input className="input" value={editForm.description} placeholder="e.g. 5% VAT on Rent"
                                      onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>{editForm.vatKind === 'split' ? 'Amount (AED) · VAT' : editForm.vatKind === 'all' ? 'Amount (AED) — all VAT' : 'Amount (AED)'}</label>
                                      {editForm.vatKind === 'split' ? (
                                        <AmountWithVat amount={editForm.amount} onAmount={a => setEditForm(v => ({ ...v, amount: a }))}
                                          mode={editForm.vatMode} onMode={m => setEditForm(v => ({ ...v, vatMode: m }))}
                                          vatOverride={editForm.vatOverride} onVatOverride={o => setEditForm(v => ({ ...v, vatOverride: o }))} />
                                      ) : (
                                        <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                          onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                      )}
                                    </div>
                                    <div className="field"><label>Due date</label>
                                      <input type="date" className="input" value={editForm.transactionDate}
                                        onChange={e => setEditForm(v => ({ ...v, transactionDate: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Payment method</label>
                                      <select className="input" value={editForm.paymentMethod}
                                        onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </div>
                                    <div className="field"><label>Cheque / reference no.</label>
                                      <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                        onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                    </div>
                                  </div>
                                  {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(p.id)}>
                                      <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                        {(thirdPartyFeeRows.length + otherPaymentRows.length) > 1 && <PaySegTotalRow label="Third Party total" amount={thirdPartyTotal} collected={clearedSum([...thirdPartyFeeRows, ...otherPaymentRows])} />}
                        {feeRows.length === 0 && otherPaymentRows.length === 0 && !showAddFee && (
                          <tr><td colSpan={7}><span className="note">No fees recorded. Use <strong>Add fee</strong> to enter admin, contract registration, or commission charges — amounts are not auto-calculated.</span></td></tr>
                        )}
                      </tbody>
                    </table>

                    {/* Add-fee popup (admin-filled) */}
                    {showAddFee && (
                      <div className="mscrim" onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}>
                        <div className="modal sm" onClick={e => e.stopPropagation()}>
                          <div className="mh">
                            <span className="mt"><span className="mti" style={{ background: 'var(--jade)' }}><Plus size={16} /></span> Add fee</span>
                            <button className="x" onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}><X size={17} /></button>
                          </div>
                          <div className="mb">
                        <div className="grid2">
                          <div className="field"><label>Fee type</label>
                            <select className="input" value={feeAdd.paymentType}
                              onChange={e => {
                                const nt = e.target.value;
                                setFeeAdd(v => { const auto = feeAutoAmount(nt); return { ...v, paymentType: nt, ...(auto ? { amount: auto } : {}) }; });
                              }}>
                              {FEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{feeOptionLabel(o.value, o.label)}</option>)}
                            </select>
                            {feeAutoAmount(feeAdd.paymentType) && <p className="note" style={{ marginTop: 2 }}>Auto-filled from Settings → Rules ({fmtAed(Number(feeAutoAmount(feeAdd.paymentType)))}). Editable.</p>}
                          </div>
                          <div className="field"><label>Amount (AED) · VAT</label>
                            <AmountWithVat amount={feeAdd.amount} placeholder="e.g. 750" onAmount={a => setFeeAdd(v => ({ ...v, amount: a }))}
                              mode={feeAdd.vatMode} onMode={m => setFeeAdd(v => ({ ...v, vatMode: m }))}
                              vatOverride={feeAdd.vatOverride} onVatOverride={o => setFeeAdd(v => ({ ...v, vatOverride: o }))} />
                          </div>
                        </div>
                        <div className="grid2">
                          <div className="field"><label>Due date</label>
                            <input type="date" className="input" value={feeAdd.transactionDate}
                              onChange={e => setFeeAdd(v => ({ ...v, transactionDate: e.target.value }))} />
                          </div>
                        </div>
                        <div className="grid2">
                          <div className="field"><label>Payment method</label>
                            <select className="input" value={feeAdd.paymentMethod} onChange={e => setFeeAdd(v => ({ ...v, paymentMethod: e.target.value }))}>
                              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                          </div>
                          <div className="field"><label>Cheque / reference no.</label>
                            <input className="input" value={feeAdd.chequeNumber} placeholder="Cheque #, transfer ID…"
                              onChange={e => setFeeAdd(v => ({ ...v, chequeNumber: e.target.value }))} />
                          </div>
                          <div className="field"><label>Attachment — {feeAdd.paymentMethod === 'cheque' ? 'cheque copy' : feeAdd.paymentMethod === 'bank_transfer' ? 'transfer receipt' : 'receipt'} (optional)</label>
                            <input type="file" className="input" accept="image/*,application/pdf" onChange={e => setFeeFile(e.target.files?.[0] ?? null)} />
                          </div>
                        </div>
                        <div className="field"><label>Description (optional)</label>
                          <input className="input" value={feeAdd.description} placeholder={feeLabel(feeAdd.paymentType)}
                            onChange={e => setFeeAdd(v => ({ ...v, description: e.target.value }))} />
                        </div>
                        <p className="note" style={{ marginTop: 2 }}>Total charged: <strong>{fmtAed(feeFig(feeAdd).total)}</strong></p>
                        {feeAddErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{feeAddErr}</p>}
                          </div>
                          <div className="mf">
                            <button className="btn btn-ghost btn-sm" disabled={feeAddBusy} onClick={() => { setShowAddFee(false); setFeeAddErr(null); setFeeAdd(emptyFeeForm); }}>Cancel</button>
                            <button className="btn btn-jade btn-sm" disabled={feeAddBusy} onClick={() => void submitAddFee()}><Check size={14} /> {feeAddBusy ? 'Adding…' : 'Add fee'}</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Grand total — all four segments summed (deposit · rent · management · third party).
                      When the lease has incurred penalties, the agreed figure is shown
                      above it: one number cannot answer both "what was this agreed at?"
                      and "what has been charged on it?", and collapsing them let a
                      bounced cheque restate the rent. */}
                  <div className="gtot" style={{ marginTop: 16, padding: '11px 14px', borderRadius: 10, background: '#eef2f0', border: '1px solid #cfdcd6' }}>
                    {incurredChargesTotal > 0 && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 7 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#5f6b63' }}>Lease Total</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#14201a', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(leaseAgreedTotal)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 9, borderBottom: '1px dashed #cfdcd6' }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#5f6b63' }}>Charges incurred</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#b3541e', fontVariantNumeric: 'tabular-nums' }}>+ {fmtAed(incurredChargesTotal)}</span>
                        </div>
                      </>
                    )}
                    <div className="gtot-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: incurredChargesTotal > 0 ? 9 : 0 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#5f6b63' }}>Grand Total</span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: '#0f4f36', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(paymentsGrandTotal)}</span>
                    </div>
                  </div>

                  {/* Record-payment popup (Flow 1) */}
                  {showRec && (
                    <div className="mscrim" onClick={() => { setShowRec(false); setRecErr(null); }}>
                      <div className="modal sm" onClick={e => e.stopPropagation()}>
                        <div className="mh">
                          <span className="mt"><span className="mti" style={{ background: 'var(--jade)' }}><CreditCard size={16} /></span> New payment</span>
                          <button className="x" onClick={() => { setShowRec(false); setRecErr(null); }}><X size={17} /></button>
                        </div>
                        <div className="mb">
                      <div className="grid2">
                        <div className="field"><label>Type</label>
                          <select className="input" value={rec.paymentType} onChange={e => setRec(v => ({ ...v, paymentType: e.target.value }))}>
                            {REC_TYPE_OPTIONS.filter(o => recTypes.includes(o.value)).map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field"><label>Method</label>
                          <select className="input" value={rec.paymentMethod} onChange={e => setRec(v => ({ ...v, paymentMethod: e.target.value }))}>
                            <option value="cheque">Cheque</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                            <option value="online">Online</option>
                          </select>
                        </div>
                      </div>
                      <div className="field"><label>Description</label>
                        <input className="input" value={rec.description} placeholder={`Instalment ${rentRows.length + 1}`} onChange={e => setRec(v => ({ ...v, description: e.target.value }))} />
                      </div>
                      <div className="grid2">
                        <div className="field"><label>{rec.paymentType === 'rental_income' ? 'Amount (AED) · VAT' : 'Amount (AED)'}</label>
                          {rec.paymentType === 'rental_income' ? (
                            <AmountWithVat amount={rec.amount} onAmount={a => setRec(v => ({ ...v, amount: a }))}
                              mode={rec.vatMode} onMode={m => setRec(v => ({ ...v, vatMode: m }))}
                              vatOverride={rec.vatOverride} onVatOverride={o => setRec(v => ({ ...v, vatOverride: o }))} />
                          ) : (
                            <input type="number" min="0" step="0.01" className="input" value={rec.amount} onChange={e => setRec(v => ({ ...v, amount: e.target.value }))} />
                          )}
                          {rec.paymentType === 'rental_income' && rec.vatMode !== 'none' && rentVatOnOwnRow && (
                            <p className="note" style={{ marginTop: 4, color: 'var(--brick)' }}>This lease already collects rent VAT on its own row — adding VAT here charges it twice.</p>
                          )}
                        </div>
                        <div className="field"><label>Cheque / reference no.</label>
                          <input className="input" value={rec.chequeNumber} placeholder="Cheque #, transfer ID…" onChange={e => setRec(v => ({ ...v, chequeNumber: e.target.value }))} />
                        </div>
                      </div>
                      <div className="field" style={{ margin: 0 }}><label>Date</label>
                        <input type="date" className="input" value={rec.transactionDate} onChange={e => setRec(v => ({ ...v, transactionDate: e.target.value }))} />
                      </div>
                      <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                        <label>Attachment — {rec.paymentMethod === 'cheque' ? 'cheque copy' : rec.paymentMethod === 'bank_transfer' ? 'transfer receipt' : 'receipt'} (optional)</label>
                        <input type="file" className="input" accept="image/*,application/pdf" onChange={e => setRecFile(e.target.files?.[0] ?? null)} />
                      </div>
                      {/* Offered only when there is a failed cheque left to
                          settle — one that bounced, or one the customer swapped.
                          A linked payment takes the original off the "Overdue /
                          Bounced" KPI, the manager's action list and the arrears
                          totals — so nobody chases rent that has been made good. */}
                      {(unreplacedBounced.length > 0 || rec.replacesPaymentId !== '') && (
                        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                          <label>Goes against a bounced or swapped cheque</label>
                          <select
                            className="input"
                            value={rec.replacesPaymentId === '' ? '' : String(rec.replacesPaymentId)}
                            onChange={e => {
                              const id = e.target.value === '' ? '' : Number(e.target.value);
                              const target = id === '' ? null : payments.find(b => b.id === id) ?? null;
                              setRec(v => ({
                                ...v,
                                replacesPaymentId: id,
                                // Follow the row chosen: clearing the link clears
                                // the charge, and switching between a bounce and a
                                // swap switches which rule prefills it.
                                replacementFee: target == null ? ''
                                  : feeAutoAmount(isSwapped(target) ? 'cheque_replacement_fee' : 'bounced_cheque_fee'),
                              }));
                            }}
                          >
                            <option value="">No — this is a new cheque</option>
                            {unreplacedBounced.map(b => (
                              <option key={b.id} value={b.id}>
                                {b.chequeNumber ? `Cheque ${b.chequeNumber}` : `Payment #${b.id}`} · {fmtAed(shortfallOf(b))} still owed{coveredOf(b.id) > 0 ? ` of ${fmtAed(b.amount)}` : ''}{b.transactionDate ? ` · due ${fmtDate(b.transactionDate)}` : ''}
                              </option>
                            ))}
                          </select>
                          {rec.replacesPaymentId !== '' && (
                            <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                              The original cheque stays in the ledger as history and stops counting as arrears once the amounts recorded against it add up to what it was for — pay it off in one payment or several.
                            </span>
                          )}
                        </div>
                      )}
                      {/* The charge that goes with the swap, raised in the same
                          action because that is how it happens: the customer
                          hands over the new money and settles the fee in one
                          conversation. Prefilled from Settings → Rules and
                          editable — clear it to nil and no fee is raised. It is
                          linked to the same cheque so the ledger says what it
                          was for, and it never counts as money replacing it. */}
                      {rec.replacesPaymentId !== '' && (
                        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                          <label>{recChargeLabel} (AED)</label>
                          <input
                            type="number" min="0" step="0.01" className="input"
                            value={rec.replacementFee}
                            placeholder="0.00"
                            onChange={e => setRec(v => ({ ...v, replacementFee: e.target.value }))}
                          />
                          <span className="note" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                            {recChargeAuto
                              ? `Auto-filled from Settings → Rules (${fmtAed(Number(recChargeAuto))}). Editable — clear it to charge nothing.`
                              : 'No rule is set for this charge in Settings → Rules. Enter an amount to raise one, or leave it empty.'}
                          </span>
                        </div>
                      )}
                      {recErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{recErr}</p>}
                        </div>
                        <div className="mf">
                          <button className="btn btn-ghost btn-sm" disabled={recBusy} onClick={() => { setShowRec(false); setRecErr(null); }}>Cancel</button>
                          <button className="btn btn-jade btn-sm" disabled={recBusy || !rec.amount} onClick={() => void submitRec()}><Check size={14} /> {recBusy ? 'Saving…' : 'Save payment'}</button>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
              {/* Payment documents (receipts / advices / invoices) live in the
                  Documents card below, under its Financial tab. */}
            </>
          )}
          {show('documents') && (() => {
            // Requested-but-not-uploaded placeholders (empty fileUrl) are open
            // asks, not files — keep them out of the lists; checklist slots
            // show "Requested — awaiting upload" for them instead.
            const pendingAsks = (contract.documents ?? []).filter(d => !d.fileUrl);
            const all = (contract.documents ?? []).filter(d => !!d.fileUrl);
            // ── Expected-documents checklist (same mapping the customer journey
            // uses — src/lib/docRequirements). New lease → KYC + the unit
            // category's pack (commercial / industrial / residential). Renewal →
            // only the re-verification docs; the full pack lives on the original
            // lease. Slots match uploads so the gaps are what need requesting.
            const isRenewal = contract.contractType === 'renewal';
            const norm = normDocName;
            // The Emirates ID is the one document where the two sides and the
            // legacy combined scan satisfy each other ON THIS CHECKLIST — the
            // same rule isDocKeySatisfied applies. It is deliberately NOT in the
            // catalogue's own aliases: that list also feeds the customer-journey
            // resolver, where letting one file satisfy two side slots would mark
            // a half-supplied EID complete.
            const EID_SIDE_ALIASES: Record<string, string[]> = {
              emirates_id_front: ['emirates_id'],
              emirates_id_back: ['emirates_id'],
              emirates_id: ['emirates_id_front', 'emirates_id_back'],
            };
            // A slot can hold several files (e.g. Payment Advice = every cheque
            // image the tenant uploaded). Newest first; RP uploads carry a
            // `_<timestamp>` suffix on the key — strip it so a Replace supersedes.
            const matchDocs = (key: string): ContractDoc[] => {
              // Every wording that means this document — the catalogue's key,
              // label and historical aliases — so an upload and a request for
              // the same document land on the same row.
              const accepted = [...acceptedNamesFor(key), ...(EID_SIDE_ALIASES[key] ?? [])];
              const baseKey = (d: ContractDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
              return all
                .filter(d => accepted.includes(baseKey(d)) || accepted.includes(norm(d.displayName)))
                .sort((a, b) => b.id - a.id);
            };
            const askedNames = new Set(pendingAsks.flatMap(d => [
              norm(d.documentKey).replace(/_\d{10,}$/, ''),
              norm(d.displayName),
            ]));
            // Match the "Requested — awaiting upload" badge on ANY wording of the
            // document, not just its current label, so a request saved under an
            // older name still marks the slot it is tracked on.
            const askedFor = (req: DocReq) =>
              [...acceptedNamesFor(req.key), ...(EID_SIDE_ALIASES[req.key] ?? [])].some(n => askedNames.has(n));
            // (Old intake checklist + renderDoc removed — the card body is now
            // the document binder; KYC/licenses live behind "View customer
            // documents". matchDoc / renderMissing below are reused by the
            // binder's doc-slots.)
            // Missing slots use the SAME row pattern as on-file documents —
            // icon, name, status, actions right — dashed border marks the gap.
            const renderMissing = (req: DocReq) => {
              const asked = askedFor(req);
              return (
                <div key={'missing-' + req.key} className={'docitem docmiss' + (req.required && !asked ? ' req' : '')} title={req.hint}>
                  <FileText size={14} />
                  <div>
                    <div className="dn">{req.label}</div>
                    <div className="ds">{asked ? 'Requested — awaiting upload' : req.required ? 'Missing — required' : 'Not uploaded — optional'}</div>
                  </div>
                  <div className="dacts">
                    <button type="button" className="mini-btn ok" onClick={() => prefillUpload(req)}>
                      <UploadCloud size={12} /> Upload
                    </button>
                    {!asked && (
                      <button type="button" className="mini-btn view" onClick={() => prefillRequest(req)}>
                        <Send size={12} /> Request
                      </button>
                    )}
                  </div>
                </div>
              );
            };
            // ── The card body shows the contract documents BINDER in the fixed
            // sequence. Upload-type slots reuse View/Replace/Upload; generated /
            // print items are link rows. KYC/licenses live behind the
            // "View customer documents" link.
            type BinderSlot =
              | { kind: 'doc'; key: string; label: string; fallbackHref?: string; fallbackSub?: string }
              | { kind: 'link'; key: string; label: string; sub: string; href: string | null };
            const moveOutShown = contract.status === 'terminated' || contract.termination?.response === 'accepted' || !!contract.vacateAtEnd;
            const receiptsReady = contract.pdcConfirmed || contract.status === 'active' || contract.contractActive;
            // Separate rent/fee VAT cheques (new model) are a federal (FTA) tax —
            // included as a page inside the one combined Receipts document below.
            const showGovtVat = payments.some(p => (p.paymentType ?? '').toLowerCase() === 'vat');
            const binderSeq: BinderSlot[] = [
              { kind: 'link', key: 'offer',          label: 'Payment Summary', sub: 'Current payment summary', href: null },
              // The same summary with every line split Net · VAT · Total, VAT on
              // the charge it is levied on (rent VAT under Rental Income). Only
              // where VAT is the customer's concern: a company, or a commercial /
              // industrial lease (owner, 26 Sep 2026).
              ...((contract.tenant.entityType === 'company' || isRentVatable(contract.unit.type, contract.property.spaceCategory))
                ? [{ kind: 'link' as const, key: 'vat_plan', label: 'Payment Summary with VAT', sub: 'Net, VAT and total for every line', href: currentPlan.totalAmountFils > 0 ? `${contractBase}/print/vat-plan` : null }]
                : []),
              { kind: 'doc',  key: 'payment_advice', label: 'Payment Confirmation' },
              // One file → all receipts inside (Rental Income · Security Deposit · Management Fee · Government fee).
              { kind: 'link', key: 'receipts',       label: 'Receipts', sub: [isRenewal ? 'Rental income' : 'Rental income, security deposit', 'management fee', showGovtVat ? 'Government fee' : null].filter(Boolean).join(', '), href: receiptsReady ? receiptBase : null },
              { kind: 'link', key: 'agreement',      label: 'Agreement', sub: 'Tenancy contract', href: `${contractBase}/print` },
              { kind: 'doc',  key: 'ejari_certificate', label: 'Contract Registration Certificate' },
            ];
            if (!isRenewal) {
              binderSeq.push({ kind: 'doc',  key: 'utility_registration', label: 'Utility Proof of Payment' });
              // Stored PDF once the inspection is counter-signed; live page until then.
              binderSeq.push({ kind: 'doc', key: 'move_in_report', label: 'Move-in', fallbackHref: `${contractBase}/inspection/v2?type=move_in`, fallbackSub: 'Move-in inspection report' });
            }
            if (moveOutShown) {
              binderSeq.push({ kind: 'doc', key: 'move_out_report', label: 'Move-out', fallbackHref: `${contractBase}/inspection/v2?type=move_out`, fallbackSub: 'Move-out inspection report' });
              binderSeq.push({ kind: 'doc',  key: 'utility_final_bill', label: 'Utility Final Bill' });
              binderSeq.push({ kind: 'doc', key: 'deposit_settlement', label: 'Final Settlement', fallbackHref: `${contractBase}/settlement`, fallbackSub: 'Security deposit settlement' });
            }
            // Payment Plan opens an in-app modal showing the contract's CURRENT
            // live plan (recorded rent cheques + fees + deposit), not an external link.
            const renderOfferSlot = (s: Extract<BinderSlot, { kind: 'link' }>) => (
              <div key={s.key} className="docitem approved">
                <FileText size={14} />
                <div>
                  <div className="dn">{s.label}</div>
                  <div className="ds">{s.sub}</div>
                </div>
                <div className="dacts">
                  {currentPlan.totalAmountFils > 0
                    ? <>
                        <button type="button" className="mini-btn view cursor-pointer" onClick={() => setShowOffer(true)}><ExternalLink size={12} /> View</button>
                        <Link href={`${contractBase}/print/plan`} target="_blank" className="mini-btn view"><Download size={12} /> PDF</Link>
                      </>
                    : <span className="ds" style={{ color: '#b8b5ae' }}>Not yet available</span>}
                </div>
              </div>
            );
            const renderLinkSlot = (s: Extract<BinderSlot, { kind: 'link' }>) => (
              <div key={s.key} className="docitem approved">
                <FileText size={14} />
                <div>
                  <div className="dn">{s.label}</div>
                  <div className="ds">{s.sub}</div>
                </div>
                <div className="dacts">
                  {s.href
                    ? <Link href={s.href} target="_blank" className="mini-btn view"><ExternalLink size={12} /> View</Link>
                    : <span className="ds" style={{ color: '#b8b5ae' }}>Not yet available</span>}
                </div>
              </div>
            );
            const renderDocSlot = (s: Extract<BinderSlot, { kind: 'doc' }>) => {
              const docs = matchDocs(s.key);
              const req: DocReq = { key: s.key, label: s.label, category: 'contract', required: false };
              if (docs.length === 0) {
                // No stored PDF yet — fall back to the live page (inspection / settlement)
                // so it's reachable until the artifact is completed + snapshotted.
                if (s.fallbackHref) return (
                  <div key={s.key} className="docitem approved">
                    <FileText size={14} />
                    <div>
                      <div className="dn">{s.label}</div>
                      <div className="ds">{s.fallbackSub ?? 'Generated on completion'}</div>
                    </div>
                    <div className="dacts">
                      <Link href={s.fallbackHref} target="_blank" className="mini-btn view"><ExternalLink size={12} /> View</Link>
                    </div>
                  </div>
                );
                // The finance-only record neither uploads nor requests — say it is
                // not there and stop.
                if (financeOnly) return (
                  <div key={s.key} className="docitem docmiss">
                    <FileText size={14} />
                    <div><div className="dn">{s.label}</div><div className="ds">Not uploaded</div></div>
                  </div>
                );
                return renderMissing(req);
              }
              const multi = docs.length > 1;
              const doc = docs[0];
              // Payment Advice = the customer's uploaded cheque copies. They are
              // cleared in the Cheques/PDC step (Mark as Collected), NOT doc-reviewed,
              // so they never sit in a "Pending review" state — always "Uploaded".
              const noReview = s.key === 'payment_advice';
              const ok  = noReview || ['approved', 'processed', 'complete'].includes(doc.status);
              // Contract paperwork is FILED, not reviewed — a past expiry date is a
              // fact about the document, never an outstanding review. Without this
              // branch 'expired' fell through to "Pending review", so every ended
              // lease's Contract Registration Certificate claimed a review nobody
              // owed. The certificate is still on file; say when it lapsed instead.
              const expired = !ok && doc.status === 'expired';
              const stt = ok || expired ? 'approved' : doc.status === 'rejected' ? 'rejected' : 'pending';
              // Say what actually happened: the file IS uploaded. "On file" was
              // jargon that read as a filing state rather than a plain fact.
              const lbl = multi
                ? `${docs.length} files · uploaded`
                : ok ? 'Uploaded'
                : expired ? (doc.expiryDate ? `Uploaded · expired ${fmtDate(doc.expiryDate)}` : 'Uploaded · expired')
                : doc.status === 'rejected' ? 'Rejected' : 'Pending review';
              return (
                <div key={s.key} className={'docitem ' + stt}>
                  <FileText size={14} />
                  <div>
                    <div className="dn">{s.label}</div>
                    <div className="ds">{lbl}</div>
                  </div>
                  <div className="dacts">
                    <button type="button" onClick={() => multi ? openDocsTogether(docs) : openDocViewer({ fileUrl: doc.fileUrl, caption: s.label })} className="mini-btn view cursor-pointer"><ExternalLink size={12} /> {multi ? 'View all' : 'View'}</button>
                    {/* Generated tenancy artifacts get a clean, watermark-free download of the stored snapshot. */}
                    {['move_in_report', 'move_out_report', 'deposit_settlement'].includes(s.key) && (
                      <DownloadDocButton documentId={doc.id} label="PDF" className="mini-btn view" />
                    )}
                    {/* One file on the slot → Replace overwrites THAT row in place
                        (same id). Several → Add puts another beside them. */}
                    {!financeOnly && (
                    <button type="button" className="mini-btn view" title={multi ? `Add another ${s.label}` : `Replace the ${s.label} on file`} onClick={() => prefillUpload(req, multi ? undefined : doc)}><UploadCloud size={12} /> {multi ? 'Add' : 'Replace'}</button>
                    )}
                    {/* Only when the slot holds ONE file. Several copies have no
                        single "this one" and a guess removes the wrong document;
                        the reader that lists them individually is where those go. */}
                    {perms.deleteDocuments && !multi && (
                      <DeleteDocumentButton docId={doc.id} label={s.label} onDeleted={onDocsChanged} />
                    )}
                  </div>
                </div>
              );
            };
            // Payment Summary popup — the contract's current live plan. Hoisted so the
            // finance-only card can open it too (owner, 23 Sep 2026: "not able to review").
            const offerModal = showOffer && (

                <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={() => setShowOffer(false)} />
                  <div style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
                    <button type="button" onClick={() => setShowOffer(false)} aria-label="Close"
                      style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, width: 28, height: 28, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 999, cursor: 'pointer', color: '#5f6b63' }}>✕</button>
                    <PaymentPlanCard
                      plan={currentPlan}
                      rows={segRowsFromContract(contract, payments)}
                      refLabel={contract.ref}
                      planRefNo={paymentRefs.planRefNo}
                      contractType={contract.contractType}
                      tenantName={contract.tenant.companyName || contract.tenant.name}
                      landlordName={contract.landlord.bankAccountName || contract.landlord.companyName || contract.landlord.name}
                      unitNumber={contract.unit.number}
                      buildingName={contract.property.buildingName}
                      community={contract.property.community || contract.property.emirate}
                      periodStart={contract.startDate}
                      periodEnd={contract.endDate}
                      bankDetails={contract.landlord.bankDetails}
                    />
                  </div>
                </div>
            );
            // What the header counts: every binder paper that can be opened now —
            // generated ones (summary, receipts, agreement, live inspection pages)
            // as well as uploaded files — not just uploads, which read "0" on a
            // binder full of documents.
            const slotReady = (b: BinderSlot) => b.kind === 'link'
              ? (b.key === 'offer' ? currentPlan.totalAmountFils > 0 : !!b.href)
              : matchDocs(b.key).length > 0 || !!b.fallbackHref;
            const readyCount = binderSeq.filter(slotReady).length;
            const toUpload = binderSeq.length - readyCount;
            if (financeOnly) {
              // The accountant's documents are the money papers only — the payment
              // summary, the customer's payment confirmation and the one Receipts
              // file (owner, 23 Sep 2026: "allow receipts also"). Read-only: no
              // upload, request, replace or history.
              const money = binderSeq.filter(b => b.key === 'offer' || b.key === 'vat_plan' || b.key === 'payment_advice' || b.key === 'receipts');
              return (
                <div className="sec">
                  <div className="sech"><span className="si"><Paperclip size={16} /></span><span className="st">Payment documents</span></div>
                  <div className="secb">
                    <div className="doclist">
                      {money.map(b => b.kind === 'doc' ? renderDocSlot(b) : b.key === 'offer' ? renderOfferSlot(b) : renderLinkSlot(b))}
                    </div>
                  </div>
                  {offerModal}
                </div>
              );
            }
            return (
              <>
              <div className="sec">
                <div className="sech">
                  <span className="si"><Paperclip size={16} /></span>
                  <span className="st">
                    Documents
                    <span className="doc-count" title={`${readyCount} of ${binderSeq.length} contract documents can be opened now${all.length ? ` · ${all.length} uploaded file${all.length === 1 ? '' : 's'}` : ''}`}>
                      <b>{readyCount}</b> of {binderSeq.length} ready
                    </span>
                    {toUpload > 0 && <span className="doc-count todo">{toUpload} to upload</span>}
                  </span>
                  {/* Each missing row carries its own Upload / Request — these are
                      for anything NOT on the list, so they stay quiet. */}
                  <div className="doc-hacts" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <Link href={`${contractBase}/documents`} target="_blank" rel="noopener noreferrer" className="mini-btn view" title="Every file on this contract, including ones not in the list below">
                      <ExternalLink size={12} /> All files
                    </Link>
                    <button type="button" className="mini-btn view" title="Upload a document that isn't in the list below" onClick={() => { setShowUpload(s => !s); setUpErr(null); setUpReplaceOf(null); }}>
                      <UploadCloud size={12} /> Upload other
                    </button>
                    <button type="button" className="mini-btn view" title="Ask the customer for a document that isn't in the list below" onClick={openBlankRequest}>
                      <Send size={12} /> Request other
                    </button>
                  </div>
                </div>
                <div className="secb">
                  {/* Customer file = the mapped checklist ONLY. Every other doc
                      (payment slips, invoices, attachments, extra KYC uploads)
                      lives in the "View all" popup, scoped to this contract —
                      so the card stays the checklist, not a doc dump. */}
                  <div>
                    {/* Checklist — new lease: full pack + the two universal
                        contract docs; renewal: only Contract Registration +
                        Payment Advice. Always non-empty (CONTRACT_DOCS). */}
                    <div className="doc-cap" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-neutral-400, #8a948d)', margin: '2px 0 6px' }}>
                      Contract binder
                    </div>
                    {isRenewal && (
                      <p className="note" style={{ margin: '0 0 8px' }}>
                        Renewal re-confirms the registration and the rent cheques.
                      </p>
                    )}
                    <div className="doclist">
                      {binderSeq.map(s => s.kind === 'doc' ? renderDocSlot(s) : s.key === 'offer' ? renderOfferSlot(s) : renderLinkSlot(s))}
                    </div>
                    {/* Everything else on this contract — one link, no inline dump. */}
                    <p className="note doc-foot" style={{ marginTop: 8 }}>
                      {contract.tenant.id != null && (
                        <button type="button" className="chain-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => setShowDocsHistory(true)}>
                          Document History
                        </button>
                      )}
                    </p>
                  </div>

                  {/* Customer KYC — review + approve / reject the identity docs on
                      this contract. Approve = verify; Reject prompts for a reason
                      the customer sees as their re-upload prompt (matches leads). */}
                  {kycDocs.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="doc-cap" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-neutral-400, #8a948d)', margin: '2px 0 6px' }}>
                        Customer KYC · review
                      </div>
                      <div className="doclist">
                        {kycDocs.map(d => {
                          // A REQUESTED document is a row with no file yet (status
                          // 'pending', file_url ''). There is nothing to view and
                          // nothing to review, so it must read as awaiting the
                          // customer's upload — "Pending review" claims a file
                          // arrived. Same rule as renderMissing above and the
                          // customer-documents popup.
                          const awaitingUpload = !d.fileUrl;
                          const ok = ['processed', 'complete'].includes(d.status);
                          const rejected = d.status === 'rejected';
                          const expired = d.status === 'expired';
                          const stt = awaitingUpload ? 'docmiss' : ok ? 'approved' : rejected ? 'rejected' : 'pending';
                          const lbl = docLabel(d, kycDocs);
                          const req: DocReq = { key: d.documentKey, label: lbl, category: d.category, required: false };
                          return (
                            <div key={d.id} className={'docitem ' + stt}>
                              <FileText size={14} />
                              <div>
                                <div className="dn">{lbl}</div>
                                <div className="ds">
                                  {awaitingUpload ? 'Not uploaded'
                                    : ok ? 'Approved'
                                    : rejected ? 'Rejected — re-upload requested'
                                    : expired ? (d.expiryDate ? `Expired ${fmtDate(d.expiryDate)} — awaiting a fresh copy` : 'Expired — awaiting a fresh copy')
                                    : 'Pending review'}
                                </div>
                              </div>
                              <div className="dacts">
                                {awaitingUpload ? (
                                  // Already asked for — the only action left on the
                                  // landlord's side is uploading a copy they were sent
                                  // directly (email/WhatsApp), which fills this slot.
                                  <button type="button" className="mini-btn ok cursor-pointer" title={`Upload the ${lbl} on the customer's behalf`} onClick={() => prefillUpload(req)}>
                                    <UploadCloud size={12} /> Upload
                                  </button>
                                ) : (
                                  <>
                                    <button type="button" className="mini-btn view cursor-pointer" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: lbl })}><ExternalLink size={12} /> View</button>
                                    {!ok && (
                                      <>
                                        <button type="button" className="mini-btn ok cursor-pointer" onClick={() => onApproveDoc(d.id)}><Check size={12} /> Approve</button>
                                        <button type="button" className="mini-btn view cursor-pointer" onClick={() => onRejectDoc(d.id, lbl)}><X size={12} /> Reject</button>
                                      </>
                                    )}
                                    {/* Rejecting sends it back for a re-upload and keeps
                                        the trail; removing takes it off the record. Both
                                        are offered because a document filed against the
                                        WRONG customer cannot be fixed by rejecting it. */}
                                    {perms.deleteDocuments && (
                                      <DeleteDocumentButton docId={d.id} label={lbl} onDeleted={onDocsChanged} />
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Upload document (Flow 5) — popup, matching the request modal */}
                  {showUpload && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true">
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={() => { setShowUpload(false); setUpErr(null); }} />
                      {/* Paired questions sit side by side — type|name, then the
                          two places it can go — so the whole form reads in three
                          rows instead of one long stack. */}
                      <div ref={uploadBoxRef} style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '16px 18px 12px', borderBottom: '1px solid #f0eee9' }}>
                          <div>
                            <p className="subhead" style={{ margin: 0 }}>{upReplacing ? `Replace ${upReplacing.displayName || upSelected?.label || 'document'}` : 'Upload a document'}</p>
                            <p className="note" style={{ margin: "2px 0 0" }}>
                              {upReplacing
                                ? 'The new file takes the place of the one on file — one document, not two.'
                                : <>{contract.ref} · {contract.tenant.name ?? "the customer"}</>}
                            </p>
                          </div>
                          <button type="button" className="mini-btn view" onClick={() => { setShowUpload(false); setUpErr(null); }}><X size={12} /></button>
                        </div>
                        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
                        <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                          onChange={e => {
                            const picked = e.target.files?.[0] ?? null;
                            if (!picked) { setUpFile(null); return; }
                            // Photos go through the scan modal; a cancelled scan
                            // clears the selection instead of staging the raw shot.
                            void scanDoc(picked).then(f => {
                              setUpFile(f);
                              if (!f && docFileRef.current) docFileRef.current.value = '';
                            });
                          }} />
                        {docScannerModal}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
                        {/* Searchable, because the list is ~60 entries long and a
                            native <select> makes you hunt. Same two section
                            groups the "File under" control below offers, so
                            picking a type also sets a sane default there. */}
                        <div className="field" style={{ position: 'relative', marginBottom: 0 }}>
                          <label>Document type</label>
                          <input
                            className="input" data-testid="up-doctype" role="combobox" aria-expanded={upTypeMenuOpen} aria-controls="v2-doctype-menu"
                            value={upTypeQuery}
                            placeholder="Search document types…"
                            onChange={e => { setUpTypeQuery(e.target.value); setUpTypeMenuOpen(true); }}
                            onFocus={e => { setUpTypeMenuOpen(true); e.currentTarget.select(); }}
                            onBlur={() => setTimeout(() => {
                              setUpTypeMenuOpen(false);
                              // Restore the chosen label — a half-typed query left
                              // in the box would read as the document's name.
                              setUpTypeQuery(DOC_TYPES.find(t => t.value === upType)?.label ?? '');
                            }, 150)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') { setUpTypeMenuOpen(false); return; }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const first = upTypeMatches[0];
                                if (first) { pickUpType(first.value); setUpTypeMenuOpen(false); }
                              }
                            }}
                          />
                          {upTypeMenuOpen && upTypeMatches.length > 0 && (
                            <div id="v2-doctype-menu" style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: '100%', maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #e4e9e5', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.10)' }}>
                              {SECTION_ORDER.map(sec => {
                                const opts = upTypeMatches.filter(t => t.section === sec);
                                if (opts.length === 0) return null;
                                return (
                                  <div key={sec}>
                                    <p style={{ margin: 0, padding: '6px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', color: '#8a948d', background: '#faf9f6', position: 'sticky', top: 0 }}>{SECTION_LABEL[sec]}</p>
                                    {opts.map(t => (
                                      <button
                                        key={t.value} type="button"
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => { pickUpType(t.value); setUpTypeMenuOpen(false); }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#eef7f2')}
                                        onMouseLeave={e => (e.currentTarget.style.background = t.value === upType ? '#eef1ef' : 'transparent')}
                                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#14201a', cursor: 'pointer', background: t.value === upType ? '#eef1ef' : 'transparent', border: 'none', fontWeight: t.value === upType ? 700 : 400 }}
                                      >
                                        <FileText size={12} style={{ color: '#8a948d', flexShrink: 0 }} /> {t.label}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {upTypeMenuOpen && upTypeMatches.length === 0 && (
                            <p className="note" style={{ marginTop: 4 }}>No document type matches &ldquo;{upTypeQuery.trim()}&rdquo;.</p>
                          )}
                        </div>
                        {/* The name this file is READ under. The type stays the
                            catalogue key so slots and checklists keep matching;
                            this says WHICH one it is — Vehicle NOC vs Property NOC. */}
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Document name <span style={{ fontWeight: 400, color: '#8a948d' }}>· optional</span></label>
                          <input
                            className="input" data-testid="up-docname" value={upName} maxLength={255}
                            placeholder={upSelected ? upSelected.label : 'e.g. Vehicle NOC'}
                            onChange={e => setUpName(e.target.value)}
                          />
                        </div>
                        </div>
                        <p className="note" style={{ margin: '4px 0 14px' }}>
                          {upName.trim()
                            ? <>Filed as <strong>{upName.trim()}</strong>.</>
                            : upSelected ? <>Leave the name blank to file it as &ldquo;{upSelected.label}&rdquo;.</> : 'One type, many papers — a Vehicle NOC and a Property NOC are both an NOC.'}
                        </p>
                        <button
                          type="button" onClick={() => docFileRef.current?.click()}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 16, borderRadius: 10, cursor: 'pointer', background: upFile ? 'var(--jade-tint, #eef9f4)' : '#faf9f6', border: `1px ${upFile ? 'solid' : 'dashed'} ${upFile ? 'var(--jade-deep, #047246)' : '#d9d5cd'}` }}
                        >
                          <UploadCloud size={16} style={{ color: upFile ? 'var(--jade-deep, #047246)' : '#8a948d', flexShrink: 0 }} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#14201a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {upFile ? upFile.name : 'Choose a file'}
                            </span>
                            <span style={{ display: 'block', fontSize: 11.5, color: '#5f6b63', marginTop: 1 }}>
                              {upFile ? `${(upFile.size / 1024).toFixed(0)} KB · click to replace` : 'PDF, Word or image'}
                            </span>
                          </span>
                        </button>
                        {upShowExpiry && (
                          <div className="field">
                            <label>Expiry date <span style={{ fontWeight: 400, color: 'var(--brick)' }}>· required for {upSelected?.label}</span></label>
                            <input type="date" className="input" value={upExpiry} onChange={e => setUpExpiry(e.target.value)} />
                          </div>
                        )}
                        {/* WHERE THE DOCUMENT WILL LIVE. Not a display preference:
                            Customer KYC files it against the customer, so it also
                            appears on their profile and on their other leases. */}
                        <div className="field">
                          <label>File under</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {SECTION_ORDER.map(sec => (
                              <label key={sec} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer', border: `1px solid ${upSection === sec ? 'var(--jade-deep, #047246)' : '#e4e9e5'}`, background: upSection === sec ? 'var(--jade-tint, #eef9f4)' : '#fff', borderRadius: 10, padding: '8px 10px' }}>
                                <input
                                  type="radio" name="v2DocSection" data-testid={`up-section-${sec}`} checked={upSection === sec} style={{ marginTop: 2 }}
                                  onChange={() => { setUpSection(sec); setUpSectionTouched(true); if (!upLandlordTouched) setUpLandlord(landlordDefaultFor(sec, upType)); }}
                                />
                                <span>
                                  <span style={{ fontWeight: 600 }}>{SECTION_LABEL[sec]}</span>
                                  <span style={{ display: 'block', fontSize: 11.5, color: '#5f6b63', marginTop: 1 }}>
                                    {sec === 'kyc'
                                      ? `Files against ${contract.tenant.name ?? 'the customer'} — shows on their profile and on every lease of theirs.`
                                      : 'Files against this lease only — on the customer profile it appears under History Documents.'}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                          {upSelected && upSection !== upSelected.section && (
                            <p className="note" style={{ marginTop: 6 }}>
                              Filed as {SECTION_LABEL[upSection]} rather than the usual {SECTION_LABEL[upSelected.section]} for {upSelected.label}.
                            </p>
                          )}
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Visibility</label>
                          <div style={{ display: 'flex', gap: 18 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                              <input type="radio" name="v2DocVisibility" checked={!upVisible} onChange={() => setUpVisible(false)} /> Internal only
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                              <input type="radio" name="v2DocVisibility" checked={upVisible} onChange={() => setUpVisible(true)} /> Visible to customer
                            </label>
                          </div>
                        </div>
                        {/* WHAT THE LANDLORD SEES. The lease's documents binder and
                            the landlord's no-login link render the same set, so
                            this one answer covers both. Pre-set from the default
                            rule for the picked type; untouched, the row follows
                            that rule rather than freezing today's answer. */}
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Landlord link</label>
                          <div style={{ display: 'flex', gap: 18 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                              <input type="radio" name="v2DocLandlord" data-testid="up-landlord-show" checked={upLandlord} onChange={() => { setUpLandlord(true); setUpLandlordTouched(true); }} /> Show on landlord link
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                              <input type="radio" name="v2DocLandlord" data-testid="up-landlord-hide" checked={!upLandlord} onChange={() => { setUpLandlord(false); setUpLandlordTouched(true); }} /> Internal reference only
                            </label>
                          </div>
                          {upType && !upLandlordTouched && (
                            <p className="note" style={{ marginTop: 6 }}>
                              {upLandlord ? 'Standard document — shown by default.' : 'Reference paper — off the landlord link unless you choose Show.'}
                            </p>
                          )}
                        </div>
                        </div>
                        <div style={{ padding: '12px 18px 16px', borderTop: '1px solid #f0eee9' }}>
                          {upErr && <p className="note" style={{ color: 'var(--brick)', margin: '0 0 8px' }}>{upErr}</p>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button className="btn btn-jade btn-sm" disabled={upBusy || !upFile || !upType || (upShowExpiry && !upExpiry)} onClick={() => void submitUpload()}>
                              <UploadCloud size={14} /> {upBusy ? 'Uploading…' : upReplacing ? 'Replace' : 'Upload'}
                            </button>
                            <button className="btn btn-ghost btn-sm" disabled={upBusy} onClick={() => { setShowUpload(false); setUpErr(null); }}>Cancel</button>
                            {/* Says in one line what the two choices above add up to. */}
                            {upFile && upType && (
                              <span className="note" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                → {SECTION_LABEL[upSection]}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
              {/* Cross-lease document history — same popup module as the
                  customer page, no navigation away from the contract. */}
              {showDocsHistory && contract.tenant.id != null && (
                <CustomerDocsModal
                  tenantId={contract.tenant.id}
                  tenantName={contract.tenant.name}
                  /* Manager on "All landlords": scope the fetch by THIS contract's
                     landlord instead of the (empty) ?rp= query param. */
                  rp={contract.landlord?.id ?? null}
                  /* Same delete grant, and the same trash icon, the binder slots
                     and the KYC list on this page already use. */
                  canDelete={perms.deleteDocuments}
                  onChanged={onDocsChanged}
                  onClose={() => setShowDocsHistory(false)}
                />
              )}
              {/* "View all" — this contract's documents only (passes them in, so
                  the modal groups by category without a cross-lease fetch). */}
              {showContractDocs && (
                <CustomerDocsModal
                  tenantName={contract.tenant.name}
                  documents={all}
                  rp={contract.landlord?.id ?? null}
                  canDelete={perms.deleteDocuments}
                  onChanged={onDocsChanged}
                  onClose={() => setShowContractDocs(false)}
                />
              )}
              {offerModal}
              {/* Request-a-document popup (Flow 6) */}
              {showReqModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true">
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={() => setShowReqModal(false)} />
                  <div style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 460, padding: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                      <p className="subhead" style={{ margin: 0 }}>Request documents from {contract.tenant.name ?? 'the customer'}</p>
                      <button type="button" className="mini-btn view" onClick={() => setShowReqModal(false)}><X size={12} /></button>
                    </div>
                    {/* Selected documents — pick several, then send one request + one link */}
                    {reqSelected.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {reqSelected.map(name => (
                          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--jade-deep)', background: 'var(--jade-tint, #eef9f4)', border: '1px solid #cfe9df', borderRadius: 999, padding: '3px 6px 3px 10px' }}>
                            {name}
                            <button type="button" onClick={() => removeReqDoc(name)} style={{ display: 'grid', placeItems: 'center', border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 2 }} title="Remove">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="field" style={{ position: 'relative' }}>
                      <input
                        ref={reqInputRef}
                        autoFocus
                        className="input"
                        value={reqLabel}
                        placeholder="Search or type a document name, Enter to add…"
                        onChange={e => { setReqLabel(e.target.value); setReqMenuOpen(true); }}
                        onFocus={() => setReqMenuOpen(true)}
                        onBlur={() => setTimeout(() => setReqMenuOpen(false), 150)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setReqMenuOpen(false);
                          if (e.key === 'Enter') { e.preventDefault(); addReqDoc(reqLabel); }
                        }}
                      />
                      {reqMenuOpen && (() => {
                        const q = reqLabel.trim().toLowerCase();
                        const matches = REQUESTABLE_DOCS.filter(d => d.toLowerCase().includes(q) && !reqSelected.some(s => s.toLowerCase() === d.toLowerCase()));
                        if (matches.length === 0) return null;
                        return (
                          <div style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #e4e9e5', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.10)' }}>
                            {/* Same two groups as the upload picker — asking for a
                                document and filing one land in the same place. */}
                            {groupRequestNames(matches).map(g => (
                              <div key={g.section}>
                                <p style={{ margin: 0, padding: '6px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase', color: '#8a948d', background: '#faf9f6', position: 'sticky', top: 0 }}>{g.label}</p>
                                {g.names.map(d => (
                                  <button
                                    key={d} type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => addReqDoc(d)}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#eef7f2')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#14201a', cursor: 'pointer', background: 'transparent', border: 'none' }}
                                  >
                                    <FileText size={12} style={{ color: '#8a948d', flexShrink: 0 }} /> {d}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="field">
                      <input className="input" value={reqNotes} placeholder="Instructions for the customer (optional)" onChange={e => setReqNotes(e.target.value)} />
                    </div>
                    {reqErr && <p className="note" style={{ color: 'var(--brick)' }}>{reqErr}</p>}
                    {reqSent > 0 && (
                      <p className="note" style={{ color: 'var(--jade-deep)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Check size={13} /> Requested {reqSent} document{reqSent === 1 ? '' : 's'} — now send the upload link.
                      </p>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-jade btn-sm" disabled={reqBusy || (reqSelected.length === 0 && !reqLabel.trim())} onClick={() => void submitRequest()}>
                        <Paperclip size={14} /> {reqBusy ? 'Sending…' : `Send request${(reqSelected.length + (reqLabel.trim() ? 1 : 0)) > 1 ? 's' : ''}`}
                      </button>
                      {/* Upload link unlocks once documents are chosen */}
                      {contract.tenant.id && (
                        <SendTenantLinkButton
                          tenantId={contract.tenant.id}
                          contractId={contract.id}
                          section="documents"
                          label="Send docs link"
                          // Link is request-scoped: the customer sees only what was
                          // actually requested, so unlock it once the request is sent.
                          disabled={reqSent === 0}
                        />
                      )}
                      <button className="btn btn-ghost btn-sm" disabled={reqBusy} onClick={() => setShowReqModal(false)}>Close</button>
                    </div>
                  </div>
                </div>
              )}
              </>
            );
          })()}
          {!inline && tab === 'clauses' && (
            <>
            <div className="sec">
              <div className="sech"><span className="si"><ClipboardList size={16} /></span><span className="st">Clauses &amp; notes</span></div>
              <div className="secb">
                {clausesEditable ? (
                  /* Editable (draft only) — Flow 2 */
                  <>
                    {clauseList.map((c, i) => (
                      <div key={i} className="clause">
                        <span className="cn">{i + 1}</span>
                        <span className="ct">{c}</span>
                        <button type="button" className="mini-btn no" style={{ marginLeft: 'auto' }} onClick={() => setClauseList(prev => prev.filter((_, j) => j !== i))}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <input
                        className="input"
                        value={clauseInput}
                        placeholder="Type a clause and press Enter"
                        onChange={e => setClauseInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addClause(); } }}
                      />
                      <button type="button" className="btn btn-jade btn-sm" onClick={addClause}>Add</button>
                    </div>
                    <div className="field">
                      <label>Notes</label>
                      <textarea className="input" value={clauseNotes} placeholder="Any additional notes for this contract…" onChange={e => setClauseNotes(e.target.value)} />
                    </div>
                    {clauseErr && <p className="note" style={{ color: 'var(--brick)' }}>{clauseErr}</p>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button className="btn btn-jade btn-sm" disabled={clauseBusy} onClick={() => void saveClauses()}>
                        <Check size={14} /> {clauseBusy ? 'Saving…' : 'Save clauses'}
                      </button>
                      {clauseSaved && <span className="note" style={{ color: 'var(--jade-deep)', fontWeight: 700 }}>Saved ✓</span>}
                    </div>
                  </>
                ) : (
                  /* Read-only (issued / active / terminated / expired) */
                  <>
                    {contract.customClauses.map((c, i) => (
                      <div key={i} className="clause">
                        <span className="cn">{i + 1}</span>
                        <span className="ct">{c}</span>
                      </div>
                    ))}
                    {contract.customClauses.length === 0 && <p className="note">No custom clauses on this contract.</p>}
                    {contract.notes && (
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>Notes</label>
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--ink-2)' }}>{contract.notes}</div>
                      </div>
                    )}
                    <p className="note" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <BadgeCheck size={12} style={{ color: 'var(--jade-deep)' }} /> Contract sent to customer — clauses are locked.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="sec">
              <div className="sech"><span className="si"><FileText size={16} /></span><span className="st">Agreement Addendum</span></div>
              <div className="secb">
                {addendums.length > 0 ? (
                  <>
                    {addendums.map(a => (
                      <div key={a.id} className="clause">
                        <span className="ct" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <BadgeCheck size={14} style={{ color: 'var(--jade-deep)' }} /> {a.name || 'Agreement Addendum'}
                        </span>
                      </div>
                    ))}
                    <p className="note" style={{ marginTop: 8 }}>Attached — appears on the tenancy agreement.</p>
                  </>
                ) : addendumEnded ? (
                  <p className="note">No addendum attached.</p>
                ) : (
                  <>
                    <p className="note" style={{ marginBottom: 10 }}>
                      No addendum is attached. Attach this plan’s Agreement Addendum so it shows on the tenancy agreement.
                    </p>
                    {addendumErr && <p className="note" style={{ color: 'var(--brick)' }}>{addendumErr}</p>}
                    <button className="btn btn-jade btn-sm" disabled={addendumBusy} onClick={() => void onAttachLayoutAddendum()}>
                      <Plus size={14} /> {addendumBusy ? 'Attaching…' : 'Attach Agreement Addendum'}
                    </button>
                  </>
                )}
              </div>
            </div>
            </>
          )}

          {/* ── Tenancy notes log ──────────────────────────────────────────────
              A running, append-only journal staff keep about this tenancy so
              whoever picks it up next sees the full history. Shared across the
              whole renewal chain, and never locks (unlike the clauses note). */}
          {show('notes') && !financeOnly && (
            <div className="sec" id="sec-notes">
              <div className="sech"><span className="si"><StickyNote size={16} /></span><span className="st">Notes{notes.length > 0 && <span className="sec-count">{notes.length}</span>}</span></div>
              <div className="secb">
                <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>
                  An internal log for your team — record what is going on with this tenant so the next person to handle it is up to speed. Shared across this lease and its renewals. Not visible to the customer.
                </p>
                {perms.agreements && (
                  <>
                    <div className="field" style={{ marginBottom: 6 }}>
                      <textarea
                        className="input"
                        value={noteDraft}
                        placeholder="Add a note about this tenancy…"
                        rows={2}
                        onChange={e => setNoteDraft(e.target.value)}
                        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submitNote(); } }}
                      />
                    </div>
                    {noteErr && <p className="note" style={{ color: 'var(--brick)' }}>{noteErr}</p>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <button className="btn btn-jade btn-sm" disabled={noteBusy || !noteDraft.trim()} onClick={() => void submitNote()}>
                        <Check size={14} /> {noteBusy ? 'Saving…' : 'Add note'}
                      </button>
                    </div>
                  </>
                )}

                {notes.length === 0 ? (
                  <p className="note">No notes yet. Add the first one above.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {notes.map(n => (
                      <div key={n.id} style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                          <strong style={{ color: 'var(--ink-2)' }}>{n.authorName ?? (n.authorRole === 'tenant' ? 'Customer' : 'Staff')}</strong>
                          {n.authorRole === 'manager' && <span className="pill" style={{ fontSize: 10 }}>Manager</span>}
                          {n.authorRole === 'tenant' && <span className="pill" style={{ fontSize: 10 }}>Customer</span>}
                          <span style={{ marginLeft: 'auto' }}>
                            {new Date(n.createdAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>{n.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* ── Emails with this lease's customer — the landlord's own mailbox
              (Settings → Email). Renders nothing for a manager without the
              "Email customers and leads" authority. */}
          {show('emails') && !financeOnly && emails?.showEmails && contract.tenant.id != null && (
            <div id="sec-emails" style={{ gridColumn: '1 / -1', minWidth: 0, maxWidth: '100%' }}>
              <EmailsCard
                section
                rp={emails.rp}
                tenantId={contract.tenant.id}
                isManager={emails.isManager}
                to={contract.tenant.email && !/@(import\.upnow\.ae|.*upnow\.local)$/i.test(contract.tenant.email)
                  ? { tenantId: contract.tenant.id, name: (contract.tenant.entityType === 'company' && contract.tenant.companyName) || contract.tenant.name || contract.tenant.email, email: contract.tenant.email }
                  : null}
              />
            </div>
          )}
          {/* ── WhatsApp with this lease's customer — the conversation(s) matched to
              their number on the landlord's linked numbers (or linked by hand).
              Same authority as Emails; renders nothing when no number is linked. */}
          {show('whatsapp') && !financeOnly && emails?.showWhatsapp && contract.tenant.id != null && (
            <div id="sec-whatsapp" style={{ gridColumn: '1 / -1', minWidth: 0, maxWidth: '100%' }}>
              <WhatsAppCard
                section
                rp={emails.rp}
                tenantId={contract.tenant.id}
                isManager={emails.isManager}
                person={{ name: (contract.tenant.entityType === 'company' && contract.tenant.companyName) || contract.tenant.name || 'Customer', phone: contract.tenant.phone }}
              />
            </div>
          )}
          {show('breaches') && !financeOnly && legal && (
            <div className="sec" id="sec-breaches">
              <BreachesSection leaseId={contract.id} leaseStatus={contract.status} base={legal.base} rp={legal.rp} disputeHrefOf={legal.disputeHrefOf} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
