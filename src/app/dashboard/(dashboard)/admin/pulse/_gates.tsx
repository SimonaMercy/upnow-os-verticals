'use client';
/* eslint-disable react-hooks/set-state-in-effect -- one fetch on mount / on retry */

/**
 * Admin › Overview — the Genspark head of Platform Pulse: the three gates the admin runs.
 *   Gate 1 · Verification   — REAL: GET /admin/kyc/rental-providers|service-providers?limit=200, /admin/kyc/technicians?limit=200
 *                              (pending_review + action_required counted from the rows; "≥" when the list is capped)
 *   Gate 2 · Authorisation  — PREVIEW: usePreview().requests / .audit (no backend yet) — marked with PreviewPill + banner
 *   Gate 3 · Listing review — REAL: GET /admin/unit-listings?status=pending&limit=1 (total units),
 *                              GET /admin/service-listing-providers?status=pending&limit=1 (total providers with pending listings)
 *   Expiring within 30 days — REAL (see _expiry.tsx): SP list tradeLicenseExpiry + RP / SP detail document expiry,
 *                              detail calls capped at the first 25 providers of each type (stated on the card)
 * Everything Platform Pulse showed before stays below this block, unchanged.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import {
  Attn, AttnCard, Btn, Callout, Card, Cols, Kpi, Kpis, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, Timeline,
} from '@/components/os/kit';
import { verticalOf } from '@/lib/catalog';
import { usePreview } from '@/lib/os/preview';
import { ExpiryCard } from './_expiry';

type Row = { complianceStatus?: string | null };
type Count = { n: number; capped: boolean };
interface GateCounts {
  rp: Count | null; sp: Count | null; tech: Count | null; rpAction: number; spAction: number; techAction: number;
  units: number | null; spProviders: number | null;
}

const isWaiting = (r: Row) => r.complianceStatus === 'pending_review' || r.complianceStatus === 'action_required';
const isAction = (r: Row) => r.complianceStatus === 'action_required';

async function kycCount(path: string): Promise<{ c: Count; action: number }> {
  const res = await apiGet<{ data?: Row[]; total?: number } | Row[]>(path);
  const rows = Array.isArray(res) ? res : res.data ?? [];
  const total = Array.isArray(res) ? rows.length : res.total ?? rows.length;
  return { c: { n: rows.filter(isWaiting).length, capped: rows.length < total }, action: rows.filter(isAction).length };
}
async function totalOf(path: string): Promise<number> {
  const res = await apiGet<{ total?: number; data?: unknown[] }>(path);
  return res.total ?? res.data?.length ?? 0;
}

const fmtCount = (c: Count | null) => (c == null ? '—' : `${c.capped ? '≥' : ''}${c.n}`);

export function AdminGates({ actions }: { actions?: ReactNode }) {
  const { requests, audit } = usePreview();
  const [g, setG] = useState<GateCounts | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [rp, sp, tech, units, spProv] = await Promise.allSettled([
      kycCount('/admin/kyc/rental-providers?limit=200&offset=0'),
      kycCount('/admin/kyc/service-providers?limit=200&offset=0'),
      kycCount('/admin/kyc/technicians?limit=200'),
      totalOf('/admin/unit-listings?limit=1&offset=0&status=pending'),
      totalOf('/admin/service-listing-providers?limit=1&offset=0&status=pending'),
    ]);
    const val = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
    setFailed([
      rp.status === 'rejected' && 'rental-provider KYC', sp.status === 'rejected' && 'service-provider KYC',
      tech.status === 'rejected' && 'technician KYC', units.status === 'rejected' && 'unit listings',
      spProv.status === 'rejected' && 'service listings',
    ].filter(Boolean) as string[]);
    setG({
      rp: val(rp)?.c ?? null, sp: val(sp)?.c ?? null, tech: val(tech)?.c ?? null,
      rpAction: val(rp)?.action ?? 0, spAction: val(sp)?.action ?? 0, techAction: val(tech)?.action ?? 0,
      units: val(units), spProviders: val(spProv),
    });
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const gate1 = g && (g.rp || g.sp || g.tech) ? (g.rp?.n ?? 0) + (g.sp?.n ?? 0) + (g.tech?.n ?? 0) : null;
  const gate1Capped = !!(g?.rp?.capped || g?.sp?.capped || g?.tech?.capped);
  const gate1Action = g ? g.rpAction + g.spAction + g.techAction : 0;
  const gate2 = requests.filter((r) => r.state === 'waiting').length;
  const gate3 = g && (g.units != null || g.spProviders != null) ? (g.units ?? 0) + (g.spProviders ?? 0) : null;
  const L = (v: ReactNode) => (loading && !g ? '…' : v);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });

  return (
    <>
      <PageHead
        eyebrow="Admin › Overview"
        title="Platform overview"
        lede="Admin verifies, authorises and reviews; it never creates listings for providers. Work the three gates first, then read the portfolio below."
        actions={actions}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Admin' },
        { label: 'Today', value: today },
        { label: 'Gates', value: 'Verification · Authorisation · Listing review' },
        { label: 'Data', value: <span className="inline-flex items-center gap-1.5">Live <span style={{ color: 'var(--ms-ink-3)' }}>· Gate 2</span> <PreviewPill /></span> },
      ]} />

      {failed.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="warn" title="Some queue counts didn't load:">{failed.join(', ')}. <Btn size="xs" onClick={() => void load()}>Try again</Btn></Callout>
        </div>
      )}

      {(gate1Action > 0 || gate2 > 0 || (gate3 ?? 0) > 0) && (
        <Attn>
          {gate1Action > 0 && <AttnCard tone="bad" n={gate1Action} t="Verification — action required" s="Providers / technicians asked to fix their KYC" href="/dashboard/admin/kyc?status=action_required" />}
          {gate1 != null && gate1 - gate1Action > 0 && <AttnCard tone="warn" n={gate1 - gate1Action} t="Verification — pending review" s="Waiting for your document verdicts" href="/dashboard/admin/kyc?status=pending_review" />}
          {gate2 > 0 && <AttnCard tone="warn" n={gate2} t="Authorisation requests waiting" s="Preview data — no backend yet" href="/dashboard/admin/authorisation" />}
          {(g?.units ?? 0) > 0 && <AttnCard tone="warn" n={g!.units!} t="Unit listings pending" s="Spaces · Gate 3" href="/dashboard/admin/listings/rental-providers" />}
          {(g?.spProviders ?? 0) > 0 && <AttnCard tone="warn" n={g!.spProviders!} t="Providers with pending services" s="Services · Gate 3" href="/dashboard/admin/listings/service-providers" />}
        </Attn>
      )}

      <Kpis>
        <Kpi dark k="Verification queue · Gate 1" href="/dashboard/admin/kyc"
          v={L(gate1 == null ? '—' : `${gate1Capped ? '≥' : ''}${gate1}`)}
          d={g ? `RP ${fmtCount(g.rp)} · SP ${fmtCount(g.sp)} · Technicians ${fmtCount(g.tech)}` : 'Pending review + action required'} />
        <Kpi k="Authorisation queue · Gate 2" href="/dashboard/admin/authorisation"
          v={gate2}
          d={<span className="inline-flex items-center gap-1.5">{requests.length} request{requests.length === 1 ? '' : 's'} in total <PreviewPill /></span>} />
        <Kpi k="Listing queue · Gate 3" href="/dashboard/admin/listings/rental-providers"
          v={L(gate3 == null ? '—' : gate3)}
          d={g ? `${g.units ?? '—'} unit listings · ${g.spProviders ?? '—'} service providers` : 'Pending listings'} />
        <Kpi k="Action required · Gate 1" href="/dashboard/admin/kyc?status=action_required"
          v={L(g ? gate1Action : '—')} d="Asked to fix documents or details" />
      </Kpis>

      <Cols kind="2">
        <Card title="The three gates" sub="Every business passes them in order — verified is not authorised, and authorised is not listed">
          <div className="gx-pad">
            <Timeline items={[
              {
                mark: '1', state: gate1 ? 'now' : 'done',
                t: <span className="flex items-center gap-2 flex-wrap">Verification — who the business is <Pill tone={gate1 ? 'amber' : 'primary'}>{L(gate1 == null ? '—' : `${gate1} waiting`)}</Pill></span>,
                s: <><div>KYC documents verified or rejected one by one, then a compliance decision per provider, customer or technician.</div><div style={{ marginTop: 6 }}><Btn size="sm" href="/dashboard/admin/kyc">Open queue</Btn></div></>,
              },
              {
                mark: '2', state: gate2 ? 'now' : 'done',
                t: <span className="flex items-center gap-2 flex-wrap">Authorisation — what it may operate <Pill tone={gate2 ? 'amber' : 'primary'}>{gate2} waiting</Pill><PreviewPill /></span>,
                s: <><div>Per-vertical licence check. Approving unlocks one vertical only.</div><div style={{ marginTop: 6 }}><Btn size="sm" href="/dashboard/admin/authorisation">Open queue</Btn></div></>,
              },
              {
                mark: '3', state: gate3 ? 'now' : 'done',
                t: <span className="flex items-center gap-2 flex-wrap">Listing review — what goes live <Pill tone={gate3 ? 'amber' : 'primary'}>{L(gate3 == null ? '—' : `${gate3} waiting`)}</Pill></span>,
                s: <><div>Photos, details, price against the rental index, permit, no off-platform contact. Approve, ask for changes or reject.</div><div className="gx-btn-row" style={{ marginTop: 6 }}><Btn size="sm" href="/dashboard/admin/listings/rental-providers">Open queue</Btn><Btn size="sm" variant="ghost" href="/dashboard/admin/listings/service-providers">Services listings</Btn></div></>,
              },
            ]} />
          </div>
        </Card>
        <Card title="Latest decisions" sub="Gate 2 decisions recorded in this tab" right={<PreviewPill />}>
          <div className="gx-pad">
            <PreviewBanner>Vertical authorisation has no backend yet — these decisions are demonstration data held in this browser tab. Gate 1 and Gate 3 decisions are saved on each provider&apos;s record.</PreviewBanner>
            {audit.length === 0
              ? <div className="gx-empty"><b>No decisions yet</b>Decide a request in the authorisation queue and it appears here.</div>
              : (
                <table className="gx-tbl">
                  <thead><tr><th>When</th><th>Gate</th><th>Business</th><th>Decision</th></tr></thead>
                  <tbody>
                    {audit.slice(0, 6).map((a, i) => (
                      <tr key={`${a.when}-${i}`}>
                        <td className="nowrap">{a.when}</td>
                        <td><Pill tone="outline" dot={false}>Gate {a.gate}</Pill></td>
                        <td className="strong">{a.subject}<span className="sub">{a.actor}</span></td>
                        <td>{a.decision}<span className="sub">{a.ev}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            {requests.some((r) => r.state === 'waiting') && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ms-ink-3)' }}>
                Waiting: {requests.filter((r) => r.state === 'waiting').slice(0, 3).map((r) => `${r.business} (${verticalOf(r.vertical)?.label ?? r.vertical})`).join(' · ')}
              </div>
            )}
          </div>
        </Card>
      </Cols>

      <ExpiryCard />
    </>
  );
}
