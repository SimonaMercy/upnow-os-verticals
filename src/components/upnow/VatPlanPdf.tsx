/**
 * VatPlanPdf — the lease's payment plan with every line split Net · VAT · Total.
 *
 * Sits beside the Payment Summary (PaymentPlanPdf), which stays as it is. Same
 * four groups and the same rows (segRowsFromContract), but separate VAT rows are
 * folded onto the charge they tax — rent VAT shows on the rent line under Rental
 * Income — see lib/vatPlan. New leases and renewals alike (a renewal simply has no
 * Security Deposit group).
 *
 *   • VatPlanDoc     — the react-pdf <Document>.
 *   • default export — full-screen viewer for the /print/vat-plan routes.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer';
import EjariCanvas from '@/components/contract/EjariCanvas';
import { useReactPdfDoc } from '@/components/contract/useReactPdfDoc';
import { segRowsFromContract, type SegPaymentInput } from '@/lib/segregatedPlan';
import { buildVatPlan } from '@/lib/vatPlan';
import { rentDiscountFromContract, type RentDiscount } from '@/lib/segregatedPlan';
import type { PlanViewerContract } from '@/components/upnow/PaymentPlanPdf';

Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 500 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

const GREEN = '#0f4f36';
const TINT = '#eef2f0';
const INK = '#1c1b17';
const MUTE = '#5f6b63';
const FAINT = '#8a948d';
const HAIR = '#e7e2d9';
const HAIR_SOFT = '#f0ece4';

const aed = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
};
const METHOD: Record<string, string> = { cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', online: 'Online' };

/** Contract fields this document reads beyond the Payment Summary's. */
export interface VatPlanContract extends PlanViewerContract {
  createdAt?: string | null;
  landlord?: PlanViewerContract['landlord'] & {
    email?: string | null; phone?: string | null; vatTrn?: string | null; address?: string | null;
    hasPoa?: boolean | null; poaPersonPhone?: string | null;
  };
  tenant?: PlanViewerContract['tenant'] & { vatTrn?: string | null; email?: string | null; phone?: string | null };
  property?: PlanViewerContract['property'] & { fullAddress?: string | null };
}

export interface VatPlanHead {
  providerName: string | null;
  providerAddress: string | null;
  providerTrn: string | null;
  providerContact: string | null;
  customerName: string | null;
  customerAddress: string | null;
  customerTrn: string | null;
  customerContact: string | null;
  unitNo: string | null;
  building: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  planDate: string | null;
  contractRef: string | null;
  isRenewal: boolean;
  bank: { accountName?: string | null; bankName?: string | null; iban?: string | null } | null;
  /** Rent discount on the lease — "Discounted" on Rental Income, Subtotal · Discount · Total Payable at the foot. */
  rentDiscount: RentDiscount | null;
}

export function vatPlanFromContract(c: VatPlanContract): { rows: SegPaymentInput[]; head: VatPlanHead } {
  const ref = c.ref ?? (c.id != null ? `CID-${c.id}` : null);
  const ll = c.landlord;
  // Power of Attorney: the provider's contact phone is the POA holder's when set
  // (same rule as the Ejari contract and the receipts).
  const providerPhone = ll?.hasPoa ? (ll.poaPersonPhone || ll.phone) : ll?.phone;
  // A customer profile has no address of its own — the leased building's is it:
  // its street address, then community + emirate unless the street line already
  // names them. Unit and building print once, in the box below the parties.
  const street = c.property?.fullAddress?.trim() || '';
  const customerAddress = [street, c.property?.community, c.property?.emirate]
    .filter((p, i): p is string => !!p && (i === 0 || !street.toLowerCase().includes(p.toLowerCase())))
    .join(', ') || null;
  return {
    rows: segRowsFromContract(c, c.payments ?? []),
    head: {
      // The name cheques are written to, as on the Payment Summary.
      providerName: ll?.bankAccountName || ll?.companyName || ll?.name || null,
      providerAddress: ll?.address?.trim() || null,
      providerTrn: ll?.vatTrn ?? null,
      providerContact: [ll?.email, providerPhone].filter(Boolean).join('  |  ') || null,
      customerName: c.tenant?.companyName || c.tenant?.name || null,
      customerAddress,
      customerTrn: c.tenant?.vatTrn ?? null,
      customerContact: [c.tenant?.email, c.tenant?.phone].filter(Boolean).join('  |  ') || null,
      unitNo: c.unit?.number ?? null,
      building: c.property?.buildingName ?? null,
      periodStart: c.startDate ?? null,
      periodEnd: c.endDate ?? null,
      planDate: c.createdAt ?? null,
      contractRef: ref,
      isRenewal: (c.contractType ?? '').toLowerCase() === 'renewal',
      bank: c.landlord?.bankDetails ?? null,
      rentDiscount: rentDiscountFromContract(c),
    },
  };
}

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 28, paddingHorizontal: 36, fontSize: 9, color: INK, fontFamily: 'Roboto' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: GREEN, paddingBottom: 6 },
  h1: { fontSize: 18, fontWeight: 700, color: GREEN },
  pill: { fontSize: 8, fontWeight: 700, color: GREEN, backgroundColor: '#e4efeb', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10 },
  refRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: HAIR_SOFT },
  parties: { flexDirection: 'row', marginTop: 10 },
  party: { width: '50%', paddingRight: 12 },
  k: { fontSize: 7, color: FAINT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 700 },
  pName: { fontSize: 10, fontWeight: 700, color: INK, marginBottom: 2 },
  pLine: { fontSize: 8.5, color: MUTE, marginTop: 1 },
  unitBox: { marginTop: 12, padding: 8, borderWidth: 1, borderColor: HAIR, borderRadius: 4 },
  unitRow: { flexDirection: 'row' },
  metaV: { fontSize: 9.5, fontWeight: 700, color: INK },
  gTitle: { fontSize: 10, fontWeight: 700, color: GREEN, marginTop: 12, marginBottom: 4 },
  table: { borderWidth: 1, borderColor: HAIR, borderRadius: 4, overflow: 'hidden' },
  thead: { flexDirection: 'row', backgroundColor: TINT, paddingVertical: 5, paddingHorizontal: 7 },
  th: { fontSize: 6.8, fontWeight: 700, color: MUTE, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 7, borderTopWidth: 0.5, borderTopColor: HAIR_SOFT },
  td: { fontSize: 8.5, color: INK },
  tdSub: { fontSize: 7, color: FAINT, marginTop: 1 },
  totRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 7, borderTopWidth: 1, borderTopColor: GREEN, backgroundColor: '#f7f9f8' },
  totTd: { fontSize: 8.5, fontWeight: 700, color: INK },
  grand: { flexDirection: 'row', marginTop: 14, paddingVertical: 8, paddingHorizontal: 7, backgroundColor: GREEN, borderRadius: 4 },
  grandTd: { fontSize: 9.5, fontWeight: 700, color: '#ffffff' },
  recRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 7, borderTopWidth: 0.5, borderTopColor: HAIR_SOFT, backgroundColor: '#f6f8f6' },
  recTd: { fontSize: 8.5, color: MUTE },
  discTag: { marginLeft: 6, marginTop: 8, fontSize: 6.5, fontWeight: 700, letterSpacing: 0.5, color: '#b91c1c', backgroundColor: '#fdede7', borderWidth: 0.5, borderColor: '#f3cabb', borderRadius: 6, paddingVertical: 1.5, paddingHorizontal: 5 },
  foot: { fontSize: 8, color: FAINT, marginTop: 10 },
  payTo: { marginTop: 12, padding: 8, borderWidth: 1, borderColor: HAIR, borderRadius: 4 },
  payRow: { flexDirection: 'row', marginTop: 4 },
  payCol: { width: '50%', paddingRight: 10 },
});

// Item · Payment method · Due date · Net · VAT · Total
const W = { item: '30%', method: '18%', due: '14%', net: '13%', vat: '11%', total: '14%' } as const;
const num = { textAlign: 'right' as const };

export function VatPlanDoc({ rows, head }: { rows: SegPaymentInput[]; head: VatPlanHead }) {
  const plan = buildVatPlan(rows);
  const methods = new Set(plan.groups.flatMap(g => g.lines.map(l => l.method ?? '')));
  const oneMethod = methods.size === 1 ? METHOD[[...methods][0]] : null;
  return (
    <Document title={`Payment Summary${head.contractRef ? ` — ${head.contractRef}` : ''}`}>
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <Text style={s.h1}>Payment Summary</Text>
          <Text style={s.pill}>{head.isRenewal ? 'Renewal' : 'New Lease'}</Text>
        </View>

        {/* Date left, reference right — the way an invoice opens. */}
        <View style={s.refRow}>
          <View><Text style={s.k}>Date</Text><Text style={s.metaV}>{fmtD(head.planDate)}</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={s.k}>Reference</Text><Text style={s.metaV}>{head.contractRef ?? '—'}</Text></View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.k}>Provider</Text>
            {head.providerName ? <Text style={s.pName}>{head.providerName}</Text> : null}
            {head.providerAddress ? <Text style={s.pLine}>{head.providerAddress}</Text> : null}
            {/* TRN always printed — a blank shows the number is missing from the profile. */}
            <Text style={s.pLine}>TRN: {head.providerTrn || '—'}</Text>
            {head.providerContact ? <Text style={s.pLine}>{head.providerContact}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.k}>Customer</Text>
            {head.customerName ? <Text style={s.pName}>{head.customerName}</Text> : null}
            {head.customerAddress ? <Text style={s.pLine}>{head.customerAddress}</Text> : null}
            <Text style={s.pLine}>TRN: {head.customerTrn || '—'}</Text>
            {head.customerContact ? <Text style={s.pLine}>{head.customerContact}</Text> : null}
          </View>
        </View>

        <View style={s.unitBox} wrap={false}>
          <View style={s.unitRow}>
            <View style={{ width: '33.33%', paddingRight: 8 }}><Text style={s.k}>Unit</Text><Text style={s.metaV}>{head.unitNo ?? '—'}</Text></View>
            <View style={{ width: '33.33%', paddingRight: 8 }}><Text style={s.k}>Building</Text><Text style={s.metaV}>{head.building ?? '—'}</Text></View>
            <View style={{ width: '33.33%' }}><Text style={s.k}>Contract period</Text><Text style={s.metaV}>{head.periodStart ? `${fmtD(head.periodStart)} – ${fmtD(head.periodEnd)}` : '—'}</Text></View>
          </View>
        </View>

        {plan.groups.map(g => {
          const gVat = g.lines.reduce((t, l) => t + (l.vat ?? 0), 0);
          return (
            <View key={g.key} wrap={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={s.gTitle}>{g.title}</Text>
                {/* Same tag as the Payment Summary: the rent here is the discounted one. */}
                {g.key === 'rental' && head.rentDiscount ? <Text style={s.discTag}>DISCOUNTED</Text> : null}
              </View>
              <View style={s.table}>
                <View style={s.thead}>
                  <Text style={[s.th, { width: W.item }]}>Item</Text>
                  <Text style={[s.th, { width: W.method }]}>Payment method</Text>
                  <Text style={[s.th, { width: W.due }]}>Due date</Text>
                  <Text style={[s.th, num, { width: W.net }]}>Net</Text>
                  <Text style={[s.th, num, { width: W.vat }]}>VAT</Text>
                  <Text style={[s.th, num, { width: W.total }]}>Total</Text>
                </View>
                {g.lines.map((l, i) => {
                  const vat = l.vat ?? 0;
                  return (
                    <View key={i} style={s.row}>
                      <Text style={[s.td, { width: W.item }]}>{l.item}</Text>
                      <View style={{ width: W.method }}>
                        <Text style={s.td}>{METHOD[l.method ?? ''] ?? '—'}</Text>
                        {l.chequeNo ? <Text style={s.tdSub}>{l.chequeNo}</Text> : null}
                      </View>
                      <Text style={[s.td, { width: W.due }]}>{fmtD(l.dueDate)}</Text>
                      <Text style={[s.td, num, { width: W.net }]}>{aed(l.amount - vat)}</Text>
                      <Text style={[s.td, num, { width: W.vat }]}>{vat > 0 ? aed(vat) : '-'}</Text>
                      <Text style={[s.td, num, { width: W.total, fontWeight: 700 }]}>{aed(l.amount)}</Text>
                    </View>
                  );
                })}
                {/* Rent as listed, less the discount, equals the section total below. */}
                {g.key === 'rental' && head.rentDiscount ? (
                  <>
                    <View style={s.recRow}>
                      <Text style={[s.recTd, { width: '62%' }]}>Rental amount</Text>
                      <Text style={[s.recTd, num, { width: W.net }]}>{aed(head.rentDiscount.listedRent)}</Text>
                      <Text style={[s.recTd, num, { width: W.vat }]}>-</Text>
                      <Text style={[s.recTd, num, { width: W.total }]}>{aed(head.rentDiscount.listedRent)}</Text>
                    </View>
                    <View style={s.recRow}>
                      <Text style={[s.recTd, { width: '62%', color: '#b91c1c' }]}>Discount{head.rentDiscount.discountType === 'percent' && head.rentDiscount.discountPercent ? ` (${head.rentDiscount.discountPercent}%)` : ''}</Text>
                      <Text style={[s.recTd, num, { width: W.net, color: '#b91c1c' }]}>- {aed(head.rentDiscount.discountAmount)}</Text>
                      <Text style={[s.recTd, num, { width: W.vat }]}>-</Text>
                      <Text style={[s.recTd, num, { width: W.total, color: '#b91c1c' }]}>- {aed(head.rentDiscount.discountAmount)}</Text>
                    </View>
                  </>
                ) : null}
                <View style={s.totRow}>
                  <Text style={[s.totTd, { width: '62%' }]}>{g.key === 'rental' && head.rentDiscount ? 'Net rent · Total' : 'Total'}</Text>
                  <Text style={[s.totTd, num, { width: W.net }]}>{aed(g.total - gVat)}</Text>
                  <Text style={[s.totTd, num, { width: W.vat }]}>{aed(gVat)}</Text>
                  <Text style={[s.totTd, num, { width: W.total }]}>{aed(g.total)}</Text>
                </View>
              </View>
            </View>
          );
        })}

        <View style={s.grand} wrap={false}>
          <Text style={[s.grandTd, { width: '62%' }]}>TOTAL PAYABLE (AED)</Text>
          <Text style={[s.grandTd, num, { width: W.net }]}>{aed(plan.grandNet)}</Text>
          <Text style={[s.grandTd, num, { width: W.vat }]}>{aed(plan.grandVat)}</Text>
          <Text style={[s.grandTd, num, { width: W.total }]}>{aed(plan.grandTotal)}</Text>
        </View>

        {/* The landlord's account — always printed when on file, cheque plans too. */}
        {head.bank?.accountName || head.bank?.bankName || head.bank?.iban ? (
          <View style={s.payTo} wrap={false}>
            <Text style={s.k}>Bank account details</Text>
            <View style={s.payRow}>
              {head.bank.accountName ? <View style={s.payCol}><Text style={s.k}>Account name</Text><Text style={s.metaV}>{head.bank.accountName}</Text></View> : null}
              {head.bank.bankName ? <View style={s.payCol}><Text style={s.k}>Bank</Text><Text style={s.metaV}>{head.bank.bankName}</Text></View> : null}
            </View>
            {head.bank.iban ? <View style={s.payRow}><View><Text style={s.k}>IBAN</Text><Text style={s.metaV}>{head.bank.iban}</Text></View></View> : null}
          </View>
        ) : null}

        <Text style={s.foot} wrap={false}>
          {oneMethod ? `Payment method for every line: ${oneMethod}. ` : ''}Amount due: AED {aed(plan.grandTotal)}. System-generated payment plan. Amounts in UAE Dirhams (AED).
        </Text>
      </Page>
    </Document>
  );
}

// ─── Full-screen viewer (default export, used by the /print/vat-plan routes) ──

const WRAP = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' } as const;
const BAR = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd', gap: 12, flexWrap: 'wrap' } as const;
const CLOSE_BTN = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' } as const;
const DL_BTN = { padding: '6px 16px', background: GREEN, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' } as const;

/**
 * Close. The binder opens this page in a NEW TAB, which has no history, so
 * history.back() did nothing. Go back when there is somewhere to go; otherwise
 * close the tab, and if the browser refuses, land on the lease itself.
 */
function closeViewer() {
  if (window.history.length > 1) { window.history.back(); return; }
  window.close();
  window.setTimeout(() => { window.location.href = window.location.pathname.replace(/\/print\/vat-plan\/?$/, ''); }, 200);
}

/** Regenerate whenever anything printed changes (not just the row count). */
function docKey(rows: SegPaymentInput[], head: VatPlanHead): string {
  const parts = JSON.stringify([head, rows.map(r => [r.paymentType, r.description, r.amount, r.vatAmount, r.transactionDate, r.paymentMethod, r.chequeNumber])]);
  let h = 5381;
  for (let i = 0; i < parts.length; i++) h = ((h << 5) + h + parts.charCodeAt(i)) | 0;
  return `vat-plan|${rows.length}|${(h >>> 0).toString(36)}`;
}

export default function VatPlanViewer({ contract }: { contract: VatPlanContract }) {
  const { rows, head } = vatPlanFromContract(contract);
  const fileName = `Payment-summary-${head.contractRef ?? 'contract'}.pdf`;
  const { bytes, url, error } = useReactPdfDoc(() => <VatPlanDoc rows={rows} head={head} />, docKey(rows, head));
  return (
    <div style={WRAP}>
      <div style={BAR}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Payment Summary{head.contractRef ? ` — ${head.contractRef}` : ''}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Net · VAT · Total for every line — system-generated</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={closeViewer} style={CLOSE_BTN}>✕ Close</button>
          {url
            ? <a href={url} download={fileName} style={DL_BTN}>⬇ Download PDF</a>
            : <span style={{ ...DL_BTN, opacity: 0.6, cursor: 'default' }}>⏳ Preparing…</span>}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {error
          ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16, color: '#fff', fontSize: 13 }}>Preview unavailable — use “⬇ Download PDF” above.</div>
          : <EjariCanvas bytes={bytes} fill />}
      </div>
    </div>
  );
}
