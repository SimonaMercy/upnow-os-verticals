/**
 * PaymentPlanPdf — the contract's CURRENT payment plan (rent, one-off fees,
 * security deposit + the cheque/instalment schedule) as a REAL vector PDF, so it
 * downloads cleanly with no browser print-dialog chrome and no watermark. Same
 * @react-pdf/renderer + pdf.js-canvas approach as the tenancy contract + receipts.
 *
 *   • PaymentPlanDoc     — the react-pdf <Document> (shared by inline + viewer).
 *   • PaymentPlanInline  — embeddable canvas render for the documents binder,
 *                          with an optional "Download PDF" affordance.
 *   • default export     — a full-screen viewer (used by the /print/plan routes),
 *                          canvas render + a blob Download button.
 *
 * English-only (built-in Helvetica) — no external font fetch, matching the
 * inspection / settlement PDFs, which avoids the prod font/textkit failure modes.
 * Mirrors the binder's OfferBlock so the printed plan matches the on-screen card.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import EjariCanvas from '@/components/contract/EjariCanvas';
import { useReactPdfDoc } from '@/components/contract/useReactPdfDoc';
import { InlineDownloadRow } from '@/components/contract/InlineDownloadRow';
import { buildCurrentPlan, type PlanContract, type PlanPayment } from '@/lib/currentPlan';
import { comparePaymentSchedule } from '@/lib/paymentPlan';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';

const GREEN = '#1a5a4a'; // --color-primary-dark — brand green accent (was navy)
const aed = (fils: number) => `AED ${Math.round((fils ?? 0) / 100).toLocaleString('en-AE')}`;
const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS_LABEL: Record<string, string> = { cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled' };
const statusLabel = (s?: string | null) => STATUS_LABEL[(s ?? '').toLowerCase()] ?? 'Pending';

export interface PaymentPlanMeta {
  buildingName?: string | null;
  unitNumber?: string | null;
  community?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  tenantName?: string | null;
  landlordName?: string | null;
  /** 'renewal' → "Renewal" badge; anything else → "New Lease". */
  contractType?: string | null;
}

/** A contract shape sufficient to derive the plan + its heading metadata. */
export interface PlanViewerContract extends PlanContract {
  id?: number;
  ref?: string | null;
  /** Gapless RP plan reference (PP-<rp>-<year>-<nnnnn>), when resolved. */
  planRefNo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  property?: { buildingName?: string | null; community?: string | null; emirate?: string | null } | null;
  unit?: { number?: string | null } | null;
  tenant?: { name?: string | null; companyName?: string | null } | null;
  landlord?: { name?: string | null; companyName?: string | null; bankAccountName?: string | null } | null;
  payments?: PlanPayment[] | null;
}

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 40, fontSize: 10, color: '#1a1916', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${GREEN}`, paddingBottom: 8 },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: GREEN },
  sub: { fontSize: 9, color: '#6b6860', marginTop: 2 },
  metaRow: { flexDirection: 'row', marginTop: 14, gap: 22, flexWrap: 'wrap' },
  metaCol: { flexGrow: 1 },
  metaLabel: { fontSize: 8, color: '#9b9890', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: GREEN, marginTop: 20, marginBottom: 6, borderBottom: '1px solid #e3e0d9', paddingBottom: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottom: '0.5px solid #f0ede7' },
  rowLabel: { flexGrow: 1 },
  amt: { fontFamily: 'Helvetica-Bold' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, marginTop: 4, borderTop: '1px solid #c5e8df' },
  totalLabel: { fontFamily: 'Helvetica-Bold', color: GREEN },
  totalAmt: { fontFamily: 'Helvetica-Bold', color: '#15803d', fontSize: 12 },
  thead: { flexDirection: 'row', backgroundColor: '#f4f3ef', paddingVertical: 4, paddingHorizontal: 4, marginTop: 4 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6b6860', textTransform: 'uppercase' },
  trow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottom: '0.5px solid #f0ede7' },
  cNum: { width: '8%' },
  cDesc: { width: '40%' },
  cDue: { width: '22%', color: '#6b6860' },
  cStatus: { width: '15%' },
  cAmt: { width: '15%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  muted: { fontSize: 8.5, color: '#9b9890', marginTop: 18 },
});

function planLines(plan: OfferPlan): { label: string; fils: number }[] {
  // Display sequence (RP spec): Security deposit → Rent (cheques, net) → Rent VAT
  // → Fees VAT → Ejari → Admin → Commission → additional charges. All base amounts
  // are NET; VAT is its own lines (rent VAT and fee VAT kept SEPARATE). Same
  // components as before, so the Total still reconciles.
  const feeVatFils = (plan.adminFeeVatFils ?? 0) + (plan.ejariVatFils ?? 0) + (plan.commissionVatFils ?? 0)
    + (plan.customFees ?? []).reduce((s, f) => s + (f.vatFils ?? 0), 0);
  const lines: { label: string; fils: number }[] = [];
  if (plan.securityDepositFils > 0) lines.push({ label: 'Security deposit', fils: plan.securityDepositFils });
  lines.push({ label: 'Rent (cheques)', fils: plan.rentFils });
  if ((plan.rentVatFils ?? 0) > 0) lines.push({ label: 'Rent VAT', fils: plan.rentVatFils ?? 0 });
  if (feeVatFils > 0) lines.push({ label: 'Fees VAT', fils: feeVatFils });
  if (plan.ejariFils > 0) lines.push({ label: 'Ejari fee', fils: plan.ejariFils });
  if (plan.adminFeeFils > 0) lines.push({ label: 'Admin fee', fils: plan.adminFeeFils });
  if (plan.commissionFils > 0) lines.push({ label: 'Commission', fils: plan.commissionFils });
  (plan.customFees ?? []).forEach(f => lines.push({ label: f.label, fils: f.netFils }));
  return lines;
}

export function PaymentPlanDoc({ plan, refLabel, planRefNo, meta }: { plan: OfferPlan; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta }) {
  const lines = planLines(plan);
  // By due date; on a same-date tie the security deposit sorts before the rent
  // installments (deposit is collected first, then the plan).
  const items = [...(plan.items ?? [])].sort(comparePaymentSchedule);
  const schedTotal = items.reduce((sum, it) => sum + (it.amountFils ?? 0), 0);
  const typeBadge = meta?.contractType == null ? null
    : meta.contractType === 'renewal'
      ? { label: 'Renewal', bg: '#eaf2fb', fg: '#1e5fae' }
      : { label: 'New Lease', bg: '#e6f5ee', fg: '#1f6f54' };
  return (
    <Document title={refLabel ? `Payment plan — ${refLabel}` : 'Payment plan'}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.h1}>Payment Plan</Text>
            <Text style={s.sub}>{refLabel ? `Contract ${refLabel} · ` : ''}Current rent, fees &amp; deposit</Text>
            {planRefNo ? <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: GREEN, marginTop: 3 }}>Plan reference: {planRefNo}</Text> : null}
          </View>
          {typeBadge ? (
            <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: typeBadge.fg, backgroundColor: typeBadge.bg, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10 }}>{typeBadge.label}</Text>
          ) : null}
        </View>

        {/* Row 1 — Tenant (left) · Landlord (right) */}
        {(meta?.tenantName || meta?.landlordName) && (
          <View style={[s.metaRow, { justifyContent: 'space-between' }]}>
            {meta?.tenantName ? <View><Text style={s.metaLabel}>Tenant</Text><Text style={s.metaVal}>{meta.tenantName}</Text></View> : <View />}
            {meta?.landlordName ? <View style={{ alignItems: 'flex-end' }}><Text style={s.metaLabel}>Landlord</Text><Text style={s.metaVal}>{meta.landlordName}</Text></View> : <View />}
          </View>
        )}
        {/* Row 2 — Unit · Building · Community (left) · Contract period (right) */}
        {(meta?.unitNumber || meta?.buildingName || meta?.community || meta?.periodStart) && (
          <View style={[s.metaRow, { marginTop: 10, justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'row', gap: 22 }}>
              {meta?.unitNumber ? <View><Text style={s.metaLabel}>Unit</Text><Text style={s.metaVal}>{meta.unitNumber}</Text></View> : null}
              {meta?.buildingName ? <View><Text style={s.metaLabel}>Building</Text><Text style={s.metaVal}>{meta.buildingName}</Text></View> : null}
              {meta?.community ? <View><Text style={s.metaLabel}>Community</Text><Text style={s.metaVal}>{meta.community}</Text></View> : null}
            </View>
            {meta?.periodStart ? <View style={{ alignItems: 'flex-end' }}><Text style={s.metaLabel}>Contract period</Text><Text style={s.metaVal}>{fmtD(meta.periodStart)} – {fmtD(meta.periodEnd)}</Text></View> : <View />}
          </View>
        )}

        <Text style={s.sectionTitle}>Summary</Text>
        {lines.map((l, i) => (
          <View key={i} style={s.row}><Text style={s.rowLabel}>{l.label}</Text><Text style={s.amt}>{aed(l.fils)}</Text></View>
        ))}
        <View style={s.totalRow}><Text style={s.totalLabel}>Total</Text><Text style={s.totalAmt}>{aed(plan.totalAmountFils)}</Text></View>

        {items.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Schedule · {plan.installmentCount} instalment{plan.installmentCount === 1 ? '' : 's'}</Text>
            <View style={s.thead}>
              <Text style={[s.th, s.cNum]}>#</Text>
              <Text style={[s.th, s.cDesc]}>Description</Text>
              <Text style={[s.th, s.cDue]}>Due date</Text>
              <Text style={[s.th, s.cStatus]}>Status</Text>
              <Text style={[s.th, s.cAmt]}>Amount</Text>
            </View>
            {items.map((it, i) => (
              <View key={it.index ?? i} style={s.trow}>
                <Text style={s.cNum}>{i + 1}</Text>
                <Text style={s.cDesc}>{it.description ?? `Payment ${i + 1}`}</Text>
                <Text style={s.cDue}>{fmtD(it.dueDate)}</Text>
                <Text style={s.cStatus}>{statusLabel(it.status)}</Text>
                <Text style={s.cAmt}>{aed(it.amountFils)}</Text>
              </View>
            ))}
            <View style={s.totalRow}><Text style={s.totalLabel}>Schedule total</Text><Text style={s.amt}>{aed(schedTotal)}</Text></View>
          </>
        )}

        <Text style={s.muted}>System-generated payment plan. Amounts in UAE Dirhams (AED).</Text>
      </Page>
    </Document>
  );
}

/** Derive the OfferPlan + heading metadata from a fetched contract. */
export function planFromContract(contract: PlanViewerContract): { plan: OfferPlan; refLabel: string | null; planRefNo: string | null; meta: PaymentPlanMeta } {
  const plan = buildCurrentPlan(contract, contract.payments ?? []);
  return {
    plan,
    refLabel: contract.ref ?? (contract.id != null ? `CID-${contract.id}` : null),
    planRefNo: contract.planRefNo ?? null,
    meta: {
      contractType: contract.contractType ?? null,
      buildingName: contract.property?.buildingName ?? null,
      unitNumber: contract.unit?.number ?? null,
      community: contract.property?.community ?? contract.property?.emirate ?? null,
      periodStart: contract.startDate ?? null,
      periodEnd: contract.endDate ?? null,
      tenantName: contract.tenant?.companyName || contract.tenant?.name || null,
      landlordName: contract.landlord?.bankAccountName || contract.landlord?.companyName || contract.landlord?.name || null,
    },
  };
}

// ─── Inline (embeddable) render for the documents binder ──────────────────────

export function PaymentPlanInline({ plan, refLabel, planRefNo, meta, height = 100000, showDownload = false }: {
  plan: OfferPlan; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta; height?: number; showDownload?: boolean;
}) {
  const key = `plan-inline|${refLabel ?? ''}|${planRefNo ?? ''}|${plan.totalAmountFils}|${plan.items?.length ?? 0}`;
  const { bytes, url, error } = useReactPdfDoc(() => <PaymentPlanDoc plan={plan} refLabel={refLabel} planRefNo={planRefNo} meta={meta} />, key);
  if (error) return <div style={{ padding: 24, textAlign: 'center', color: '#c00', fontSize: 13 }}>Payment plan unavailable.</div>;
  return (
    <>
      {showDownload && <InlineDownloadRow url={url} fileName={`Payment-plan-${refLabel ?? 'contract'}.pdf`} />}
      <EjariCanvas bytes={bytes} height={height} />
    </>
  );
}

/** Just the "⬇ Download PDF" row for the plan — for surfaces that render their own
 *  native plan table (the binder's OfferBlock) but still want a clean download. */
export function PaymentPlanDownloadLink({ plan, refLabel, planRefNo, meta }: { plan: OfferPlan; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta }) {
  const key = `plan-dl|${refLabel ?? ''}|${planRefNo ?? ''}|${plan.totalAmountFils}|${plan.items?.length ?? 0}`;
  const { url } = useReactPdfDoc(() => <PaymentPlanDoc plan={plan} refLabel={refLabel} planRefNo={planRefNo} meta={meta} />, key);
  return <InlineDownloadRow url={url} fileName={`Payment-plan-${refLabel ?? 'contract'}.pdf`} />;
}

// ─── Full-screen viewer (default export, used by the /print/plan routes) ──────

const VIEWER_WRAP = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' } as const;
const VIEWER_BAR = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd', gap: 12, flexWrap: 'wrap' } as const;
const CLOSE_BTN = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' } as const;
const DL_BTN = { padding: '6px 16px', background: GREEN, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' } as const;

export default function PaymentPlanViewer({ contract }: { contract: PlanViewerContract }) {
  const { plan, refLabel, planRefNo, meta } = planFromContract(contract);
  const fileName = `Payment-plan-${refLabel ?? 'contract'}.pdf`;
  const key = `plan|${contract.id ?? refLabel ?? ''}|${planRefNo ?? ''}|${plan.totalAmountFils}|${plan.items?.length ?? 0}`;
  const { bytes, url: downloadUrl, error } = useReactPdfDoc(() => <PaymentPlanDoc plan={plan} refLabel={refLabel} planRefNo={planRefNo} meta={meta} />, key);

  return (
    <div style={VIEWER_WRAP}>
      <div style={VIEWER_BAR}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Payment Plan{refLabel ? ` — ${refLabel}` : ''}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Current rent, fees &amp; deposit — system-generated</p>
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
