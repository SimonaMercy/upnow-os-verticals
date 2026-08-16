/**
 * SP-252 — the platform agreement as a user sees it: the current version for
 * their account type, a way to read it (inline text and/or the PDF), and the
 * acceptance checkbox that writes an append-only evidence row. One component
 * for every surface that asks: onboarding (last step), the re-prompt when a
 * newer version is published, and Settings (read again / see when accepted).
 */
'use client';

import { useState } from 'react';
import { Check, ExternalLink, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

/* ── Types (mirror AgreementsService on the backend) ─────────────────────── */
export type AgreementAudience = 'provider' | 'customer' | 'landlord';
export type AcceptanceContext = 'onboarding' | 'reprompt' | 'settings';

export interface AgreementView {
  id: number;
  audience: AgreementAudience;
  version: string;
  title: string;
  summary: string | null;
  bodyMd: string | null;
  fileName: string | null;
  fileViewUrl: string | null;
  documentSha256: string | null;
  status: string;
  effectiveFrom: string | null;
  publishedAt: string | null;
}
export interface AcceptanceView {
  id: number;
  agreementId: number;
  agreementVersion: string;
  documentSha256: string | null;
  acceptedAt: string;
  context: string;
  ipAddress: string | null;
  userAgent: string | null;
}
export interface AgreementStatus {
  audience: AgreementAudience;
  agreement: AgreementView | null;
  acceptance: AcceptanceView | null;
  requiresAcceptance: boolean;
  history: AcceptanceView[];
}

export const fetchAgreementStatus = () => apiGet<AgreementStatus>('/agreements/current');
export const acceptAgreement = (agreementId: number, context: AcceptanceContext) =>
  apiPost<AcceptanceView>(`/agreements/${agreementId}/accept`, { context });

/* ── Minimal, safe markdown renderer (headings, paragraphs, lists, quotes, bold) ── */
function inline(text: string, key: number) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span key={key}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
      )}
    </span>
  );
}

export function AgreementText({ md }: { md: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push(<p key={blocks.length} style={{ margin: '0 0 10px', lineHeight: 1.6 }}>{inline(para.join(' '), 0)}</p>); para = []; }
    if (list.length) { blocks.push(<ul key={blocks.length} style={{ margin: '0 0 10px 18px', lineHeight: 1.6 }}>{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>); list = []; }
    if (quote.length) { blocks.push(<blockquote key={blocks.length} style={{ margin: '0 0 12px', padding: '8px 12px', borderLeft: '3px solid #F5D9A6', background: '#FFFBEB', color: '#92400E', fontSize: 12.5, lineHeight: 1.55 }}>{inline(quote.join(' '), 0)}</blockquote>); quote = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,3}\s/.test(line)) {
      flush();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, '');
      blocks.push(
        <h4 key={blocks.length} style={{ fontSize: level === 1 ? 15 : 13.5, fontWeight: 700, margin: '14px 0 6px', color: '#182420' }}>{text}</h4>,
      );
      continue;
    }
    if (line.startsWith('> ')) { if (para.length || list.length) flush(); quote.push(line.slice(2)); continue; }
    if (/^[-*]\s/.test(line)) { if (para.length || quote.length) flush(); list.push(line.replace(/^[-*]\s/, '')); continue; }
    if (list.length || quote.length) flush();
    para.push(line.trim());
  }
  flush();
  return <div style={{ fontSize: 13, color: '#2B3A33' }}>{blocks}</div>;
}

/* ── Panel ───────────────────────────────────────────────────────────────── */
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }) : '—';

export function PlatformAgreementPanel({
  status,
  context,
  onAccepted,
  defaultOpen = false,
  compact = false,
}: {
  status: AgreementStatus;
  context: AcceptanceContext;
  onAccepted?: (acceptance: AcceptanceView, next: AgreementStatus) => void;
  /** Open the full text by default (onboarding / re-prompt). */
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = status.agreement;
  if (!a) return null;
  const accepted = status.acceptance;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const acc = await acceptAgreement(a.id, context);
      const next: AgreementStatus = { ...status, acceptance: acc, requiresAcceptance: false, history: [acc, ...status.history] };
      onAccepted?.(acc, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your acceptance — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: '1px solid #E4E7E2', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      <div className="flex items-start gap-3" style={{ padding: compact ? '12px 14px' : '16px 18px' }}>
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: accepted ? '#E9F4EE' : '#EEF2FF' }}>
          {accepted ? <ShieldCheck size={18} style={{ color: '#0B7A4E' }} /> : <FileText size={18} style={{ color: '#4338CA' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 style={{ fontSize: 14.5, fontWeight: 700, color: '#182420' }}>{a.title}</h3>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#F5F7F4', color: '#55645B' }}>v{a.version}</span>
            {a.effectiveFrom && <span style={{ fontSize: 11, color: '#8A968D' }}>effective {new Date(a.effectiveFrom).toLocaleDateString('en-AE', { dateStyle: 'medium', timeZone: 'Asia/Dubai' })}</span>}
          </div>
          {a.summary && <p style={{ fontSize: 12.5, color: '#55645B', marginTop: 4, lineHeight: 1.5 }}>{a.summary}</p>}
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 8 }}>
            {a.bodyMd && (
              <button type="button" onClick={() => setOpen((o) => !o)} style={{ fontSize: 12.5, fontWeight: 600, color: '#4338CA', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                {open ? 'Hide the agreement' : 'Read the agreement'}
              </button>
            )}
            {a.fileViewUrl && (
              <a href={a.fileViewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 600, color: '#4338CA' }}>
                <ExternalLink size={12} /> Open PDF{a.fileName ? ` (${a.fileName})` : ''}
              </a>
            )}
          </div>
        </div>
      </div>

      {open && a.bodyMd && (
        <div style={{ borderTop: '1px solid #EEF1EE', padding: compact ? '12px 14px' : '14px 18px', maxHeight: 420, overflowY: 'auto', background: '#FBFCFA' }}>
          <AgreementText md={a.bodyMd} />
        </div>
      )}

      <div style={{ borderTop: '1px solid #EEF1EE', padding: compact ? '10px 14px' : '12px 18px', background: accepted ? '#F4FAF6' : '#fff' }}>
        {accepted ? (
          <div className="flex items-start gap-2" style={{ fontSize: 12.5, color: '#0B7A4E' }}>
            <Check size={15} className="mt-[1px]" />
            <div>
              <span style={{ fontWeight: 700 }}>Accepted</span> on {fmtDate(accepted.acceptedAt)} (v{accepted.agreementVersion})
              {accepted.ipAddress && <span style={{ color: '#55645B' }}> · from {accepted.ipAddress}</span>}
              <span style={{ display: 'block', fontSize: 11.5, color: '#55645B', marginTop: 2 }}>
                Kept on record — this acceptance can never be edited or removed.
              </span>
            </div>
          </div>
        ) : (
          <>
            <label className="flex items-start gap-2.5 cursor-pointer" style={{ fontSize: 13, color: '#182420' }}>
              <input type="checkbox" checked={ticked} disabled={busy} onChange={(e) => setTicked(e.target.checked)} style={{ marginTop: 3, accentColor: '#0B7A4E' }} />
              <span>
                I have read and agree to the <b>{a.title}</b> (v{a.version}) on behalf of my business.
              </span>
            </label>
            {error && <p style={{ fontSize: 12, color: '#B42318', marginTop: 6 }}>{error}</p>}
            <button
              type="button"
              disabled={!ticked || busy}
              onClick={() => void accept()}
              className="flex items-center gap-2"
              style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: '#fff', background: ticked && !busy ? '#0B7A4E' : '#B7C0BA', border: 'none', borderRadius: 10, padding: '8px 14px', cursor: ticked && !busy ? 'pointer' : 'not-allowed' }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {busy ? 'Recording…' : 'Accept the agreement'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
