'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — behaviour unchanged. */
import { useState, useEffect } from 'react';
import { RotateCcw, X, AlertCircle, Trash2, Plus } from 'lucide-react';
import { SegregatedPlanView } from '@/components/upnow/SegregatedPlanView';
import { buildSegregatedPlan, type SegPaymentInput } from '@/lib/segregatedPlan';
import { errMessage } from '@/lib/apiError';
import MoveOutReasonSelect from '@/components/upnow/MoveOutReasonSelect';
import { moveOutReason, moveOutReasonReady } from '@/lib/moveOutReasons';
import { allowedInstallmentPlans, installmentLabel } from '@/lib/installmentPlans';
import { buildInstallmentDueDates } from '@/lib/installmentDates';
import { recomputeSubleaseCharges, classifySubleaseCharge } from '@/lib/subleaseCharges';
import { configuredFeeFromRules, feeVatFromRules } from '@/lib/feeRules';
import { ContractDetail, fmtAed, fmtDate, isRenewalChild, spaceCategoryFromUnitType } from './shared';


export function TerminateModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [effective, setEffective] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, reasonCode, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(await errMessage(res, 'Termination request failed'));
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Termination request failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Request termination
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            {contract.tenant.name ?? 'The customer'} must accept this request before the contract terminates.
          </p>
          <div className="field">
            <label>Move-out reason</label>
            <MoveOutReasonSelect value={reasonCode} onChange={setReasonCode} />
            <p className="note" style={{ marginTop: 6 }}>Counted in the Move-out Reasons report.</p>
          </div>
          <div className="field">
            <label>Details{moveOutReason(reasonCode)?.requiresNote ? '' : ' (optional)'}</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Anything the reason above doesn't say" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!moveOutReasonReady(reasonCode, reason) || !effective || busy} onClick={submit}>
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}

/** RP-side direct termination — ends the lease without customer approval (the
 *  customer has already vacated). Starts the move-out → utility → settlement
 *  close-out; the lease stays ACTIVE until the settlement is marked paid. */
export function DirectTerminateModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/direct`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, reasonCode, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(await errMessage(res, 'Direct termination failed'));
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Direct termination failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Terminate directly
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            The customer has already vacated. This ends the lease without their approval and starts the move-out → utility → settlement close-out. The lease stays active until you complete the settlement.
          </p>
          <div className="field">
            <label>Move-out reason</label>
            <MoveOutReasonSelect value={reasonCode} onChange={setReasonCode} />
            <p className="note" style={{ marginTop: 6 }}>Counted in the Move-out Reasons report.</p>
          </div>
          <div className="field">
            <label>Details{moveOutReason(reasonCode)?.requiresNote ? '' : ' (optional)'}</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Anything the reason above doesn't say" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!moveOutReasonReady(reasonCode, reason) || !effective || busy} onClick={submit}>
            Terminate directly
          </button>
        </div>
      </div>
    </div>
  );
}

// Clean void of a NOT-YET-ACTIVE (pending / issued) lease — the tenant never
// started, so there is no move-out / settlement wind-down. Distinct from
// DirectTerminateModal (which ends a live tenancy). Posts to /contracts/:id/cancel.
export function RejectUtilityModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/reject`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Reject utility submission
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            This sends the utility step back to the customer to upload a fresh proof of payment. They&rsquo;ll see your reason below.
          </p>
          <div className="field" style={{ margin: 0 }}>
            <label>Reason (the customer will see this)</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. The proof is blurry / the account number doesn't match / wrong document." />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Keep reviewing</button>
          <button className="btn btn-brick btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'Rejecting…' : 'Reject & send back'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Two different actions behind one button, because the backend treats a
 * pre-active RENEWAL differently from a pre-active new lease:
 *  · renewal child → a real cancellation (termination of the next term): the
 *    child is voided, its cheques cancelled, and the parent lease keeps running
 *    to its own end date. Not reversible — re-propose instead.
 *  · new lease → NOT a void; it resets the lease back to the setup pipeline.
 */
export function CancelLeaseModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const isRenewal = isRenewalChild(contract);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.message ?? `Cancel failed: ${res.status}`);
      }
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            {isRenewal ? 'Cancel renewal' : 'Reset lease to setup'}
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            {isRenewal ? (
              <>
                This renewal has not started yet, so cancelling it ends the next term the way a termination ends a tenancy — no move-out or settlement. The renewal lease is marked terminated, its pending cheques are voided, and the current lease
                {contract.parentContractId ? ` (#${contract.parentContractId})` : ''} keeps running to its own end date. This cannot be undone — propose a fresh renewal if new terms are needed.
              </>
            ) : (
              <>This lease has not started yet, so it is not voided — it goes back to the setup pipeline at its uncompleted stage and stays on the Operations worklist. Any termination flags are cleared and previously-voided cheques are reinstated.</>
            )}
          </p>
          <div className="field" style={{ margin: 0 }}>
            <label>Reason (optional)</label>
            <textarea
              className="input"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={isRenewal ? 'Why are you cancelling this renewal?' : 'Why are you sending this lease back to setup?'}
            />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{isRenewal ? 'Keep renewal' : 'Keep as is'}</button>
          <button className="btn btn-brick btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'Working…' : isRenewal ? 'Cancel renewal' : 'Reset to setup'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "↑ 27.7% vs current AED 94,000" — how far a proposed rent moves off the current
 * one, coloured by direction (up = saffron, down = jade, unchanged = muted). Shown
 * as the RP types so an increase is a decision rather than a discovery: Dubai's
 * rental index caps what can be asked in bands, and "94,000 → 120,000" doesn't read
 * as +27.7% at a glance. `pct: null` renders nothing.
 */
export function RentDeltaChip({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const tone = flat
    ? { color: 'var(--mute)', background: 'var(--surface)' }
    : up
      ? { color: 'var(--saffron-deep)', background: 'var(--saffron-soft)' }
      : { color: 'var(--jade-deep)', background: 'var(--jade-tint)' };
  return (
    <span
      style={{
        ...tone, display: 'inline-block', marginTop: 5, padding: '2px 7px', borderRadius: 6,
        fontSize: 11, fontWeight: 700, letterSpacing: '0.01em',
      }}
    >
      {flat ? 'Same as current' : `${up ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%`}
      {' '}<span style={{ fontWeight: 600, opacity: 0.85 }}>{label}</span>
    </span>
  );
}

export function RenewalProposeModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const ns = new Date(contract.endDate); ns.setDate(ns.getDate() + 1);
  const ne = new Date(ns); ne.setFullYear(ne.getFullYear() + 1); ne.setDate(ne.getDate() - 1);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  // Prefill one-off fees from the PARENT lease's actual fees (its fee rows, else
  // its stored column) — a sensible renewal default the RP can edit. Blank when
  // the parent had none; never a hardcoded/auto figure.
  const parentFeeAmt = (t: string, col?: number | null) => {
    const row = (contract.fees ?? []).find(x => x.paymentType === t)?.amount;
    const v = row ?? col ?? 0;
    return v > 0 ? String(v) : '';
  };
  // …but the RP's own FEE RULES (Settings → Fee Rules → Renewal contract, resolved
  // server-side for this unit's category) OUTRANK the parent lease when they exist.
  // A rule switched OFF is a decision — "we don't charge commission on renewal" —
  // so it prefills an explicit **0** that the RP can still override, rather than
  // silently re-billing the figure the original lease happened to carry. Only an
  // RP who has never configured the category falls back to the parent's fees.
  const feeRules = contract.feeRules?.configured ? contract.feeRules.rules : undefined;
  const ruleFeeAmt = (key: 'adminFee' | 'ejariFee' | 'commission', atRent: number) => {
    const v = configuredFeeFromRules(feeRules, key, atRent);
    return v == null ? null : String(v);
  };
  /** Rule amount if the RP configured one, else the parent lease's own figure. */
  const seedFee = (
    key: 'adminFee' | 'ejariFee' | 'commission',
    paymentType: string,
    atRent: number,
    col?: number | null,
  ) => ruleFeeAmt(key, atRent) ?? parentFeeAmt(paymentType, col);
  const [f, setF] = useState({
    // Default the renewal to the parent lease's current NET rent (annualRent is
    // net; the cheque schedule adds VAT on top). The RP explicitly enters any
    // increase — never seed a hidden uplift here. (Previously `* 1.05`, which
    // dropped a VAT-inclusive figure into the net field → the backend then added
    // VAT again, double-counting it and silently hiking the rent 5%.)
    listedRent: String(contract.annualRent),
    discountType: 'none' as 'none' | 'percent' | 'fixed',
    discountValue: '',
    newStartDate: iso(ns),
    newEndDate: iso(ne),
    numberOfInstallments: String(contract.numberOfInstallments ?? 4),
    // Inherited from the parent lease, not asked again on the renewal form: a renewal
    // continues the same payment method, and it's editable on the contract itself.
    // Still SENT, because the backend stamps each cheque row's method from the dto
    // (only the contract header falls back to the parent), so dropping it would file
    // a bank-transfer lease's renewal cheques as 'cheque'.
    modeOfPayment: contract.modeOfPayment ?? 'cheque',
    adminFee: seedFee('adminFee', 'admin_fee', contract.annualRent, contract.adminFeeFils),
    ejariFee: seedFee('ejariFee', 'ejari_fee', contract.annualRent, contract.ejariFeeFils),
    commission: seedFee('commission', 'commission', contract.annualRent),
  });
  // Which fee fields the RP has typed in — a touched field is theirs and is never
  // re-derived from the rules again.
  const [feeTouched, setFeeTouched] = useState<Record<'adminFee' | 'ejariFee' | 'commission', boolean>>({
    adminFee: false, ejariFee: false, commission: false,
  });
  // Extra one-off charge lines (Municipality Fee, parking add-on, etc.) — each a
  // separate cheque on top of rent + fees. Posted as `extraCharges`.
  //
  // A renewal continues THIS lease, so it repeats the current lease's Third Party
  // ('other') charges — the sub-lease charge, service charge, etc. Two sources,
  // in this order:
  //
  //   1. The PARENT lease's own payment rows — what this contract actually
  //      charges today, amounts and all.
  //   2. The UNIT's configured charges, for anything source 1 doesn't already
  //      cover. This used to be excluded on the reasoning that "a new lease reads
  //      the unit, a renewal shows what this contract already charges" — but a
  //      lease that was IMPORTED has no charge rows to show (its cheques were
  //      keyed straight in as bare rent), so a sub-leased unit's 20% pass-through
  //      silently vanished from every renewal of it. The unit is the standing
  //      configuration; the renewal offers it and the RP deletes any line that
  //      doesn't apply to this term.
  //
  // Rent VAT is skipped — the renewal recomputes it as its own cheque, so carrying
  // it forward would double-count. Every line stays editable/removable.
  //
  // Carrying the AMOUNT forward is right for a flat charge but wrong for the
  // sub-lease pass-through lines, whose labels declare them a percentage of the
  // rent — and a renewal is exactly where the rent changes. Those two re-derive
  // from the net rent below (and again whenever the rent field moves), so the
  // offer can never quote last year's percentage, nor the unit's Market Rent
  // percentage when the lease is let for less.
  const [extras, setExtras] = useState<{ description: string; amount: string; dueDate: string }[]>(() => {
    // Carried charges fall due on the FIRST installment date (same as the rent
    // cheque #1 / fees), computed the same way the schedule below does.
    const firstDue = buildInstallmentDueDates(
      iso(ns), iso(ne), contract.numberOfInstallments ?? 4, contract.preferredChequeDays ?? [],
    )[0] ?? iso(ns);
    const carried = (contract.payments ?? [])
      .filter(p => (p.paymentType ?? '') === 'other')
      .filter(p => !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase()))
      .filter(p => (p.amount ?? 0) > 0)
      .filter(p => !(/rent/i.test(p.description ?? '') && /vat/i.test(p.description ?? '')))
      .map(p => ({ description: (p.description ?? '').trim(), amount: String(p.amount ?? ''), dueDate: firstDue }));

    // Identity of a charge, for "does the lease already bill this?". The two
    // sub-lease lines are matched by what they ARE, not by their text: RPs
    // hand-type those labels and live data holds several spellings, so
    // "20% on sub lease" and "Sub-lease charge (20%)" must not both be offered.
    // Everything else falls back to its normalised label.
    const chargeKey = (label: string) => {
      const sub = classifySubleaseCharge(label);
      return sub ? `sublease:${sub.kind}` : label.trim().toLowerCase().replace(/\s+/g, ' ');
    };
    const already = new Set(carried.map(c => chargeKey(c.description)));
    const fromUnit = (contract.unit.additionalPayments ?? [])
      // Gross: the unit stores a charge's own VAT beside it, while an extras line
      // carries a single amount (the sub-lease VAT is its own labelled row, so
      // this only bites on a unit charge that declares inline VAT).
      .map(p => ({ description: (p.label ?? '').trim(), amount: (Number(p.amount) || 0) + (Number(p.vat) || 0) }))
      .filter(p => {
        if (!p.description || p.amount <= 0) return false;
        const k = chargeKey(p.description);
        if (already.has(k)) return false;
        already.add(k); // a unit listing the same charge twice still offers it once
        return true;
      })
      .map(p => ({ description: p.description, amount: String(p.amount), dueDate: firstDue }));

    return [...carried, ...fromUnit];
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Installment plans + cheque days come from the contract payload (the OWNING
  // RP's config) so a manager — who has no RP profile of their own — still sees
  // the right filtered list and the preview snaps dates the same way the backend does.
  const allowedInstallments = contract.allowedInstallments ?? [];
  const chequeDays = contract.preferredChequeDays ?? [];

  const set = (k: keyof typeof f, v: string) => {
    if (k === 'adminFee' || k === 'ejariFee' || k === 'commission') {
      setFeeTouched(p => (p[k] ? p : { ...p, [k]: true }));
    }
    setF(p => ({ ...p, [k]: v }));
  };
  const addExtra = () => setExtras(p => [...p, { description: '', amount: '', dueDate: '' }]);
  const setExtra = (i: number, k: 'description' | 'amount' | 'dueDate', v: string) =>
    setExtras(p => p.map((e, idx) => idx === i ? { ...e, [k]: v } : e));
  const removeExtra = (i: number) => setExtras(p => p.filter((_, idx) => idx !== i));

  const n = parseInt(f.numberOfInstallments) || 0;
  const listed = parseFloat(f.listedRent) || 0;
  const discVal = parseFloat(f.discountValue) || 0;
  const discountAmt = f.discountType === 'percent'
    ? Math.round(listed * discVal) / 100
    : f.discountType === 'fixed' ? discVal : 0;
  const rent = Math.max(0, listed - Math.min(discountAmt, listed)); // net rent

  // How far the proposed rent moves off the CURRENT one. Surfaced as the RP types
  // so the increase is a decision, not a discovery — Dubai's rental index caps what
  // can be asked in bands, and "94,000 → 120,000" doesn't read as +27.7% at a glance.
  // Compared against the parent's net rent, the same basis as the Contract Value.
  const prevRent = Number(contract.annualRent) || 0;
  const pctVsCurrent = (x: number) => (prevRent > 0 && x > 0 ? ((x - prevRent) / prevRent) * 100 : null);
  // Length of the term being replaced, in whole months (inclusive end date), so the
  // "Current contract" summary says 12 months rather than making the RP subtract dates.
  const currentTermMonths = (() => {
    const s = new Date(contract.startDate), e = new Date(contract.endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
    const m = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
    return m > 0 ? m : null;
  })();
  const listedDeltaPct = pctVsCurrent(listed);
  // Dubai Law 33/2008 Art. 14: a party wanting to change the lease terms on renewal must
  // notify the other at least 90 days before expiry. Inside that window the customer can
  // insist on the current terms, so the RP is warned (not blocked — renewing on the same
  // terms, or an agreed change, is still allowed). Research: reports/Marketplace provider OS best practices.md
  const [openedAt] = useState(() => Date.now()); // fixed for the life of the modal
  const daysToExpiry = (() => {
    const e = new Date(contract.endDate);
    if (Number.isNaN(e.getTime())) return null;
    return Math.ceil((e.getTime() - openedAt) / 86_400_000);
  })();
  const insideNoticeWindow = daysToExpiry != null && daysToExpiry < 90;
  const netDeltaPct = pctVsCurrent(rent);

  // Keep the derived sub-lease lines pinned to the net rent as it is edited.
  // recomputeSubleaseCharges returns the same array when nothing moved, so this
  // settles in one pass instead of looping. Flat charges are returned untouched.
  useEffect(() => {
    setExtras(prev => recomputeSubleaseCharges(prev, rent));
  }, [rent]);

  /**
   * What a fee field shows. Until the RP types in it, it stays DERIVED from their fee
   * rules at the current rent — so a percentage rule (commission is typically 5% of
   * rent) follows the rent field instead of quoting a figure computed off the old
   * rent, and a renewal is exactly where the rent changes. Once they've typed, the
   * value is theirs and is never recomputed.
   */
  const feeValue = (key: 'adminFee' | 'ejariFee' | 'commission') =>
    (feeTouched[key] ? null : ruleFeeAmt(key, rent)) ?? f[key];
  const adminN = parseFloat(feeValue('adminFee')) || 0;
  const ejariN = parseFloat(feeValue('ejariFee')) || 0;
  const commN = parseFloat(feeValue('commission')) || 0;
  // Rent VAT rate: the parent's stored rentVatRate can be stale/0 on older contracts,
  // but a renewal's rate is recomputed server-side from the UNIT category
  // (commercial/industrial = 5%, residential exempt). Mirror that so the preview
  // matches the actual proposal, not the old rate.
  const vatRate = Number(contract.rentVatRate)
    || (spaceCategoryFromUnitType((contract.unit as { type?: string | null } | undefined)?.type ?? null) !== 'residential' ? 5 : 0);
  const vatOf = (x: number) => vatRate ? Math.round(x * vatRate) / 100 : 0;
  // Due dates — spread over the actual renewal term + snapped to the RP's cheque
  // days, identical to what proposeRenewal stamps server-side.
  const dueDates = buildInstallmentDueDates(f.newStartDate, f.newEndDate, n, chequeDays);

  // Preview mirrors the backend splitVatToOwnCheques: rent cheques are NET, and the
  // rent VAT is its OWN cheque. The RP's Settings → Rules mode decides how many:
  //   'annual'      → ONE "Rental VAT" cheque for the year, on the first rent date.
  //   'installment' → one "Rental VAT N of M" cheque beside each rent cheque.
  // Fees are net too.
  const vatMode: 'annual' | 'installment' = contract.rentVatMode ?? 'installment';
  type Row = { key: string; d: string; date: string; net: number; vat: number };
  const rows: Row[] = [];
  const vatRows: Row[] = [];
  if (n && rent) {
    const base = Math.floor(rent / n);
    const lastA = rent - base * (n - 1);
    let annualVat = 0;
    for (let i = 0; i < n; i++) {
      const r = i === n - 1 ? lastA : base;
      rows.push({ key: `r${i}`, d: n === 1 ? 'Annual Rent' : `Instalment ${i + 1}`, date: dueDates[i] ?? '', net: r, vat: 0 });
      const v = vatOf(r);
      if (v > 0) {
        annualVat += v;
        if (vatMode !== 'annual') vatRows.push({ key: `rv${i}`, d: n === 1 ? `Rental VAT (${vatRate}%)` : `Rental VAT ${i + 1} of ${n} (${vatRate}%)`, date: dueDates[i] ?? '', net: 0, vat: v });
      }
    }
    // Annual mode: collapse to a single Rental VAT cheque on the first rent date.
    if (vatMode === 'annual' && annualVat > 0) vatRows.push({ key: 'rv-annual', d: `Rental VAT (${vatRate}%)`, date: dueDates[0] ?? '', net: 0, vat: annualVat });
  }
  rows.push(...vatRows);
  const feeDate = dueDates[0] ?? f.newStartDate;
  if (adminN > 0) rows.push({ key: 'admin', d: 'Admin Fee', date: feeDate, net: adminN, vat: 0 });
  if (ejariN > 0) rows.push({ key: 'ejari', d: 'Contract Registration Fee', date: feeDate, net: ejariN, vat: 0 });
  if (commN > 0)  rows.push({ key: 'comm',  d: 'Commission', date: feeDate, net: commN, vat: 0 });
  // Fees are NET above, and their tax rides ONE combined "Fees VAT" cheque due with
  // the first cheque — exactly what proposeRenewal stamps (ruleFeeVat per fee, then
  // splitVatToOwnCheques). Without this the preview was short by the fee tax and the
  // RP approved a plan whose total didn't match the cheques that got raised.
  const feeVat = Math.round((
    feeVatFromRules(feeRules, 'adminFee', adminN, rent)
    + feeVatFromRules(feeRules, 'ejariFee', ejariN, rent)
    + feeVatFromRules(feeRules, 'commission', commN, rent)
  ) * 100) / 100;
  if (feeVat > 0) rows.push({ key: 'feevat', d: 'Fees VAT', date: feeDate, net: 0, vat: feeVat });
  extras.forEach((e, i) => {
    const amt = parseFloat(e.amount) || 0;
    if (e.description.trim() && amt > 0) rows.push({ key: `x${i}`, d: e.description.trim(), date: e.dueDate || (dueDates[n - 1] ?? ''), net: amt, vat: 0 });
  });
  const totalVat = rows.reduce((s, r) => s + r.vat, 0);
  const total = rows.reduce((s, r) => s + r.net + r.vat, 0);

  // Segregated four-group preview — same shared view as the contract, receipts, PDFs,
  // lead, creation and edit. Classify each planned row by its key: rent instalments →
  // Rental Income; rental-VAT cheques + extras → Third Party; admin/Ejari/commission →
  // Management/Third Party. (Renewals carry the deposit forward, so no deposit row.)
  const seg = buildSegregatedPlan(rows.map((r): SegPaymentInput => {
    const paymentType =
      r.key.startsWith('rv') ? 'other'
      : r.key.startsWith('r') ? 'rental_income'
      : r.key === 'admin' ? 'admin_fee'
      : r.key === 'ejari' ? 'ejari_fee'
      : r.key === 'comm' ? 'commission'
      : 'other';
    return { paymentType, description: r.d, amount: r.net + r.vat, transactionDate: r.date || null };
  }));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/renewal/propose`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAnnualRent: rent,                       // NET (listed − discount)
          listedRent: listed,
          discountType: f.discountType === 'none' ? undefined : f.discountType,
          discountValue: f.discountType === 'none' ? undefined : discVal,
          newStartDate: f.newStartDate,
          newEndDate: f.newEndDate,
          numberOfInstallments: n,
          modeOfPayment: f.modeOfPayment,
          adminFee: adminN,
          ejariFee: ejariN,
          commission: commN,
          extraCharges: extras
            .map(e => ({ description: e.description.trim(), amount: parseFloat(e.amount) || 0, dueDate: e.dueDate || undefined }))
            .filter(e => e.description && e.amount > 0),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Renewal propose failed: ${res.status}`);
      }
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Renewal propose failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    // No onClick on the scrim: a renewal is a long form (term, rent, discount, fees,
    // charges) and a stray click on the backdrop used to bin the whole thing. It closes
    // via the × or Cancel only.
    <div className="mscrim">
      <div className="modal xl" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><RotateCcw size={17} /></span>
            Propose renewal
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          {/* What's being renewed, as four labelled facts instead of four loose lines
              of grey text — the RP checks the customer, the unit, the term they're
              replacing and the rent they're pricing against before touching anything
              below, so each gets a name. */}
          <p className="subhead mut">Current contract</p>
          <div className="infopanel curcontract" style={{ marginBottom: 18 }}>
            <div>
              <span className="eyebrow">Customer</span>
              <b>{contract.tenant.name ?? '—'}</b>
            </div>
            <div>
              <span className="eyebrow">Unit</span>
              <b>{contract.unit.number ? `Unit ${contract.unit.number}` : '—'}</b>
              <span className="note">{contract.property.buildingName ?? '—'}</span>
            </div>
            <div>
              <span className="eyebrow">Current term</span>
              <b>{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</b>
              {currentTermMonths != null && <span className="note">{currentTermMonths} months</span>}
            </div>
            <div>
              <span className="eyebrow">Current rent</span>
              <b>{fmtAed(contract.annualRent)}</b>
              {contract.numberOfInstallments
                ? <span className="note">{contract.numberOfInstallments} × {installmentLabel(contract.numberOfInstallments).toLowerCase()}</span>
                : null}
            </div>
          </div>
          {insideNoticeWindow && (
            <div role="note" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 13px', marginBottom: 16, borderRadius: 10, background: 'var(--ms-amber-bg)', border: '1px solid #ecd9b6', color: 'var(--ms-amber-text)', fontSize: 12.5, lineHeight: 1.55 }}>
              <span aria-hidden style={{ fontWeight: 800 }}>!</span>
              <span>
                <b>{daysToExpiry! <= 0 ? 'This lease has already ended.' : `This lease ends in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'}.`}</b>{' '}
                Dubai tenancy law (Law 33/2008, Art. 14) needs 90 days&apos; notice before expiry to change the terms. Inside that window the customer can renew on the current terms,
                so a higher rent or new conditions need their agreement. Check the allowed increase on the{' '}
                <a href="https://dubailand.gov.ae/en/eservices/rental-index/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline' }}>DLD rental index calculator</a>.
              </span>
            </div>
          )}
          <p className="subhead mut">Renewal period</p>
          <div className="grid3" style={{ marginBottom: 18 }}>
            <div className="field" style={{ margin: 0 }}><label>Start date</label><input type="date" className="input" value={f.newStartDate} onChange={e => set('newStartDate', e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>End date</label><input type="date" className="input" value={f.newEndDate} onChange={e => set('newEndDate', e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}>
              <label>Payments / Year</label>
              <select className="input" value={f.numberOfInstallments} onChange={e => set('numberOfInstallments', e.target.value)}>
                {/* "4 — Quarterly": the cheque count alone made the RP work out what
                    the frequency was. longLabel is the shared label from lib/installmentPlans. */}
                {allowedInstallmentPlans(allowedInstallments, [Number(f.numberOfInstallments)]).map(p => (
                  <option key={p.value} value={p.value}>{p.longLabel}</option>
                ))}
              </select>
            </div>
          </div>
          {/* The rent maths, laid out as the sum it actually is:
                Annual Rent − Discount = Contract Value.
              The discount is not a field in its own right — it's the thing that turns
              what's asked into what's billed, so it sits between the two and both
              sides carry their own "vs the current rent" readout. No "Mode of payment"
              here either: a renewal continues the parent lease's payment method, set
              on the contract itself rather than re-chosen every term. */}
          <p className="subhead mut">Rent for the new term</p>
          <div className="infopanel" style={{ padding: '14px 16px', marginBottom: 18 }}>
            <div className="rentcalc">
              <div className="field" style={{ margin: 0 }}>
                <label>Annual Rent</label>
                <input type="number" className="input" value={f.listedRent} onChange={e => set('listedRent', e.target.value)} />
                <RentDeltaChip pct={listedDeltaPct} label={`vs current ${fmtAed(prevRent)}`} />
              </div>
              <span className="op">−</span>
              <div className="field" style={{ margin: 0 }}>
                <label>Discount</label>
                <div className="disc">
                  <select className="input" value={f.discountType} onChange={e => set('discountType', e.target.value)}>
                    <option value="none">No discount</option>
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed (AED)</option>
                  </select>
                  <input
                    type="number"
                    className="input"
                    aria-label="Discount value"
                    value={f.discountType === 'none' ? '' : f.discountValue}
                    disabled={f.discountType === 'none'}
                    placeholder={f.discountType === 'percent' ? '%' : f.discountType === 'fixed' ? 'AED' : '—'}
                    onChange={e => set('discountValue', e.target.value)}
                    style={f.discountType === 'none' ? { background: 'var(--surface)', color: 'var(--mute)' } : undefined}
                  />
                </div>
                {/* A "%" only becomes money once you see it against the rent. */}
                {discountAmt > 0 && (
                  <span style={{
                    display: 'inline-block', marginTop: 5, padding: '2px 7px', borderRadius: 6,
                    fontSize: 11, fontWeight: 700, color: 'var(--jade-deep)', background: 'var(--jade-tint)',
                  }}>
                    − {fmtAed(discountAmt)}{' '}
                    <span style={{ fontWeight: 600, opacity: 0.85 }}>off {fmtAed(listed)}</span>
                  </span>
                )}
              </div>
              <span className="op">=</span>
              <div className="field" style={{ margin: 0 }}>
                <label>{discountAmt > 0 ? 'Contract Value after discount' : 'Contract Value'}</label>
                <input
                  className="input"
                  value={fmtAed(rent)}
                  disabled
                  style={{ background: '#fff', color: 'var(--ink)', fontWeight: 800, borderColor: 'var(--jade)' }}
                />
                {discountAmt > 0 && <RentDeltaChip pct={netDeltaPct} label="vs current, after discount" />}
              </div>
            </div>
          </div>
          <p className="subhead mut">Fees (AED) — billed as their own cheques</p>
          <div className="grid2">
            <div className="field"><label>Admin fee</label><input type="number" className="input" value={feeValue('adminFee')} onChange={e => set('adminFee', e.target.value)} /></div>
            <div className="field"><label>Contract Registration fee</label><input type="number" className="input" value={feeValue('ejariFee')} onChange={e => set('ejariFee', e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: feeRules ? 6 : 18 }}>
            <div className="field"><label>Commission</label><input type="number" className="input" value={feeValue('commission')} onChange={e => set('commission', e.target.value)} /></div>
            <div className="field"><label>Deposit (carries over)</label><input className="input" value={fmtAed(contract.securityDepositAmount)} disabled style={{ background: 'var(--surface)', color: 'var(--ink-3)' }} /></div>
          </div>
          {feeRules && (
            <p className="note mut" style={{ marginTop: 0, marginBottom: 18 }}>
              Prefilled from your renewal fee rules for {contract.feeRules?.spaceCategory?.replace('_', ' ')} (Settings → Fee Rules → Renewal contract) — a fee
              you switched off comes through as 0. Edit any of them for this renewal.
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: extras.length > 0 ? 4 : 8 }}>
            <p className="subhead mut" style={{ margin: 0 }}>Additional charges <span style={{ fontWeight: 600, opacity: 0.75 }}>· Third Party</span></p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addExtra}><Plus size={13} /> Add charge</button>
          </div>
          {extras.length > 0 && (
            <p className="note mut" style={{ marginTop: 0, marginBottom: 8 }}>Carried forward from the current lease, plus any charge configured on the unit that it isn’t already billing (e.g. sub-lease charge, service charge). Each is billed under Third Party — edit or remove any that don’t apply to this term.</p>
          )}
          {extras.map((e, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input className="input" placeholder="Description (e.g. Municipality Fee)" value={e.description} onChange={ev => setExtra(i, 'description', ev.target.value)} />
              <input className="input" type="number" placeholder="Amount" value={e.amount} onChange={ev => setExtra(i, 'amount', ev.target.value)} />
              <input className="input" type="date" value={e.dueDate} onChange={ev => setExtra(i, 'dueDate', ev.target.value)} />
              <button type="button" className="x" onClick={() => removeExtra(i)} title="Remove"><Trash2 size={15} /></button>
            </div>
          ))}

          {rows.length > 0 && (
            <>
              <p className="subhead mut" style={{ marginTop: 14 }}>Planned schedule</p>
              <SegregatedPlanView plan={seg} />
              {totalVat > 0 && (
                <p className="note mut" style={{ marginTop: 6 }}>Rent cheques are net; VAT of {totalVat.toLocaleString('en-AE')} is collected as its own cheque(s), shown under Third Party.</p>
              )}
              {chequeDays.length === 0 && (
                <p className="note mut" style={{ marginTop: 6 }}>Tip: set preferred cheque days in Settings → Rules to standardise due dates.</p>
              )}
            </>
          )}
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
          <p className="note mut" style={{ marginTop: 10 }}>
            This saves a draft for your review — the customer is <b>not</b> notified until you press <b>Send</b> on the contract page.
          </p>
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-jade btn-sm" disabled={busy} onClick={submit}>
            <RotateCcw size={14} /> Save renewal draft
          </button>
        </div>
      </div>
    </div>
  );
}
