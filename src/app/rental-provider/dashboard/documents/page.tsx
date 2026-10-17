'use client';

/**
 * Business › Documents & licences — Genspark OS rebuild of RP → KYC documents.
 *
 * Parity with previous page (every item kept):
 *  - KycDocumentsPanel REUSED UNCHANGED (shared with SP / technician / customer pages) with the
 *    same props: profileApiPath="/profiles/rental-provider/me", ownerType="rental_provider".
 *    It keeps every endpoint and action: GET /profiles/rental-provider/me (checklist),
 *    POST /documents/upload-url → PUT presigned → POST /documents (or PATCH /documents/:id on
 *    replace), PATCH /documents/:id { expiryDate }, document scanner, secure watermarked viewer,
 *    labelled View / Upload / Replace per row, "complete your profile" banner.
 *    Rendered outside the `.gx` scope so its own styling is untouched.
 *  - Fix: the panel's profileHref pointed at a non-existent /dashboard/rental-provider/profile;
 *    it now points at /rental-provider/dashboard/profile.
 *  - New on top (read-only, same GET): KPIs (required verified / awaiting review / needs action),
 *    attention for rejected/expired/missing required documents, and an expiry watch table
 *    (document, category, expiry, status). Refetched after every upload via onAfterUpload, and with the card's Refresh button (expiry edits).
 *  - /prototype/os/rp/documents re-exports this page; no manager route uses it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KycDocumentsPanel, type KycChecklistItem } from '@/components/dashboard/KycDocumentsPanel';
import { apiGet } from '@/lib/api';
import {
  Btn, Callout, Card, EmptyRow, ErrorRow, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, SkeletonRows, TableWrap,
  fmtDate, humanize, type Tone,
} from '@/components/os/kit';

interface Resp { profile: { entityType?: string | null; companyType?: string | null }; checklist: KycChecklistItem[] }

const ST: Record<string, { l: string; tone: Tone }> = {
  processed: { l: 'Verified', tone: 'primary' }, complete: { l: 'Verified', tone: 'primary' },
  attached: { l: 'Pending review', tone: 'amber' }, pending: { l: 'Requested', tone: 'amber' },
  rejected: { l: 'Rejected', tone: 'danger' }, expired: { l: 'Expired', tone: 'danger' },
};
const statusOf = (c: KycChecklistItem) => (c.uploaded ? ST[c.status ?? ''] ?? { l: 'Uploaded', tone: 'info' as Tone } : { l: c.required ? 'Missing' : 'Optional — not uploaded', tone: (c.required ? 'danger' : 'neutral') as Tone });
const DAY = 86_400_000;

export default function RentalProviderDocumentsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(() => {
    setErr(false);
    apiGet<Resp>('/profiles/rental-provider/me').then(setData).catch(() => setErr(true));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => data?.checklist ?? [], [data]);
  const required = list.filter((c) => c.required);
  const verified = required.filter((c) => c.uploaded && (c.status === 'processed' || c.status === 'complete')).length;
  const review = list.filter((c) => c.uploaded && (c.status === 'attached' || c.status === 'pending')).length;
  const bad = list.filter((c) => c.status === 'rejected' || c.status === 'expired');
  const missing = required.filter((c) => !c.uploaded);
  const withExpiry = list.filter((c) => c.expiryDate).sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
  const soon = withExpiry.filter((c) => { const t = new Date(c.expiryDate!).getTime(); return t - now < 60 * DAY; }).length;

  const toPanel = () => document.getElementById('rp-kyc-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const entity = data?.profile.entityType === 'company'
    ? `Company${data.profile.companyType ? ` · ${humanize(data.profile.companyType)}` : ''}`
    : data ? 'Individual' : '—';

  return (
    <>
      <OsPage className="!pb-4">
        <PageHead
          eyebrow="Business"
          title="Documents & licences"
          lede="The documents UpNow Admin reviews to verify your business. Upload, replace and keep expiry dates current here."
          actions={<>
            <Btn size="sm" href="/rental-provider/dashboard/profile">Profile & verification</Btn>
            <Btn size="sm" variant="primary" onClick={toPanel}>Upload documents</Btn>
          </>}
        />
        <ScopeStrip items={[
          { label: 'Workspace', value: 'Business' },
          { label: 'Entity type', value: entity },
          { label: 'Required', value: required.length ? `${verified} of ${required.length} verified` : '—' },
        ]} />
        <div style={{ marginBottom: 14 }}>
          <Callout tone="info" title="Requirements switch by entity type and vertical.">
            An individual, a landlord company, a brokerage and an agents company each need a different set — a brokerage adds its
            property-management licence, an agents company its agent registration and parent-firm agreement. Changing your entity type on
            the profile changes this list. Licences for other verticals are requested on Vertical authorisations.
          </Callout>
        </div>
        {(bad.length > 0 || missing.length > 0) && (
          <div style={{ marginBottom: 14 }}>
            <Callout tone={bad.length ? 'bad' : 'warn'} title={bad.length ? 'Needs re-upload:' : 'Still missing:'}>
              {[...bad, ...missing].map((c) => c.displayName).join(', ')}.{' '}
              <Btn size="xs" onClick={toPanel}>Go to upload</Btn>
            </Callout>
          </div>
        )}
        <Kpis>
          <Kpi k="Required verified" v={data ? `${verified}/${required.length}` : '—'} d="processed by Admin or self-verified" dark />
          <Kpi k="Awaiting review" v={data ? review : '—'} d="uploaded, not yet verified" />
          <Kpi k="Needs action" v={data ? bad.length + missing.length : '—'} d="rejected, expired or missing" />
          <Kpi k="Expiring ≤ 60 days" v={data ? soon : '—'} d="renew before they lapse" />
        </Kpis>

        <Card title="Expiry watch" sub="Identity and licence documents with an expiry date on file" right={<Btn size="xs" onClick={load}>Refresh</Btn>}>
          <TableWrap>
            <table className="gx-tbl">
              <thead><tr><th>Document</th><th>Category</th><th>Required</th><th>Expiry</th><th>Status</th><th className="act">Action</th></tr></thead>
              {err ? <ErrorRow cols={6} onRetry={load} />
                : !data ? <SkeletonRows rows={3} cols={6} />
                : withExpiry.length === 0 ? <EmptyRow cols={6} title="No expiry dates on file" text="Add the expiry date on each identity or licence document below." />
                : (
                  <tbody>
                    {withExpiry.map((c) => {
                      const s = statusOf(c);
                      const days = Math.ceil((new Date(c.expiryDate!).getTime() - now) / DAY);
                      return (
                        <tr key={c.key}>
                          <td className="strong">{c.displayName}</td>
                          <td>{humanize(c.category)}</td>
                          <td>{c.required ? 'Required' : 'Optional'}</td>
                          <td className="nowrap">{fmtDate(c.expiryDate)}<div className="sub">{days < 0 ? `${-days} days ago` : `in ${days} days`}</div></td>
                          <td>{days < 0 ? <Pill tone="danger">Expired</Pill> : days < 60 ? <Pill tone="amber">Expiring soon</Pill> : <Pill tone={s.tone}>{s.l}</Pill>}</td>
                          <td className="act"><Btn size="sm" onClick={toPanel}>{days < 60 ? 'Replace' : 'Manage'}</Btn></td>
                        </tr>
                      );
                    })}
                  </tbody>
                )}
            </table>
          </TableWrap>
        </Card>
      </OsPage>

      {/* Shared uploader, reused unchanged (outside .gx so its own styles apply). */}
      <section id="rp-kyc-panel" className="px-[22px] pb-16" style={{ maxWidth: 1420, scrollMarginTop: 16 }}>
        <div className="bg-white rounded-xl border border-[#e4e9e5] shadow-sm p-5">
          <h2 className="text-[15px] font-bold text-[#14201a]">All documents</h2>
          <p className="text-xs text-[#5f6b63] mb-4">Category, status and expiry per document — View opens the secure viewer; Upload / Replace sends a new file for review.</p>
          <KycDocumentsPanel
            profileApiPath="/profiles/rental-provider/me"
            ownerType="rental_provider"
            profileHref="/rental-provider/dashboard/profile"
            onAfterUpload={() => load()}
          />
        </div>
      </section>
    </>
  );
}
