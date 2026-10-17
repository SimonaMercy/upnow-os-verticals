/**
 * PaymentPlanPdf — the contract's CURRENT payment plan as a REAL vector PDF, now
 * rendered as the FOUR segregated groups (Security Deposit · Rental Income ·
 * Management Fee · Third Party) via the shared <SegregatedSections/>, so the plan
 * and the payment receipts read identically. See lib/segregatedPlan for the split
 * rules (incl. the Ejari government/handling split).
 *
 *   • PaymentPlanDoc     — the react-pdf <Document> (shared by inline + viewer).
 *   • PaymentPlanInline  — embeddable canvas render for the documents binder.
 *   • default export     — a full-screen viewer (used by the /print/plan routes).
 *   • segRowsFromContract — extracts the raw payment/fee rows the groups build from.
 *
 * English-only (built-in Helvetica) — no external font fetch, matching the
 * inspection / settlement PDFs, which avoids the prod font/textkit failure modes.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer';
import EjariCanvas from '@/components/contract/EjariCanvas';
import { useReactPdfDoc } from '@/components/contract/useReactPdfDoc';
import { InlineDownloadRow } from '@/components/contract/InlineDownloadRow';
import type { PlanContract, PlanPayment } from '@/lib/currentPlan';
import { buildSegregatedPlan, rentDiscountFromContract, segRowsFromContract, type RentDiscount, type SegPaymentInput } from '@/lib/segregatedPlan';
import { SegregatedSections } from '@/components/upnow/SegregatedSections';

// Roboto — the same clean sans the receipts use (no Bold ttf shipped → bold maps to
// Medium). English-only, so no Arabic-font fetch that can fail PDF generation in prod.
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
const INK = '#1c1b17';
const MUTE = '#5f6b63';
const FAINT = '#8a948d';
const HAIR = '#e7e2d9';
const HAIR_SOFT = '#f0ece4';
const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export interface PaymentPlanMeta {
  buildingName?: string | null;
  unitNumber?: string | null;
  community?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  tenantName?: string | null;
  landlordName?: string | null;
  /** 'renewal' → "Renewal" pill; anything else → "New Lease". */
  contractType?: string | null;
  /** How to pay. A plan telling someone to transfer or hand over cheques is
   *  incomplete without the account / payee, and the PDF is the copy they keep. */
  bankDetails?: { accountName?: string | null; bankName?: string | null; iban?: string | null } | null;
  /** Rent discount, shown on the Rental Income group — see SegregatedPlan.rentDiscount. */
  rentDiscount?: RentDiscount | null;
}

/** A contract shape sufficient to derive the plan rows + heading metadata. */
export interface PlanViewerContract extends PlanContract {
  /** Rent discount, as the lease stores it: listedRent − discountAmount = annualRent. */
  listedRent?: number | null;
  discountType?: 'percent' | 'fixed' | string | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  id?: number;
  ref?: string | null;
  planRefNo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  property?: { buildingName?: string | null; community?: string | null; emirate?: string | null } | null;
  unit?: { number?: string | null } | null;
  tenant?: { name?: string | null; companyName?: string | null } | null;
  landlord?: { name?: string | null; companyName?: string | null; bankAccountName?: string | null;
    /** Where a bank transfer goes — the landlord's primary account (API: bankDetailsOf). */
    bankDetails?: { accountName?: string | null; bankName?: string | null; iban?: string | null } | null } | null;
  payments?: PlanPayment[] | null;
}

/** Re-exported for call sites that already import it from here. */
export { segRowsFromContract };

// ─── Styles ───────────────────────────────────────────────────────────────────

// Spacing note: the header chrome (title → landlord → 2 meta rows → table) and
// the closing note are FIXED cost on every plan, so slack there is what tips a
// short plan onto a second page for the sake of one line of small print. These
// values are deliberately tight; a plan with genuinely many line items is still
// free to run over — that is the table growing, not the chrome.
const s = StyleSheet.create({
  // Bottom padding leaves room for the pinned small print (see `muted`).
  page: { paddingTop: 26, paddingBottom: 40, paddingHorizontal: 38, fontSize: 10, color: INK, fontFamily: 'Roboto' },
  headTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: GREEN, paddingBottom: 6 },
  h1: { fontSize: 17, fontWeight: 700, color: GREEN },
  pill: { fontSize: 8, fontWeight: 700, color: GREEN, backgroundColor: '#e4efeb', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10 },
  sub: { fontSize: 9, color: MUTE, marginTop: 5 },
  planref: { fontWeight: 700, color: GREEN },
  landlordWrap: { marginTop: 9, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: HAIR_SOFT },
  payTo: { marginTop: 9, padding: 8, borderWidth: 1, borderColor: HAIR_SOFT, borderRadius: 6 },
  payToRow: { flexDirection: 'row', marginTop: 5 },
  payToCol: { width: '50%', paddingRight: 10 },
  k: { fontSize: 8, color: FAINT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  landlordName: { fontSize: 15, fontWeight: 700, color: INK },
  metaRow: { flexDirection: 'row', marginTop: 8 },
  metaCol: { width: '33.33%', paddingRight: 10 },
  v: { fontSize: 11, fontWeight: 700, color: INK },
  // Pinned to the page foot, out of the flow: as a flowing line it was the one
  // element that spilled onto a second page once the plan filled the first.
  muted: { position: 'absolute', bottom: 18, left: 38, right: 38, fontSize: 8.5, color: FAINT },
});

/** Renewal → "Renewal" pill; else "New Lease". */
function pillLabel(contractType?: string | null): string {
  return (contractType ?? '').toLowerCase() === 'renewal' ? 'Renewal' : 'New Lease';
}

/**
 * Cache key for a rendered plan PDF.
 *
 * useReactPdfDoc regenerates ONLY when this string changes, so it has to cover
 * everything the document shows. It used to be `rows.length`, which meant an
 * edit that kept the row count — a discount, a changed amount, date, method or
 * heading — handed back the previously rendered PDF, and the landlord downloaded
 * stale figures until they reloaded the page. Hashed so the key stays short.
 */
function planDocKey(prefix: string, rows: SegPaymentInput[], refLabel?: string | null, planRefNo?: string | null, meta?: PaymentPlanMeta): string {
  const parts = [
    refLabel ?? '', planRefNo ?? '',
    ...rows.map(r => `${r.description ?? ''}|${r.paymentType ?? ''}|${r.amount}|${r.vatAmount ?? ''}|${r.transactionDate ?? ''}|${r.paymentMethod ?? ''}|${r.chequeNumber ?? ''}|${r.chequeStatus ?? ''}`),
    meta ? JSON.stringify(meta) : '',
  ].join(';');
  let h = 5381;
  for (let i = 0; i < parts.length; i++) h = ((h << 5) + h + parts.charCodeAt(i)) | 0;
  return `${prefix}|${rows.length}|${(h >>> 0).toString(36)}`;
}

export function PaymentPlanDoc({ rows, refLabel, planRefNo, meta }: {
  rows: SegPaymentInput[]; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta;
}) {
  const plan = buildSegregatedPlan(rows);
  if (meta?.rentDiscount) plan.rentDiscount = meta.rentDiscount;
  return (
    <Document title={refLabel ? `Payment summary — ${refLabel}` : 'Payment summary'}>
      <Page size="A4" style={s.page}>
        <View style={s.headTop}>
          <Text style={s.h1}>Payment Summary</Text>
          <Text style={s.pill}>{pillLabel(meta?.contractType)}</Text>
        </View>
        {refLabel || planRefNo ? (
          <Text style={s.sub}>
            {refLabel ? `Contract ${refLabel}` : ''}
            {planRefNo ? <Text>{refLabel ? '  ·  ' : ''}Plan ref <Text style={s.planref}>{planRefNo}</Text></Text> : null}
          </Text>
        ) : null}

        {meta?.landlordName ? (
          <View style={s.landlordWrap}>
            <Text style={s.k}>Landlord</Text>
            <Text style={s.landlordName}>{meta.landlordName}</Text>
          </View>
        ) : null}

        {/* 3-column grid: Tenant/Unit in col 1, Building col 2, Contract period/Community col 3. */}
        <View style={s.metaRow}>
          <View style={s.metaCol}>{meta?.tenantName ? <View><Text style={s.k}>Tenant</Text><Text style={s.v}>{meta.tenantName}</Text></View> : null}</View>
          <View style={s.metaCol} />
          <View style={s.metaCol}>{meta?.periodStart ? <View><Text style={s.k}>Contract period</Text><Text style={s.v}>{fmtD(meta.periodStart)} – {fmtD(meta.periodEnd)}</Text></View> : null}</View>
        </View>
        {(meta?.unitNumber || meta?.buildingName || meta?.community) ? (
          <View style={s.metaRow}>
            <View style={s.metaCol}>{meta?.unitNumber ? <View><Text style={s.k}>Unit</Text><Text style={s.v}>{meta.unitNumber}</Text></View> : null}</View>
            <View style={s.metaCol}>{meta?.buildingName ? <View><Text style={s.k}>Building</Text><Text style={s.v}>{meta.buildingName}</Text></View> : null}</View>
            <View style={s.metaCol}>{meta?.community ? <View><Text style={s.k}>Community</Text><Text style={s.v}>{meta.community}</Text></View> : null}</View>
          </View>
        ) : null}

        <View style={{ marginTop: 11 }}>
          <SegregatedSections plan={plan} />
        </View>

        <PayTo plan={plan} meta={meta} />

        <Text style={s.muted} fixed>System-generated payment plan. Amounts in UAE Dirhams (AED).</Text>
      </Page>
    </Document>
  );
}

/**
 * "Bank transfer to" footer — shown only when a row on this plan is actually paid
 * by transfer. The cheque payee is deliberately NOT repeated here: it is the
 * landlord, already named at the top of the summary.
 */
function PayTo({ plan, meta }: { plan: ReturnType<typeof buildSegregatedPlan>; meta?: PaymentPlanMeta }) {
  const hasTransfer = plan.groups.some(g => g.lines.some(l => l.method === 'bank_transfer'));
  const bank = meta?.bankDetails ?? null;
  if (!hasTransfer || !(bank?.accountName || bank?.bankName || bank?.iban)) return null;
  return (
    <View style={s.payTo} wrap={false}>
      <Text style={s.k}>Bank transfer to</Text>
      {/* Two rows: account name + bank, then the IBAN on its own so the long
          number is never squeezed into half a column. */}
      <View style={s.payToRow}>
        {bank.accountName ? <View style={s.payToCol}><Text style={s.k}>Account name</Text><Text style={s.v}>{bank.accountName}</Text></View> : null}
        {bank.bankName ? <View style={s.payToCol}><Text style={s.k}>Bank</Text><Text style={s.v}>{bank.bankName}</Text></View> : null}
      </View>
      {bank.iban ? (
        <View style={s.payToRow}>
          <View style={{ width: '100%' }}><Text style={s.k}>IBAN</Text><Text style={s.v}>{bank.iban}</Text></View>
        </View>
      ) : null}
    </View>
  );
}

/** Derive the plan rows + heading metadata from a fetched contract. */
export function planFromContract(contract: PlanViewerContract): { rows: SegPaymentInput[]; refLabel: string | null; planRefNo: string | null; meta: PaymentPlanMeta } {
  return {
    rows: segRowsFromContract(contract, contract.payments ?? []),
    refLabel: contract.ref ?? (contract.id != null ? `CID-${contract.id}` : null),
    planRefNo: contract.planRefNo ?? null,
    meta: {
      contractType: contract.contractType ?? null,
      rentDiscount: rentDiscountFromContract(contract),
      buildingName: contract.property?.buildingName ?? null,
      unitNumber: contract.unit?.number ?? null,
      community: contract.property?.community ?? contract.property?.emirate ?? null,
      periodStart: contract.startDate ?? null,
      periodEnd: contract.endDate ?? null,
      tenantName: contract.tenant?.companyName || contract.tenant?.name || null,
      landlordName: contract.landlord?.bankAccountName || contract.landlord?.companyName || contract.landlord?.name || null,
      bankDetails: contract.landlord?.bankDetails ?? null,
    },
  };
}

// ─── Inline (embeddable) render for the documents binder ──────────────────────

export function PaymentPlanInline({ rows, refLabel, planRefNo, meta, height = 100000, showDownload = false }: {
  rows: SegPaymentInput[]; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta; height?: number; showDownload?: boolean;
}) {
  const key = planDocKey('plan-inline', rows, refLabel, planRefNo, meta);
  const { bytes, url, error } = useReactPdfDoc(() => <PaymentPlanDoc rows={rows} refLabel={refLabel} planRefNo={planRefNo} meta={meta} />, key);
  if (error) return <div style={{ padding: 24, textAlign: 'center', color: '#c00', fontSize: 13 }}>Payment plan unavailable.</div>;
  return (
    <>
      {showDownload && <InlineDownloadRow url={url} fileName={`Payment-plan-${refLabel ?? 'contract'}.pdf`} />}
      <EjariCanvas bytes={bytes} height={height} />
    </>
  );
}

/** Just the "⬇ Download PDF" row for the plan. */
export function PaymentPlanDownloadLink({ rows, refLabel, planRefNo, meta }: { rows: SegPaymentInput[]; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta }) {
  const key = planDocKey('plan-dl', rows, refLabel, planRefNo, meta);
  const { url } = useReactPdfDoc(() => <PaymentPlanDoc rows={rows} refLabel={refLabel} planRefNo={planRefNo} meta={meta} />, key);
  return <InlineDownloadRow url={url} fileName={`Payment-plan-${refLabel ?? 'contract'}.pdf`} />;
}

// ─── Full-screen viewer (default export, used by the /print/plan routes) ──────

const VIEWER_WRAP = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' } as const;
const VIEWER_BAR = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd', gap: 12, flexWrap: 'wrap' } as const;
const CLOSE_BTN = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' } as const;
const DL_BTN = { padding: '6px 16px', background: GREEN, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' } as const;

export default function PaymentPlanViewer({ contract }: { contract: PlanViewerContract }) {
  const { rows, refLabel, planRefNo, meta } = planFromContract(contract);
  const fileName = `Payment-plan-${refLabel ?? 'contract'}.pdf`;
  const key = planDocKey(`plan|${contract.id ?? ''}`, rows, refLabel, planRefNo, meta);
  const { bytes, url: downloadUrl, error } = useReactPdfDoc(() => <PaymentPlanDoc rows={rows} refLabel={refLabel} planRefNo={planRefNo} meta={meta} />, key);

  return (
    <div style={VIEWER_WRAP}>
      <div style={VIEWER_BAR}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Payment Summary{refLabel ? ` — ${refLabel}` : ''}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Security deposit · rental income · management fee · third party — system-generated</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => window.history.back()} style={CLOSE_BTN}>✕ Close</button>
          {downloadUrl
            ? <a href={downloadUrl} download={fileName} style={DL_BTN}>⬇ Download PDF</a>
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
