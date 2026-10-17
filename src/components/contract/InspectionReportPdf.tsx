/**
 * Move-in / Move-out Inspection Checklist — react-pdf document. Snapshotted to a
 * stored PDF when the inspection is counter-signed, so the contract documents
 * binder shows a real document instead of re-rendering the live inspection page.
 *
 * Renders the structured checklist (areas → items → conditions + remarks),
 * general notes, move-out utility/DEWA clearance and the drawn signatures
 * (data-URLs, always embeddable). Photo evidence is listed by caption — the
 * stored photos remain viewable on the live inspection page.
 */
'use client';

import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';

type Condition = 'G' | 'F' | 'D' | '';
export interface InspItem { name: string; inCondition: Condition; outCondition: Condition; photoCount?: number }
export interface InspArea { name: string; items: InspItem[]; remarks: string }
export interface InspUtility { provider: string; cleared: boolean; outstanding: string; reference: string }
export interface InspectionPdfData {
  type: 'move_in' | 'move_out';
  ref: string;
  property: string; unit: string; tenantName: string;
  inspectorName: string;
  inspectionDate: string | null;
  moveInDate: string | null;
  areas: InspArea[];
  generalNotes: string;
  photoCaptions: string[];
  utilities: InspUtility[];
  billNotes?: string;
  tenantSig: string | null; tenantSignedAt: string | null;
  rpCounterSig: string | null; rpCounterSignedAt: string | null;
}

// Only embed inline (data-URL) signatures — a remote private URL would 403 in the
// browser and fail the whole PDF. Drawn signatures are data-URLs.
const isImg = (s: string | null | undefined): s is string => typeof s === 'string' && s.startsWith('data:');
const COND: Record<Condition, string> = { G: 'Good', F: 'Fair', D: 'Damaged', '': '—' };
const COND_COLOR: Record<Condition, string> = { G: '#1a7a5a', F: '#9a6a12', D: '#b42318', '': '#8a948d' };
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const NAVY = '#1a3c6e';
const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 44, paddingHorizontal: 38, fontSize: 9.5, color: '#14201a', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${NAVY}`, paddingBottom: 8 },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY },
  sub: { fontSize: 9, color: '#5f6b63', marginTop: 2 },
  metaRow: { flexDirection: 'row', marginTop: 12, gap: 18, flexWrap: 'wrap' },
  metaCol: { width: '30%' },
  metaLabel: { fontSize: 7.5, color: '#8a948d', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaVal: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 16, marginBottom: 5, borderBottom: '1px solid #e3e0d9', paddingBottom: 3 },
  areaName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 3 },
  thead: { flexDirection: 'row', backgroundColor: '#eef1ef', paddingVertical: 3, paddingHorizontal: 4 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#5f6b63', textTransform: 'uppercase' },
  trow: { flexDirection: 'row', paddingVertical: 2.5, paddingHorizontal: 4, borderBottom: '0.5px solid #f0ede7' },
  cItem: { flexGrow: 1, width: '46%' },
  cCond: { width: '18%' },
  cRem: { width: '36%', color: '#5f6b63' },
  remark: { fontSize: 8.5, color: '#5f6b63', marginTop: 2, fontStyle: 'italic' },
  util: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5, borderBottom: '0.5px solid #f0ede7' },
  muted: { fontSize: 8.5, color: '#5f6b63' },
  bullet: { fontSize: 8.5, color: '#5f6b63', marginBottom: 1 },
  sigRow: { flexDirection: 'row', gap: 40, marginTop: 28 },
  sigCol: { flexGrow: 1 },
  sigImg: { height: 42, marginBottom: 4, objectFit: 'contain' },
  sigLine: { borderTop: '1px solid #14201a', paddingTop: 3, fontSize: 8.5, color: '#5f6b63' },
});

export default function InspectionReportPdf({ data }: { data: InspectionPdfData }) {
  const isOut = data.type === 'move_out';
  const title = isOut ? 'Move-out Inspection Checklist' : 'Move-in Inspection Checklist';
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.h1}>{title}</Text>
            <Text style={s.sub}>Contract {data.ref}{data.inspectionDate ? ` · inspected ${fmt(data.inspectionDate)}` : ''}</Text>
          </View>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1a7a5a' }}>SIGNED</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}><Text style={s.metaLabel}>Tenant</Text><Text style={s.metaVal}>{data.tenantName || '—'}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>Property</Text><Text style={s.metaVal}>{data.property || '—'}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>Unit</Text><Text style={s.metaVal}>{data.unit || '—'}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>Inspector</Text><Text style={s.metaVal}>{data.inspectorName || '—'}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>{isOut ? 'Move-out date' : 'Move-in date'}</Text><Text style={s.metaVal}>{fmt(data.moveInDate)}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>Inspection date</Text><Text style={s.metaVal}>{fmt(data.inspectionDate)}</Text></View>
        </View>

        <Text style={s.sectionTitle}>Condition checklist</Text>
        {data.areas.map((area, ai) => (
          <View key={ai} wrap={false}>
            <Text style={s.areaName}>{area.name}</Text>
            <View style={s.thead}>
              <Text style={[s.th, s.cItem]}>Item</Text>
              <Text style={[s.th, s.cCond]}>{isOut ? 'Move-in' : 'Condition'}</Text>
              {isOut ? <Text style={[s.th, s.cCond]}>Move-out</Text> : null}
              <Text style={[s.th, s.cRem]}>{isOut ? '' : 'Notes'}</Text>
            </View>
            {area.items.map((it, ii) => (
              <View key={ii} style={s.trow}>
                <Text style={s.cItem}>{it.name}{it.photoCount ? `  (${it.photoCount} photo${it.photoCount > 1 ? 's' : ''})` : ''}</Text>
                <Text style={[s.cCond, { color: COND_COLOR[it.inCondition] ?? '#8a948d' }]}>{COND[it.inCondition] ?? '—'}</Text>
                {isOut ? <Text style={[s.cCond, { color: COND_COLOR[it.outCondition] ?? '#8a948d' }]}>{COND[it.outCondition] ?? '—'}</Text> : null}
                <Text style={s.cRem}></Text>
              </View>
            ))}
            {area.remarks ? <Text style={s.remark}>Remarks: {area.remarks}</Text> : null}
          </View>
        ))}

        {data.generalNotes ? (<><Text style={s.sectionTitle}>General notes</Text><Text style={s.muted}>{data.generalNotes}</Text></>) : null}

        {isOut && data.utilities.length > 0 ? (
          <>
            <Text style={s.sectionTitle}>Utility / DEWA clearance</Text>
            {data.utilities.map((u, i) => (
              <View key={i} style={s.util}>
                <Text>{u.provider}{u.reference ? ` · ${u.reference}` : ''}</Text>
                <Text style={{ color: u.cleared ? '#1a7a5a' : '#b42318', fontFamily: 'Helvetica-Bold' }}>
                  {u.cleared ? 'Cleared' : `Outstanding AED ${u.outstanding || '0'}`}
                </Text>
              </View>
            ))}
            {data.billNotes ? <Text style={[s.muted, { marginTop: 4 }]}>{data.billNotes}</Text> : null}
          </>
        ) : null}

        {data.photoCaptions.length > 0 ? (
          <>
            <Text style={s.sectionTitle}>Photo evidence ({data.photoCaptions.length})</Text>
            {data.photoCaptions.map((c, i) => <Text key={i} style={s.bullet}>• {c}</Text>)}
            <Text style={[s.muted, { marginTop: 3 }]}>Photos are viewable on the inspection record.</Text>
          </>
        ) : null}

        <View style={s.sigRow}>
          <View style={s.sigCol}>
            {isImg(data.tenantSig) ? <Image style={s.sigImg} src={data.tenantSig} /> : <View style={{ height: 42 }} />}
            <Text style={s.sigLine}>Tenant — {data.tenantName || ''}{data.tenantSignedAt ? ` · ${fmt(data.tenantSignedAt)}` : ''}</Text>
          </View>
          <View style={s.sigCol}>
            {isImg(data.rpCounterSig) ? <Image style={s.sigImg} src={data.rpCounterSig} /> : <View style={{ height: 42 }} />}
            <Text style={s.sigLine}>Rental provider — {data.inspectorName || ''}{data.rpCounterSignedAt ? ` · ${fmt(data.rpCounterSignedAt)}` : ''}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
