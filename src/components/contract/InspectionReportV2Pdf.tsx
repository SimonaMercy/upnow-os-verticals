/**
 * Move-in / Move-out Inspection Report (v2 category model) — react-pdf document.
 *
 * The printable twin of the on-screen <InspectionReportView>: same jade-themed
 * layout — title + date boxes, the three detail cards, summary tiles, the
 * category → component table (Good/Fair/Poor + quantity, plus the restoration
 * cost column for a move-out RP/inspector), general notes, and the two-party
 * signatures. Kept visually consistent with the web preview so a downloaded PDF
 * reads like what the user saw on screen. Photo evidence stays on the live report.
 */
'use client';

import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { InspectionDoc, InspectionItem, Condition } from '@/lib/inspectionCatalog';

export interface InspectionV2PdfMeta {
  property: string; unitNo: string; propertyType: string; floor: string;
  tenantName: string; tenantPhone: string; tenantEmail: string;
  inspectorName: string; inspectorCompany: string; inspectorRole: string;
}
export interface InspectionV2PdfData {
  doc: InspectionDoc;
  meta: InspectionV2PdfMeta;
  phase: 'move_in' | 'move_out';
  ref: string;
  showMoney: boolean;
  inspectionDate: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  totals: { categories: number; items: number; defective: number; itemsToReplace: number; estCostAed: number };
}

const isImg = (v: string | null | undefined): v is string => typeof v === 'string' && v.startsWith('data:');
const AED = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const quantityOf = (it: InspectionItem) => it.quantity ?? it.quantityToReplace ?? 0;
const cap = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : '—');
/** Unit types are stored as snake_case enums (`staff_accommodation`) — print them
 *  as words: "Staff Accommodation". */
const titleCase = (v: string) =>
  (v ?? '').split(/[_\-\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const CONDC: Record<string, string> = { good: '#047246', fair: '#c98a1a', poor: '#c0392b', '': '#8a948d' };

// Jade palette mirroring InspectionReportView.module.css.
const JADE = '#047246';
const INK = '#14201a';
const MUTE = '#8a948d';
const LINE = '#e4e9e5';
const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: INK, letterSpacing: 0.3 },
  h1sub: { fontSize: 8, color: MUTE, marginTop: 1 },
  dateBoxes: { flexDirection: 'row', gap: 6 },
  dateBox: { borderRadius: 6, border: `1px solid ${LINE}`, backgroundColor: '#faf9f6', paddingVertical: 4, paddingHorizontal: 7, minWidth: 74 },
  dbK: { fontSize: 6.5, color: MUTE, textTransform: 'uppercase', letterSpacing: 0.4 },
  dbV: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  cards: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  card: { flexGrow: 1, flexBasis: 0, width: '33%', border: `1px solid ${LINE}`, borderRadius: 7, padding: 8, overflow: 'hidden' },
  cardH: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: JADE, marginBottom: 4 },
  kv: { flexDirection: 'row', marginBottom: 1.5 },
  kvK: { fontSize: 7.5, color: MUTE, width: '42%', paddingRight: 4 },
  kvV: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'right', width: '58%' },
  tiles: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tile: { flexGrow: 1, borderRadius: 7, padding: 8, backgroundColor: '#f4faf7', border: `1px solid #d9efe6` },
  tileL: { fontSize: 7, color: '#4a6c60', textTransform: 'uppercase' },
  tileV: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 2 },
  secH: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 4, marginBottom: 5 },
  thead: { flexDirection: 'row', backgroundColor: '#eef1ef', paddingVertical: 4, paddingHorizontal: 5, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  th: { fontSize: 6.8, fontFamily: 'Helvetica-Bold', color: '#5f6b63', textTransform: 'uppercase' },
  catHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eef7f2', paddingVertical: 3.5, paddingHorizontal: 5, marginTop: 5, borderRadius: 4 },
  catName: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK },
  catMeta: { fontSize: 7, color: MUTE, marginLeft: 6 },
  trow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 5, borderBottom: `0.5px solid #f0ede7` },
  cNo: { width: '7%', color: MUTE, fontSize: 7.5 },
  cComp: { width: '31%' },
  cCond: { width: '13%' },
  condPill: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  cQty: { width: '11%', textAlign: 'center' },
  cCost: { width: '13%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  cRem: { width: '25%', color: '#5f6b63', fontSize: 7.8 },
  costFoot: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTop: `1px solid ${LINE}`, gap: 10 },
  costK: { fontSize: 8.5, color: '#5f6b63' },
  costV: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: JADE },
  notesH: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 12, marginBottom: 3 },
  notes: { fontSize: 8.5, color: '#3a382f', lineHeight: 1.4, border: `1px solid ${LINE}`, borderRadius: 6, padding: 7, backgroundColor: '#faf9f6' },
  sigRow: { flexDirection: 'row', gap: 20, marginTop: 22 },
  sigCol: { flexGrow: 1, width: '48%', border: `1px solid ${LINE}`, borderRadius: 7, padding: 9 },
  sigRole: { fontSize: 7, color: MUTE, textTransform: 'uppercase', marginBottom: 2 },
  sigName: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  sigCompany: { fontSize: 7.5, color: MUTE, marginBottom: 4 },
  sigImg: { height: 40, objectFit: 'contain', marginBottom: 3 },
  sigPad: { height: 40, borderBottom: `1px solid ${INK}`, marginBottom: 3 },
  sigDate: { fontSize: 7, color: MUTE },
  ack: { fontSize: 7.5, color: '#5f6b63', marginTop: 14, lineHeight: 1.4 },
});

export default function InspectionReportV2Pdf({ data }: { data: InspectionV2PdfData }) {
  const { doc, meta, phase, ref, showMoney, totals } = data;
  const isOut = phase === 'move_out';
  const categories = (doc.categories ?? []).filter((c) => (c.items ?? []).length > 0);

  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        {/* Title + date boxes */}
        <View style={s.titleRow}>
          <View style={s.title}>
            <View>
              {/* Phase lives in the "Inspection Type" box, so the heading itself
                  stays the neutral document name. */}
              <Text style={s.h1}>INSPECTION REPORT</Text>
              <Text style={s.h1sub}>Contract {ref}</Text>
            </View>
          </View>
          <View style={s.dateBoxes}>
            <View style={s.dateBox}><Text style={s.dbK}>Move-In Date</Text><Text style={s.dbV}>{fmt(data.moveInDate)}</Text></View>
            {isOut && <View style={s.dateBox}><Text style={s.dbK}>Move-Out Date</Text><Text style={s.dbV}>{fmt(data.moveOutDate)}</Text></View>}
            <View style={s.dateBox}><Text style={s.dbK}>Inspection Type</Text><Text style={s.dbV}>{isOut ? 'Move-Out' : 'Move-In'}</Text></View>
          </View>
        </View>

        {/* Detail cards */}
        <View style={s.cards}>
          <View style={s.card}>
            <Text style={s.cardH}>Property Details</Text>
            <Kv k="Property Name" v={meta.property} />
            <Kv k="Unit No." v={meta.unitNo} />
            <Kv k="Property Type" v={titleCase(meta.propertyType)} />
            <Kv k="Floor" v={meta.floor} />
          </View>
          <View style={s.card}>
            <Text style={s.cardH}>Tenant Details</Text>
            <Kv k="Tenant Name" v={meta.tenantName} />
            <Kv k="Phone" v={meta.tenantPhone} />
            <Kv k="Email" v={meta.tenantEmail} />
          </View>
          <View style={s.card}>
            <Text style={s.cardH}>Inspection Team</Text>
            <Kv k="Inspected By" v={meta.inspectorName} />
            <Kv k="Role" v={meta.inspectorRole || 'Property Representative'} />
          </View>
        </View>

        {/* Summary tiles — move-out only, exactly as <InspectionReportView> renders
            them. A move-in report carries no Total Categories / Total Items /
            Items Flagged counters. */}
        {isOut && (
          <View style={s.tiles}>
            <View style={s.tile}><Text style={s.tileL}>Total Categories</Text><Text style={s.tileV}>{totals.categories}</Text></View>
            <View style={s.tile}><Text style={s.tileL}>Total Items</Text><Text style={s.tileV}>{totals.items}</Text></View>
            <View style={s.tile}><Text style={s.tileL}>Items to be Replaced</Text><Text style={s.tileV}>{totals.itemsToReplace}</Text></View>
            {showMoney && <View style={s.tile}><Text style={s.tileL}>Est. Total Cost (AED)</Text><Text style={s.tileV}>{AED(totals.estCostAed)}</Text></View>}
          </View>
        )}

        {/* Component table */}
        <Text style={s.secH}>Component Inspection Details</Text>
        <View style={s.thead}>
          <Text style={[s.th, s.cNo]}>No.</Text>
          <Text style={[s.th, s.cComp]}>Sub Category / Component</Text>
          <Text style={[s.th, s.cCond]}>Condition</Text>
          <Text style={[s.th, s.cQty]}>{isOut ? 'To Replace' : 'Qty'}</Text>
          {showMoney && <Text style={[s.th, s.cCost, { textAlign: 'right' }]}>Cost (AED)</Text>}
          <Text style={[s.th, s.cRem]}>Remarks</Text>
        </View>
        {categories.length === 0 && <Text style={{ fontSize: 8.5, color: MUTE, padding: 8 }}>No components recorded.</Text>}
        {categories.map((cat, ci) => (
          <View key={cat.sectionId} wrap={false}>
            <View style={s.catHead}>
              <Text style={s.catName}>{ci + 1}. {cat.label || 'Category'}</Text>
            </View>
            {cat.items.map((it, ri) => {
              const cond = ((isOut ? it.outCondition : it.inCondition) ?? '') as Condition;
              const qty = quantityOf(it);
              return (
                <View key={it.id} style={s.trow}>
                  <Text style={s.cNo}>{ci + 1}.{ri + 1}</Text>
                  <Text style={s.cComp}>{it.componentName}{it.subCategory ? ` · ${it.subCategory}` : ''}</Text>
                  <Text style={[s.cCond, s.condPill, { color: CONDC[cond] || CONDC[''] }]}>{cap(cond)}</Text>
                  <Text style={s.cQty}>{qty || '—'}</Text>
                  {showMoney && <Text style={s.cCost}>{(it.totalCostAed ?? 0) ? AED(it.totalCostAed as number) : '—'}</Text>}
                  <Text style={s.cRem}>{it.remarks || ''}</Text>
                </View>
              );
            })}
          </View>
        ))}

        {/* Totals already shown in the summary tiles above — no duplicated footer. */}

        {(doc.generalNotes ?? '').trim() ? (
          <>
            <Text style={s.notesH}>General Notes</Text>
            <Text style={s.notes}>{doc.generalNotes}</Text>
          </>
        ) : null}

        {/* Signatures */}
        <View style={s.sigRow} wrap={false}>
          <View style={s.sigCol}>
            <Text style={s.sigRole}>Inspected By — Property Representative</Text>
            {/* Inspector cell names the PERSON who inspected and their role — the
                landlord's own name/company is not repeated here. */}
            <Text style={s.sigName}>{doc.rpCounterSigName || meta.inspectorName || '—'}</Text>
            <Text style={s.sigCompany}>{meta.inspectorRole || 'Property Representative'}</Text>
            {isImg(doc.rpCounterSig) ? <Image src={doc.rpCounterSig} style={s.sigImg} /> : <View style={s.sigPad} />}
            <Text style={s.sigDate}>Date: {doc.rpCounterSignedAt ? fmt(doc.rpCounterSignedAt) : '—'}</Text>
          </View>
          <View style={s.sigCol}>
            <Text style={s.sigRole}>Confirmed By — Customer</Text>
            <Text style={s.sigName}>{meta.tenantName || '—'}</Text>
            <Text style={s.sigCompany}>{meta.tenantPhone || meta.tenantEmail || '—'}</Text>
            {isImg(doc.tenantSig) ? <Image src={doc.tenantSig} style={s.sigImg} /> : <View style={s.sigPad} />}
            <Text style={s.sigDate}>Date: {doc.tenantSignedAt ? fmt(doc.tenantSignedAt) : '—'}</Text>
          </View>
        </View>

        <Text style={s.ack}>
          I, {meta.tenantName || 'the customer'}, confirm I have reviewed this inspection report and acknowledge the condition of the property and items listed above at the time of {isOut ? 'move-out' : 'move-in / handover'}.
        </Text>
      </Page>
    </Document>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}><Text style={s.kvK}>{k}</Text><Text style={s.kvV}>{v || '—'}</Text></View>
  );
}
