'use client';
/* eslint-disable react-hooks/set-state-in-effect -- one fetch on mount / on retry */

/**
 * Admin › Overview — "Expiring within 30 days" (blueprint: expiry dashboards across providers).
 *
 * There is no expiring-documents endpoint, so this reads what the existing admin KYC endpoints expose:
 *   - GET /admin/kyc/service-providers?limit=200&offset=0   → profile.tradeLicenseExpiry (list level, no extra calls)
 *   - GET /admin/kyc/rental-providers?limit=25&offset=0     → then GET /admin/kyc/rental-providers/:id per row
 *   - first 25 service providers                            → GET /admin/kyc/service-providers/:id per row
 *     (detail payloads: uploadedDocs[].expiryDate + checklist[].expiryDate)
 * The rental-provider LIST has no expiry field, so document expiry needs one detail request per provider —
 * capped at the first 25 providers of each type (6 at a time), and the card says so. Technicians and
 * customers are not included. Read-only: rows link to the provider's KYC record.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Btn, Callout, Card, Pill, fmtDate } from '@/components/os/kit';

const CAP = 25;
const WINDOW_DAYS = 30;

interface ProviderListRow {
  id: number; userId: number; createdAt: string; tradeLicenseExpiry?: string | null;
  businessName?: string | null; companyName?: string | null; ownerName?: string | null;
  user?: { id: number; name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}
interface DetailDoc { id: number; documentKey: string; displayName?: string | null; expiryDate: string | null; status?: string | null }
interface DetailChk { key: string; displayName: string; documentId: number | null; expiryDate?: string | null }
interface ProviderDetail { uploadedDocs?: DetailDoc[]; checklist?: DetailChk[] }

interface ExpiryRow {
  key: string; kind: 'rp' | 'sp'; providerId: number; userId: number; provider: string; doc: string; expiry: string; days: number;
}

const nameOf = (p: ProviderListRow, fallback: string) =>
  p.businessName || p.companyName || p.ownerName || p.user?.name || [p.user?.firstName, p.user?.lastName].filter(Boolean).join(' ') || p.user?.email || fallback;
const label = (k: string) => k.replace(/^poa_/, 'POA ').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function daysTo(iso: string, now: number): number | null {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - now) / 86_400_000);
}

/** Run `fn` over `items`, `limit` at a time; failures are counted, not thrown. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<{ ok: { item: T; value: R }[]; failed: number }> {
  const ok: { item: T; value: R }[] = [];
  let failed = 0;
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      try { ok.push({ item, value: await fn(item) }); } catch { failed += 1; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { ok, failed };
}

interface Result {
  rows: ExpiryRow[]; rpChecked: number; rpTotal: number; spChecked: number; spTotal: number; failed: number;
}

export function ExpiryCard() {
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setUnreachable(false);
    const now = Date.now();
    const [rpList, spList] = await Promise.allSettled([
      apiGet<{ data?: ProviderListRow[]; total?: number }>(`/admin/kyc/rental-providers?limit=${CAP}&offset=0`),
      apiGet<{ data?: ProviderListRow[]; total?: number }>('/admin/kyc/service-providers?limit=200&offset=0'),
    ]);
    if (rpList.status === 'rejected' && spList.status === 'rejected') { setUnreachable(true); setLoading(false); return; }
    const rps = rpList.status === 'fulfilled' ? rpList.value.data ?? [] : [];
    const sps = spList.status === 'fulfilled' ? spList.value.data ?? [] : [];
    const rpTotal = rpList.status === 'fulfilled' ? rpList.value.total ?? rps.length : 0;
    const spTotal = spList.status === 'fulfilled' ? spList.value.total ?? sps.length : 0;

    const rows = new Map<string, ExpiryRow>();
    const add = (kind: 'rp' | 'sp', p: ProviderListRow, docKey: string, docName: string, expiry: string | null | undefined) => {
      if (!expiry) return;
      const days = daysTo(expiry, now);
      if (days == null || days > WINDOW_DAYS) return;
      const key = `${kind}-${p.id}-${docKey}`;
      if (rows.has(key)) return;
      rows.set(key, { key, kind, providerId: p.id, userId: p.userId, provider: nameOf(p, `${kind.toUpperCase()} #${p.id}`), doc: docName, expiry, days });
    };

    const rpTargets = rps.slice(0, CAP);
    const spTargets = sps.slice(0, CAP);
    const [rpDet, spDet] = await Promise.all([
      pool(rpTargets, 6, (p) => apiGet<ProviderDetail>(`/admin/kyc/rental-providers/${p.id}`)),
      pool(spTargets, 6, (p) => apiGet<ProviderDetail>(`/admin/kyc/service-providers/${p.id}`)),
    ]);
    const fromDetail = (kind: 'rp' | 'sp', p: ProviderListRow, d: ProviderDetail) => {
      for (const doc of d.uploadedDocs ?? []) add(kind, p, doc.documentKey, doc.displayName || label(doc.documentKey), doc.expiryDate);
      for (const c of d.checklist ?? []) add(kind, p, c.key, c.displayName, c.expiryDate);
    };
    rpDet.ok.forEach(({ item, value }) => fromDetail('rp', item, value));
    spDet.ok.forEach(({ item, value }) => fromDetail('sp', item, value));
    // List-level licence expiry for every loaded SP (skipped when the licence document already gave a row).
    for (const p of sps) {
      if (!rows.has(`sp-${p.id}-trade_license`)) add('sp', p, 'trade_license', 'Trade licence (profile)', p.tradeLicenseExpiry);
    }

    setRes({
      rows: [...rows.values()].sort((a, b) => a.days - b.days),
      rpChecked: rpDet.ok.length, rpTotal, spChecked: spDet.ok.length, spTotal,
      failed: rpDet.failed + spDet.failed,
    });
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // No expiry data reachable at all → show nothing (reported as a backend gap).
  if (unreachable) return null;

  const coverage = res
    ? `Checked: document expiry for ${res.rpChecked} of ${res.rpTotal} rental provider${res.rpTotal === 1 ? '' : 's'} and ${res.spChecked} of ${res.spTotal} service provider${res.spTotal === 1 ? '' : 's'} (first ${CAP} of each — one request per provider, no bulk expiry endpoint yet), plus the trade-licence expiry on every service-provider profile. Technicians and customers are not included.`
    : '';
  const expired = res?.rows.filter((r) => r.days < 0).length ?? 0;

  return (
    <div style={{ marginTop: 14 }}>
      <Card title="Expiring within 30 days" sub="Provider licences and verification documents due in the next 30 days or already expired"
        right={<Btn size="xs" onClick={() => void load()} disabled={loading}>{loading ? 'Checking…' : 'Refresh'}</Btn>}>
        <div className="gx-pad">
          {loading && !res ? (
            <div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="gx-skel" style={{ height: 16 }} />)}
            </div>
          ) : res && res.rows.length === 0 ? (
            <div className="gx-empty"><b>Nothing expiring</b>No provider document or licence with an expiry date falls in the next 30 days, and none has lapsed. Expiry dates are entered when a reviewer approves a document.</div>
          ) : res ? (
            <>
              {expired > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <Callout tone="bad" title={`${expired} already expired.`}>Open the provider and use Mark expired with reason code G1-DOC-EXPIRED or G1-LIC-EXPIRED until a renewed copy is verified.</Callout>
                </div>
              )}
              <table className="gx-tbl">
                <thead><tr><th>Provider</th><th>Document</th><th>Expiry</th><th>Status</th><th className="act">Actions</th></tr></thead>
                <tbody>
                  {res.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="strong">{r.provider}<span className="sub">{r.kind === 'rp' ? 'Rental provider' : 'Service provider'}</span></td>
                      <td>{r.doc}</td>
                      <td className="nowrap">{fmtDate(r.expiry)}</td>
                      <td>{r.days < 0
                        ? <Pill tone="danger">Expired {Math.abs(r.days)}d ago</Pill>
                        : <Pill tone={r.days <= 7 ? 'danger' : 'amber'}>{r.days === 0 ? 'Expires today' : `Expires in ${r.days}d`}</Pill>}</td>
                      <td className="act">
                        <Btn size="xs" href={r.kind === 'rp' ? `/dashboard/admin/kyc/rental-provider/${r.providerId}` : `/dashboard/admin/users/${r.userId}`}>
                          {r.kind === 'rp' ? 'Open KYC record' : 'Open provider'}
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {res && (
            <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--ms-ink-3)' }}>
              {coverage}{res.failed > 0 ? ` ${res.failed} provider record${res.failed === 1 ? '' : 's'} failed to load.` : ''}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
