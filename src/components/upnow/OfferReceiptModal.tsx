'use client';

import { X } from 'lucide-react';

/** A payment-plan breakdown (cost lines + cheque schedule) rendered in a modal.
 *  Originally the origin-lead offer snapshot; now also used for the contract's
 *  CURRENT live plan (rent cheques + fees + deposit). Money is in fils. */
export interface OfferPlanItem {
  index: number;
  amountFils: number;
  vatFils?: number;
  dueDate: string;
  description?: string;
  type?: 'fee' | 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
  status?: string | null;
}
export interface OfferPlan {
  totalAmountFils: number;
  rentFils: number;
  originalRentFils?: number;
  discountFils?: number;
  installmentCount: number;
  adminFeeFils: number;
  ejariFils: number;
  commissionFils: number;
  securityDepositFils: number;
  adminFeeVatFils?: number;
  ejariVatFils?: number;
  commissionVatFils?: number;
  rentVatRate?: number;
  rentVatFils?: number;
  customFees?: Array<{ label: string; netFils: number; vatFils: number }>;
  items: OfferPlanItem[];
  issuedAt?: string;
}

const aed = (fils: number) => `AED ${Math.round((fils ?? 0) / 100).toLocaleString('en-AE')}`;
const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const TYPE_LABEL: Record<string, string> = {
  fee: 'Before move-in', first_bundle: 'Before move-in', security_deposit: 'Before move-in',
  installment: 'Rent', extra_installment: 'Extra',
};

export default function OfferReceiptModal({
  plan, contractRef, onClose,
  title = 'Payment Plan',
  subtitle = 'Current payment plan',
}: { plan: OfferPlan; contractRef?: string | null; onClose: () => void; title?: string; subtitle?: string }) {
  const lines: { label: string; fils: number }[] = [
    { label: `Annual rent${(plan.rentVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.rentFils + (plan.rentVatFils ?? 0) },
  ];
  if (plan.adminFeeFils > 0) lines.push({ label: `Admin fee${(plan.adminFeeVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.adminFeeFils + (plan.adminFeeVatFils ?? 0) });
  if (plan.ejariFils > 0) lines.push({ label: `Ejari fee${(plan.ejariVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.ejariFils + (plan.ejariVatFils ?? 0) });
  if (plan.commissionFils > 0) lines.push({ label: `Commission${(plan.commissionVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.commissionFils + (plan.commissionVatFils ?? 0) });
  (plan.customFees ?? []).forEach(f => lines.push({ label: `${f.label}${f.vatFils > 0 ? ' (incl. VAT)' : ''}`, fils: f.netFils + f.vatFils }));
  if (plan.securityDepositFils > 0) lines.push({ label: 'Security deposit', fils: plan.securityDepositFils });

  const items = [...(plan.items ?? [])].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} role="dialog" aria-modal="true">
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,25,22,.45)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -24px rgba(26,23,20,.5)', width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '16px 18px', borderBottom: '1px solid #ece9e3' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#1a1916', margin: 0 }}>{title}</p>
            <p style={{ fontSize: 12, color: '#9b9890', margin: '2px 0 0' }}>
              {subtitle}{contractRef ? ` · ${contractRef}` : ''}{plan.issuedAt ? ` · ${fmtD(plan.issuedAt)}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, cursor: 'pointer', color: '#9b9890', padding: 4 }}><X size={18} /></button>
        </div>

        {/* Cost breakdown */}
        <div style={{ padding: '14px 18px', display: 'grid', gap: 6 }}>
          {plan.originalRentFils != null && (plan.discountFils ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9b9890' }}>
              <span>Listed rent</span>
              <span style={{ textDecoration: 'line-through' }}>{aed(plan.originalRentFils)}</span>
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#334155' }}>
              <span>{l.label}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{aed(l.fils)}</span>
            </div>
          ))}
          <div style={{ borderTop: '2px solid #c5e8df', margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5, fontWeight: 800, color: '#15803d' }}>
            <span>Total offered</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{aed(plan.totalAmountFils)}</span>
          </div>
        </div>

        {/* Cheque schedule */}
        {items.length > 0 && (
          <div style={{ borderTop: '1px solid #ece9e3' }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: 0, padding: '12px 18px 6px' }}>
              Payment schedule · {plan.installmentCount} installment{plan.installmentCount === 1 ? '' : 's'}
            </p>
            <div style={{ padding: '0 12px 14px', display: 'grid', gap: 4 }}>
              {items.map((it, i) => (
                <div key={it.index ?? i} style={{ display: 'grid', gridTemplateColumns: '26px 1fr auto auto', gap: 10, alignItems: 'center', padding: '9px 8px', borderTop: i === 0 ? 'none' : '1px solid #f4f3ef' }}>
                  <span style={{ fontSize: 12, color: '#9b9890', fontWeight: 600 }}>#{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1916' }}>{it.description ?? `Payment ${i + 1}`}</div>
                    <div style={{ fontSize: 11, color: '#9b9890' }}>{fmtD(it.dueDate)}</div>
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1a1916', fontVariantNumeric: 'tabular-nums' }}>{aed(it.amountFils)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: '#f1efe9', color: '#6b6860', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {TYPE_LABEL[it.type ?? 'installment'] ?? 'Rent'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
