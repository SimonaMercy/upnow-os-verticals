/**
 * SignatureCertificatePdf — DocuSign-style "Certificate of Completion" for a
 * tenancy contract's signatures, rendered as a REAL vector PDF (same
 * @react-pdf/renderer + pdf.js-canvas approach as the plan/receipt PDFs).
 *
 * Data comes from GET /contracts/:id/signature-certificate (migration 0124):
 * each signature's frozen evidence (channel, IP, device, consent, terms
 * SHA-256) plus the append-only envelope event trail (link sent → viewed →
 * signed). The certificate intentionally carries NO signature images — it
 * proves the signing CONTEXT; the executed contract PDF carries the images.
 *
 *   • SignatureCertificateDoc    — the react-pdf <Document>.
 *   • SignatureCertificateInline — embeddable canvas render for the binder.
 *   • fetchSignatureCertificate  — typed loader for the endpoint.
 *
 * English-only (built-in Helvetica) — no external font fetch, matching the
 * other generated PDFs. Times shown in Asia/Dubai (GST), matching the app.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import EjariCanvas from '@/components/contract/EjariCanvas';
import { useReactPdfDoc } from '@/components/contract/useReactPdfDoc';
import { InlineDownloadRow } from '@/components/contract/InlineDownloadRow';

const GREEN = '#0f4f36';

export interface CertificateSignature {
  id: number;
  role: 'landlord' | 'tenant' | string;
  signatoryName: string | null;
  method: string | null;
  signedVia: string | null;
  signedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  signerEmail: string | null;
  consentGiven: boolean;
  consentText: string | null;
  clientMeta: { timezone?: string; locale?: string; platform?: string; screen?: string } | null;
  termsHash: string | null;
  actorUserId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  geoCity: string | null;
  geoLat: number | string | null;
  geoLng: number | string | null;
  geoSource: string | null;
}

export interface CertificateEvent {
  id: number;
  event: string;
  role: string | null;
  at: string;
  ipAddress: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
}

export interface CertificateContract {
  id: number;
  contractType: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: string | number | null;
  propertyName: string | null;
  unitNumber: string | null;
  tenantCompany: string | null;
  tenantName: string | null;
  landlordCompany: string | null;
  landlordName: string | null;
}

export interface SignatureCertificateData {
  contract: CertificateContract | null;
  signatures: CertificateSignature[];
  events: CertificateEvent[];
}

export async function fetchSignatureCertificate(contractId: number | string, signal?: AbortSignal): Promise<SignatureCertificateData | null> {
  try {
    const res = await fetch(`/api/contracts/${contractId}/signature-certificate`, { credentials: 'include', signal });
    if (!res.ok) return null;
    return await res.json() as SignatureCertificateData;
  } catch {
    return null;
  }
}

export const SIGNED_VIA_LABEL: Record<string, string> = {
  rp_dashboard: 'UpNow dashboard (rental provider / manager)',
  customer_dashboard: 'UpNow customer dashboard (logged in)',
  tenant_portal: 'Secure emailed signing link (tenant portal)',
  landlord_link: 'Secure emailed signing link (landlord)',
  on_file: 'Signed on paper — marked on file',
};

export const EVENT_LABEL: Record<string, string> = {
  link_sent: 'Signing link emailed',
  link_opened: 'Link opened',
  contract_viewed: 'Contract reviewed',
  signed: 'Signature executed',
  addendum_signed: 'Addendum signed',
  on_file_marked: 'Marked signed on file (paper / imported)',
};

/** Full timestamp in Dubai time — "7 Jul 2026, 14:03:22 GST". */
export const fmtDT = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString('en-AE', {
        timeZone: 'Asia/Dubai',
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }) + ' GST'
    : '—';

const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** "Chrome 126 on macOS"-style summary; falls back to a truncated UA string. */
export function deviceSummary(ua?: string | null): string | null {
  if (!ua) return null;
  const browser =
    /edg(?:e|a|ios)?\//i.test(ua) ? 'Edge'
    : /opr\/|opera/i.test(ua) ? 'Opera'
    : /crios\//i.test(ua) ? 'Chrome (iOS)'
    : /chrome\//i.test(ua) ? 'Chrome'
    : /fxios\//i.test(ua) ? 'Firefox (iOS)'
    : /firefox\//i.test(ua) ? 'Firefox'
    : /safari\//i.test(ua) ? 'Safari'
    : null;
  const os =
    /iphone|ipad|ipod/i.test(ua) ? 'iOS'
    : /android/i.test(ua) ? 'Android'
    : /mac os x/i.test(ua) ? 'macOS'
    : /windows/i.test(ua) ? 'Windows'
    : /linux/i.test(ua) ? 'Linux'
    : null;
  if (browser && os) return `${browser} on ${os}`;
  if (browser || os) return browser ?? os;
  return ua.length > 60 ? `${ua.slice(0, 57)}…` : ua;
}

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 40, fontSize: 9.5, color: '#14201a', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${GREEN}`, paddingBottom: 8 },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: GREEN },
  sub: { fontSize: 9, color: '#5f6b63', marginTop: 2 },
  badge: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#1f6f54', backgroundColor: '#e6f5ee', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10 },
  metaRow: { flexDirection: 'row', marginTop: 12, gap: 22, flexWrap: 'wrap' },
  metaLabel: { fontSize: 8, color: '#8a948d', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: GREEN, marginTop: 18, marginBottom: 6, borderBottom: '1px solid #e3e0d9', paddingBottom: 3 },
  sigCard: { border: '1px solid #e3e0d9', borderRadius: 8, padding: 10, marginBottom: 8 },
  sigHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sigRole: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase', letterSpacing: 0.5 },
  kvRow: { flexDirection: 'row', paddingVertical: 1.5 },
  kvK: { width: '26%', fontSize: 8.5, color: '#5f6b63' },
  kvV: { width: '74%', fontSize: 9 },
  mono: { fontFamily: 'Courier', fontSize: 7.5 },
  thead: { flexDirection: 'row', backgroundColor: '#eef1ef', paddingVertical: 4, paddingHorizontal: 4, marginTop: 4 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#5f6b63', textTransform: 'uppercase' },
  trow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottom: '0.5px solid #f0ede7' },
  cTime: { width: '28%', color: '#5f6b63' },
  cEvent: { width: '30%' },
  cParty: { width: '14%' },
  cIp: { width: '28%' },
  muted: { fontSize: 8, color: '#8a948d', marginTop: 16, lineHeight: 1.5 },
});

function KV({ k, v, mono }: { k: string; v?: string | null; mono?: boolean }) {
  if (!v) return null;
  return (
    <View style={s.kvRow}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={[s.kvV, ...(mono ? [s.mono] : [])]}>{v}</Text>
    </View>
  );
}

export function SignatureCertificateDoc({ data, refLabel }: { data: SignatureCertificateData; refLabel?: string | null }) {
  const c = data.contract;
  const ref = refLabel ?? (c ? `CID-${c.id}` : 'Contract');
  const tenant = c?.tenantCompany || c?.tenantName || '—';
  const landlord = c?.landlordCompany || c?.landlordName || '—';
  return (
    <Document title={`Signature certificate — ${ref}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.h1}>Signature Certificate</Text>
            <Text style={s.sub}>Certificate of completion · Tenancy contract {ref}</Text>
          </View>
          <Text style={s.badge}>{data.signatures.length} signature{data.signatures.length === 1 ? '' : 's'}</Text>
        </View>

        <View style={[s.metaRow, { justifyContent: 'space-between' }]}>
          <View><Text style={s.metaLabel}>Tenant</Text><Text style={s.metaVal}>{tenant}</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={s.metaLabel}>Landlord</Text><Text style={s.metaVal}>{landlord}</Text></View>
        </View>
        <View style={[s.metaRow, { marginTop: 8, justifyContent: 'space-between' }]}>
          <View style={{ flexDirection: 'row', gap: 22 }}>
            {c?.unitNumber ? <View><Text style={s.metaLabel}>Unit</Text><Text style={s.metaVal}>{c.unitNumber}</Text></View> : null}
            {c?.propertyName ? <View><Text style={s.metaLabel}>Building</Text><Text style={s.metaVal}>{c.propertyName}</Text></View> : null}
          </View>
          {c?.startDate ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.metaLabel}>Contract period</Text>
              <Text style={s.metaVal}>{fmtD(c.startDate)} – {fmtD(c.endDate)}</Text>
            </View>
          ) : <View />}
        </View>

        <Text style={s.sectionTitle}>Signatures &amp; signing evidence</Text>
        {data.signatures.length === 0 && <Text style={{ color: '#5f6b63' }}>No signatures recorded yet.</Text>}
        {data.signatures.map(sig => {
          const meta = sig.clientMeta ?? {};
          const device = [deviceSummary(sig.userAgent), meta.platform, meta.screen ? `screen ${meta.screen}` : null]
            .filter(Boolean).join(' · ');
          return (
            <View key={sig.id} style={s.sigCard} wrap={false}>
              <View style={s.sigHead}>
                <Text style={s.sigRole}>{sig.role === 'landlord' ? 'Landlord' : sig.role === 'tenant' ? 'Tenant' : sig.role}</Text>
                <Text style={{ fontSize: 8.5, color: '#5f6b63' }}>{fmtDT(sig.signedAt)}</Text>
              </View>
              <KV k="Signatory" v={sig.signatoryName} />
              <KV k="Email" v={sig.signerEmail ?? sig.actorEmail} />
              <KV k="Executed by" v={sig.actorName ? `${sig.actorName}${sig.actorEmail ? ` (${sig.actorEmail})` : ''}` : null} />
              <KV k="Channel" v={SIGNED_VIA_LABEL[sig.signedVia ?? ''] ?? sig.signedVia ?? (sig.method === 'on_file' ? SIGNED_VIA_LABEL.on_file : 'Not recorded (legacy signature)')} />
              <KV k="Method" v={sig.method === 'on_file' ? 'On file (paper / imported)' : sig.method === 'paper' ? 'Paper (captured)' : 'Electronic signature'} />
              <KV k="IP address" v={sig.ipAddress} />
              <KV k="Location" v={[sig.geoCity, (sig.geoLat != null && sig.geoLng != null) ? `${sig.geoLat}, ${sig.geoLng}` : null].filter(Boolean).join(' · ') || null} />
              <KV k="Device" v={device || null} />
              <KV k="Timezone / locale" v={[meta.timezone, meta.locale].filter(Boolean).join(' · ') || null} />
              <KV k="Consent" v={sig.consentGiven ? 'Agreed to sign electronically' : sig.method === 'on_file' ? '— (paper signature on file)' : 'Not captured'} />
              {sig.consentGiven && sig.consentText ? <KV k="Consent text" v={sig.consentText} /> : null}
              <KV k="Terms SHA-256" v={sig.termsHash} mono />
            </View>
          );
        })}

        <Text style={s.sectionTitle}>Envelope history</Text>
        {data.events.length === 0 ? (
          <Text style={{ color: '#5f6b63' }}>No envelope events recorded (signatures may predate evidence capture).</Text>
        ) : (
          <>
            <View style={s.thead}>
              <Text style={[s.th, s.cTime]}>Time (GST)</Text>
              <Text style={[s.th, s.cEvent]}>Event</Text>
              <Text style={[s.th, s.cParty]}>Party</Text>
              <Text style={[s.th, s.cIp]}>IP address</Text>
            </View>
            {data.events.map(e => (
              <View key={e.id} style={s.trow} wrap={false}>
                <Text style={s.cTime}>{fmtDT(e.at)}</Text>
                <Text style={s.cEvent}>{EVENT_LABEL[e.event] ?? e.event}</Text>
                <Text style={s.cParty}>{e.role ? e.role[0].toUpperCase() + e.role.slice(1) : '—'}</Text>
                <Text style={s.cIp}>{e.ipAddress ?? '—'}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.muted}>
          System-generated certificate of completion. Each electronic signature above was captured together with
          the signer&apos;s network address, device context and explicit consent, and the contract terms in force at the
          moment of signing were frozen and fingerprinted with SHA-256 (shown per signature) — any later change to
          the terms is detectable by re-hashing. Electronic signatures are recognised under UAE Federal Decree-Law
          No. 46 of 2021 on Electronic Transactions and Trust Services. Times are shown in Gulf Standard Time (GST).
        </Text>
      </Page>
    </Document>
  );
}

// ─── Inline (embeddable) render for the documents binder ──────────────────────

export function SignatureCertificateInline({ data, refLabel, height = 100000, showDownload = false }: {
  data: SignatureCertificateData; refLabel?: string | null; height?: number; showDownload?: boolean;
}) {
  const key = `sig-cert|${refLabel ?? ''}|${data.signatures.length}|${data.events.length}`;
  const { bytes, url, error } = useReactPdfDoc(() => <SignatureCertificateDoc data={data} refLabel={refLabel} />, key);
  if (error) return <div style={{ padding: 24, textAlign: 'center', color: '#c00', fontSize: 13 }}>Signature certificate unavailable.</div>;
  return (
    <>
      {showDownload && <InlineDownloadRow url={url} fileName={`Signature-certificate-${refLabel ?? 'contract'}.pdf`} />}
      <EjariCanvas bytes={bytes} height={height} />
    </>
  );
}
