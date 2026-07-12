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
import { buildSegregatedPlan, segRowsFromContract, type SegPaymentInput } from '@/lib/segregatedPlan';
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

const GREEN = '#1a5a4a';
const INK = '#1c1b17';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
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
}

/** A contract shape sufficient to derive the plan rows + heading metadata. */
export interface PlanViewerContract extends PlanContract {
  id?: number;
  ref?: string | null;
  planRefNo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  property?: { buildingName?: string | null; community?: string | null; emirate?: string | null } | null;
  unit?: { number?: string | null } | null;
  tenant?: { name?: string | null; companyName?: string | null } | null;
  landlord?: { name?: string | null; companyName?: string | null; bankAccountName?: string | null } | null;
  payments?: PlanPayment[] | null;
}

/** Re-exported for call sites that already import it from here. */
export { segRowsFromContract };

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 38, fontSize: 10, color: INK, fontFamily: 'Roboto' },
  headTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: GREEN, paddingBottom: 7 },
  h1: { fontSize: 17, fontWeight: 700, color: GREEN },
  pill: { fontSize: 8, fontWeight: 700, color: GREEN, backgroundColor: '#e4efeb', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10 },
  sub: { fontSize: 9, color: MUTE, marginTop: 6 },
  planref: { fontWeight: 700, color: GREEN },
  landlordWrap: { marginTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: HAIR_SOFT },
  k: { fontSize: 8, color: FAINT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  landlordName: { fontSize: 15, fontWeight: 700, color: INK },
  metaRow: { flexDirection: 'row', marginTop: 12 },
  metaCol: { width: '33.33%', paddingRight: 10 },
  v: { fontSize: 11, fontWeight: 700, color: INK },
  muted: { fontSize: 8.5, color: FAINT, marginTop: 18 },
});

/** Renewal → "Renewal" pill; else "New Lease". */
function pillLabel(contractType?: string | null): string {
  return (contractType ?? '').toLowerCase() === 'renewal' ? 'Renewal' : 'New Lease';
}

export function PaymentPlanDoc({ rows, refLabel, planRefNo, meta }: {
  rows: SegPaymentInput[]; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta;
}) {
  const plan = buildSegregatedPlan(rows);
  return (
    <Document title={refLabel ? `Payment summary — ${refLabel}` : 'Payment summary'}>
      <Page size="A4" style={s.page}>
        <View style={s.headTop}>
          <Text style={s.h1}>Payment Summary</Text>
          <Text style={s.pill}>{pillLabel(meta?.contractType)}</Text>
        </View>
        <Text style={s.sub}>
          {refLabel ? `Contract ${refLabel}` : 'Payment plan'}
          {planRefNo ? <Text>  ·  Plan ref <Text style={s.planref}>{planRefNo}</Text></Text> : null}
        </Text>

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

        <View style={{ marginTop: 16 }}>
          <SegregatedSections plan={plan} />
        </View>

        <Text style={s.muted}>System-generated payment plan. Amounts in UAE Dirhams (AED).</Text>
      </Page>
    </Document>
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

export function PaymentPlanInline({ rows, refLabel, planRefNo, meta, height = 100000, showDownload = false }: {
  rows: SegPaymentInput[]; refLabel?: string | null; planRefNo?: string | null; meta?: PaymentPlanMeta; height?: number; showDownload?: boolean;
}) {
  const key = `plan-inline|${refLabel ?? ''}|${planRefNo ?? ''}|${rows.length}`;
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
  const key = `plan-dl|${refLabel ?? ''}|${planRefNo ?? ''}|${rows.length}`;
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
  const key = `plan|${contract.id ?? refLabel ?? ''}|${planRefNo ?? ''}|${rows.length}`;
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
