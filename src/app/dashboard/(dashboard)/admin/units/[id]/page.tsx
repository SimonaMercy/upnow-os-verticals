/**
 * Admin unit detail (read-only) — SCRUM-588 click-through target.
 * Full parity with the RP unit view: photos, specs, leasing configuration +
 * pricing, plan agreement/addendum, unit documents, and the current tenancy's
 * contract addendums. Documents/addendums open inline (view-only) per policy.
 *
 * Parity with previous page (Genspark kit rebuild):
 *  - API: GET /admin/units/:id. Error → "Unit not found — <message>" with Back; loading state.
 *  - Header: unit no., building link → /dashboard/admin/properties/:propertyId, location + plan
 *    label, availability pill. Back button (router.back()).
 *  - Specs: type, tier, bedrooms (residential types only), bathrooms, parking, furnishing, size
 *    (sqm → sqft fallback), floor, view, premise no., rent/yr, listing, owner (RP) link →
 *    /dashboard/admin/users/:userId.
 *  - Photos: images open in a new tab; non-images (floor plans) → openDocViewer.
 *  - Leasing configuration via leaseTermsFromUnit(): lease terms, pricing & fees (Contract
 *    Registration Fee = ejariFeeFils which is WHOLE AED — not fils), amenities, special conditions.
 *  - Plan agreement & addendum (version, file → openDocViewer, special conditions).
 *  - Unit documents → openDocViewer. Last move-out condition (priced vs "Not priced", flagged items
 *    with "showing n of m"). Price history table (lease / reprice events).
 *  - Current tenancy: customer link → /dashboard/admin/users/:tenantUserId (plain text when none),
 *    ref + period, annual rent, contract addendums (signed / partially / unsigned) → openDocViewer;
 *    "No active tenancy" empty state.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';
import { leaseTermsFromUnit } from '@/lib/unitForm';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import {
  Btn, Callout, Card, KV, OsPage, PageHead, Pill, ScopeStrip, StatusTag, fmtAed, fmtDate, humanize,
} from '@/components/os/kit';

interface UnitFull {
  id: number; unitNumber: string | null; unitName: string | null; unitType: string | null;
  availability: string | null; rentalPrice: number | null; bedrooms: number | null; bathrooms: number | null;
  floor: string | null; listingStatus: string | null; unitSizeSqm: number | null; unitSizeSqft: number | null;
  propertyId: number; planLabel: string | null; unitTier: string | null; premiseNumber: string | null;
  parkingSpaces: number | null; furnishing: string | null; view: string | null; facilities: string | null;
  serviceCharges: number | null; securityDeposit: number | null; adminFee: number | null; ejariFeeFils: number | null; commission: number | null;
  property?: { id: number; buildingName: string | null; fullAddress: string | null; emirate?: { nameEn?: string | null } | null; community?: { nameEn?: string | null } | null } | null;
}
interface Media { id: number; url: string; caption: string | null; mediaType: string | null }
interface PlanAddendum { id: number; versionNo: number; planLabel: string; specialConditions: string | null; addendumFileUrl: string | null; addendumFileName: string | null; addendumMimeType: string | null; leaseTerms: Record<string, unknown> | null }
interface Doc { id: number; documentKey: string; displayName: string | null; fileUrl: string; mimeType: string | null; status: string }
interface Addendum { id: number; name: string; fileUrl: string; mimeType: string | null; tenantSigned: boolean; landlordSigned: boolean }
/** One rent/repricing event on the unit's price timeline. */
interface PriceEvent {
  kind: 'lease' | 'reprice';
  date: string | null;
  effectiveTo?: string | null;
  contractId?: number | null;
  contractType?: string | null;
  annualRent?: number | null;
  listedPrice?: number | null;
  discountAmount?: number | null;
  field?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  source?: string | null;
  reason?: string | null;
}
interface PriceHistory {
  currentRentalPrice: number | null;
  leaseCount: number;
  repriceCount: number;
  timeline: PriceEvent[];
}

/** Summary of the unit's most recent move-out inspection. */
interface LastMoveOut {
  contractId: number;
  recordedAt: string | null;
  categories: number;
  /** false = legacy inspection with no price book — costs are absent, not zero. */
  priced: boolean;
  itemsTotal: number;
  itemsChargeable: number;
  totalCostAed: number;
  flagged: { category: string; component: string; outCondition: string; costAed: number }[];
  flaggedTotal: number;
}

interface UnitDetail {
  unit: UnitFull;
  media: Media[];
  priceHistory?: PriceHistory | null;
  lastMoveOut?: LastMoveOut | null;
  owner: { rentalProviderId: number; userId: number | null; name: string | null } | null;
  currentTenancy: { id: number; ref: string; tenantName: string | null; tenantUserId: number | null; startDate: string | null; endDate: string | null; annualRent: number | null; status: string } | null;
  planAddendum: PlanAddendum | null;
  documents: Doc[];
  contractAddendums: Addendum[];
}

const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
/** Unit money is WHOLE AED. */
const aed = (v: number | null | undefined) => (v == null ? '—' : fmtAed(v));
const isImg = (u: string) => /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u);
const subLabel: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ms-ink-3)', marginBottom: 6 };
const divider: React.CSSProperties = { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--ms-surface-3)' };

export default function AdminUnitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<UnitDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiGet<UnitDetail>(`/admin/units/${params.id}`).then(setD).catch((e) => setErr(e?.message || 'Failed to load'));
  }, [params?.id]);

  const back = <Btn onClick={() => router.back()}>Back</Btn>;

  if (err) return (
    <OsPage>
      <PageHead eyebrow="Admin › Inventory" title="Unit" actions={back} />
      <Callout tone="bad" title="Unit not found.">{err}</Callout>
    </OsPage>
  );
  if (!d) return (
    <OsPage>
      <PageHead eyebrow="Admin › Inventory" title="Loading unit…" actions={back} />
      <div className="gx-card gx-pad" aria-busy="true"><div className="gx-skel" style={{ height: 140 }} /></div>
    </OsPage>
  );

  const u = d.unit;
  const prop = u.property;
  const loc = [prop?.community?.nameEn, prop?.emirate?.nameEn].filter(Boolean).join(', ') || prop?.fullAddress || '—';
  const lt = leaseTermsFromUnit({ facilities: u.facilities });
  let amenities: string[] = [];
  try { const f = u.facilities ? JSON.parse(u.facilities) : null; if (f && Array.isArray(f.amenities)) amenities = f.amenities as string[]; } catch { /* ignore */ }
  const leaseRows: [string, string][] = [
    ['Min lease', lt.minLeaseMonths ? `${lt.minLeaseMonths} months` : ''],
    ['Notice period', lt.noticePeriodDays ? `${lt.noticePeriodDays} days` : ''],
    ['Rent escalation', lt.rentEscalationPct ? `${lt.rentEscalationPct}%` : ''],
    ['Rental type', lt.rentalType && lt.rentalType !== 'yearly' ? titleCase(lt.rentalType) : lt.rentalType ? 'Yearly' : ''],
    ['Installments', lt.numberOfPayments || ''],
    ['Advance payment', lt.advancePayment ? aed(Number(lt.advancePayment)) : ''],
    ['Grace period', lt.gracePeriodDays ? `${lt.gracePeriodDays} days` : ''],
    ['Late-payment fee', lt.latePaymentFee ? aed(Number(lt.latePaymentFee)) : ''],
  ].filter(([, v]) => v) as [string, string][];
  const pricingRows: [string, string][] = [
    ['Security deposit', u.securityDeposit != null ? aed(u.securityDeposit) : ''],
    ['Admin fee', u.adminFee != null ? aed(u.adminFee) : ''],
    // `ejariFeeFils` is a misnomer: it maps to units.ejari_fee, numeric(12,2) in
    // WHOLE AED — not fils. Dividing by 100 rendered a 250 AED registration fee
    // as "AED 2.5". The customer contract view multiplies by 100 to reach fils,
    // which confirms the stored unit.
    ['Contract Registration Fee', u.ejariFeeFils != null ? aed(u.ejariFeeFils) : ''],
    ['Commission', u.commission != null ? aed(u.commission) : ''],
    ['Service charges', u.serviceCharges != null ? aed(u.serviceCharges) : ''],
  ].filter(([, v]) => v) as [string, string][];
  const residential = isResidentialUnitType(u.unitType);
  const ownerNode = d.owner
    ? (d.owner.userId ? <Btn size="xs" href={`/dashboard/admin/users/${d.owner.userId}`}>{d.owner.name ?? 'RP'}</Btn> : (d.owner.name ?? '—'))
    : '—';
  const mo = d.lastMoveOut;
  const ph = d.priceHistory;
  const ct = d.currentTenancy;
  const plan = d.planAddendum && (d.planAddendum.addendumFileUrl || d.planAddendum.specialConditions) ? d.planAddendum : null;
  const hasPlan = plan != null;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Inventory"
        title={u.unitNumber ? `Unit ${u.unitNumber}` : `Unit #${u.id}`}
        lede={<>{prop?.buildingName ?? 'Property'} · {loc}{u.planLabel ? ` · Plan: ${u.planLabel}` : ''}</>}
        actions={<>
          {back}
          <Btn href={`/dashboard/admin/properties/${u.propertyId}`}>Open property</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Availability', value: u.availability ? <StatusTag status={u.availability} /> : '—' },
        { label: 'Listing', value: titleCase(u.listingStatus) },
        { label: 'Owner (RP)', value: ownerNode },
        { label: 'Rent / yr', value: aed(u.rentalPrice) },
      ]} />

      <div style={{ marginBottom: 14 }}>
        <Card title="Specs" pad>
          <KV items={[
            { k: 'Type', v: titleCase(u.unitType) },
            { k: 'Tier', v: titleCase(u.unitTier) },
            ...(residential ? [{ k: 'Bedrooms', v: u.bedrooms != null ? (u.bedrooms === 0 ? 'Studio' : String(u.bedrooms)) : '—' }] : []),
            { k: 'Bathrooms', v: u.bathrooms != null ? String(u.bathrooms) : '—' },
            { k: 'Parking', v: u.parkingSpaces != null ? String(u.parkingSpaces) : '—' },
            { k: 'Furnishing', v: titleCase(u.furnishing) },
            { k: 'Size', v: u.unitSizeSqm != null ? `${u.unitSizeSqm} sqm` : (u.unitSizeSqft != null ? `${u.unitSizeSqft} sqft` : '—') },
            { k: 'Floor', v: u.floor ?? '—' },
            { k: 'View', v: u.view ?? '—' },
            { k: 'Premise no.', v: u.premiseNumber ?? '—' },
            { k: 'Rent / yr', v: aed(u.rentalPrice) },
            { k: 'Listing', v: titleCase(u.listingStatus) },
            { k: 'Building', v: <Btn size="xs" href={`/dashboard/admin/properties/${u.propertyId}`}>{prop?.buildingName ?? 'Property'}</Btn> },
            ...(d.owner ? [{ k: 'Owner (RP)', v: ownerNode }] : []),
          ]} />
        </Card>
      </div>

      {/* Photos */}
      {d.media.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Card title={`Photos (${d.media.length})`} pad>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {d.media.map((m) => (
                isImg(m.url) ? (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="gx-card" style={{ display: 'block', overflow: 'hidden' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.caption ?? 'Unit photo'} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                    {m.caption && <p style={{ fontSize: 11, color: 'var(--ms-ink-3)', padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.caption}</p>}
                  </a>
                ) : (
                  <button key={m.id} type="button" onClick={() => openDocViewer({ fileUrl: m.url, caption: m.caption ?? 'Floor plan' })}
                    className="gx-card" style={{ height: 120, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ms-ink-3)', fontSize: 11.5 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}><FileText size={20} aria-hidden /> {m.mediaType === 'floor_plan' ? 'View floor plan' : 'View'}</span>
                  </button>
                )
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Leasing configuration + pricing + amenities */}
      {(leaseRows.length > 0 || pricingRows.length > 0 || amenities.length > 0) && (
        <div style={{ marginBottom: 14 }}>
          <Card title="Leasing configuration" pad>
            <div className="gx-two">
              <div>
                <div style={subLabel}>Lease terms</div>
                {leaseRows.length ? <KV items={leaseRows.map(([k, v]) => ({ k, v }))} /> : <p className="gx-hint">No lease terms configured.</p>}
              </div>
              <div>
                <div style={subLabel}>Pricing &amp; fees</div>
                {pricingRows.length ? <KV items={pricingRows.map(([k, v]) => ({ k, v }))} /> : <p className="gx-hint">No fees configured.</p>}
              </div>
            </div>
            {amenities.length > 0 && (
              <div style={divider}>
                <div style={subLabel}>Amenities</div>
                <div className="gx-btn-row">{amenities.map((a) => <Pill key={a} tone="outline" dot={false}>{titleCase(a)}</Pill>)}</div>
              </div>
            )}
            {lt.specialConditions && (
              <div style={divider}>
                <div style={subLabel}>Special conditions</div>
                <p style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{lt.specialConditions}</p>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className={hasPlan ? 'gx-cols gx-cols-2e' : 'gx-cols'} style={{ marginBottom: 14 }}>
        {/* Plan agreement / addendum */}
        {plan ? (
          <Card title={`Plan agreement & addendum${plan.versionNo ? ` · v${plan.versionNo}` : ''}`} pad>
            {plan.addendumFileUrl && (
              <Btn size="sm" onClick={() => openDocViewer({ fileUrl: plan.addendumFileUrl!, caption: plan.addendumFileName ?? 'Agreement addendum' })}>
                View {plan.addendumFileName ?? 'agreement addendum'}
              </Btn>
            )}
            {plan.specialConditions && <p style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 10 }}>{plan.specialConditions}</p>}
          </Card>
        ) : null}

        {/* Unit documents */}
        <Card title={`Unit documents (${d.documents.length})`}>
          {d.documents.length ? (
            <div className="gx-tbl-scroll">
              <table className="gx-tbl">
                <thead><tr><th>Document</th><th>Status</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {d.documents.map((doc) => {
                    const caption = (doc.displayName ?? doc.documentKey).replace(/_/g, ' ');
                    return (
                      <tr key={doc.id}>
                        <td className="strong" style={{ textTransform: 'capitalize' }}>{caption}</td>
                        <td><StatusTag status={doc.status} label={titleCase(doc.status)} /></td>
                        <td className="act"><Btn size="xs" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption })}>View</Btn></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="gx-empty">No documents uploaded for this unit.</div>}
        </Card>
      </div>

      {/* Last recorded move-out condition — the unit's last known state and what
          was chargeable against the outgoing customer's deposit. */}
      {mo && (
        <div style={{ marginBottom: 14 }}>
          <Card title="Last move-out condition">
            <div className="gx-pad">
              <KV items={[
                { k: 'Recorded', v: fmtDate(mo.recordedAt) },
                { k: 'Areas inspected', v: String(mo.categories) },
                { k: mo.priced ? 'Items charged' : 'Items inspected', v: mo.priced ? `${mo.itemsChargeable} of ${mo.itemsTotal}` : String(mo.itemsTotal) },
                // A legacy inspection carries no price book — showing "AED 0" would read
                // as "nothing chargeable" when it means "not priced".
                { k: 'Chargeable', v: mo.priced ? <span style={{ color: mo.totalCostAed > 0 ? 'var(--ms-amber-text)' : undefined }}>{aed(mo.totalCostAed)}</span> : <Pill tone="neutral" dot={false}>Not priced</Pill> },
              ]} />
            </div>
            {mo.flagged.length > 0 ? (
              <div className="gx-tbl-scroll">
                <table className="gx-tbl">
                  <thead>
                    <tr>
                      <th>Flagged item{mo.flaggedTotal > mo.flagged.length ? ` · showing ${mo.flagged.length} of ${mo.flaggedTotal}` : ''}</th>
                      <th>Area</th><th>Condition</th><th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mo.flagged.map((f, i) => (
                      <tr key={i}>
                        <td className="strong">{f.component}</td>
                        <td>{f.category}</td>
                        <td>{f.outCondition ? <Pill tone="amber">{humanize(f.outCondition)}</Pill> : '—'}</td>
                        <td className="num">{f.costAed > 0 ? aed(f.costAed) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="gx-empty">Inspection recorded with nothing flagged and nothing chargeable.</div>
            )}
          </Card>
        </div>
      )}

      {/* Price history — lease rents + between-tenancy repricing. Rendered only
          when there is something to show, per the data-not-configuration rule. */}
      {(ph?.timeline?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Card title="Price history" sub={`${ph!.leaseCount} lease${ph!.leaseCount === 1 ? '' : 's'} · ${ph!.repriceCount} repricing${ph!.repriceCount === 1 ? '' : 's'}`}>
            <div className="gx-tbl-scroll">
              <table className="gx-tbl">
                <thead><tr><th>Date</th><th>Event</th><th className="num">Price</th></tr></thead>
                <tbody>
                  {ph!.timeline.map((ev, i) => (
                    <tr key={i}>
                      <td className="nowrap">{fmtDate(ev.date)}</td>
                      <td>
                        {ev.kind === 'lease' ? (
                          <>
                            <Pill tone="primary">Lease</Pill>
                            {ev.contractType ? ` · ${titleCase(ev.contractType)}` : ''}
                            {ev.effectiveTo ? ` · to ${fmtDate(ev.effectiveTo)}` : ''}
                            {(ev.discountAmount ?? 0) > 0 && ev.listedPrice != null && (
                              <span style={{ color: 'var(--ms-amber-text)' }}> · {aed(ev.discountAmount)} off {aed(ev.listedPrice)}</span>
                            )}
                          </>
                        ) : (
                          <>
                            <Pill tone="info">Repriced</Pill>
                            {ev.field ? ` · ${titleCase(ev.field)}` : ''}
                            {ev.source ? ` · ${titleCase(ev.source)}` : ''}
                            {ev.reason ? ` · ${ev.reason}` : ''}
                          </>
                        )}
                      </td>
                      <td className="num strong">
                        {ev.kind === 'lease'
                          ? aed(ev.annualRent)
                          : <>{ev.oldPrice != null && <span style={{ color: 'var(--ms-ink-3)', textDecoration: 'line-through', marginRight: 6, fontWeight: 400 }}>{aed(ev.oldPrice)}</span>}{aed(ev.newPrice)}</>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Current tenancy + its contract addendums */}
      <Card title="Current tenancy" right={ct ? <StatusTag status={ct.status} /> : undefined}>
        {ct ? (
          <>
            <div className="gx-pad">
              <KV items={[
                { k: 'Customer', v: ct.tenantUserId ? <Btn size="xs" href={`/dashboard/admin/users/${ct.tenantUserId}`}>{ct.tenantName ?? 'Customer'}</Btn> : (ct.tenantName ?? 'Customer') },
                { k: 'Contract', v: ct.ref },
                { k: 'Period', v: `${fmtDate(ct.startDate)} – ${fmtDate(ct.endDate)}` },
                { k: 'Annual rent', v: ct.annualRent != null ? `${aed(ct.annualRent)}/yr` : '—' },
              ]} />
            </div>
            {d.contractAddendums.length > 0 && (
              <div className="gx-tbl-scroll">
                <table className="gx-tbl">
                  <thead><tr><th>Contract addendum</th><th>Signatures</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {d.contractAddendums.map((a) => {
                      const both = a.tenantSigned && a.landlordSigned;
                      const one = a.tenantSigned || a.landlordSigned;
                      return (
                        <tr key={a.id}>
                          <td className="strong">{a.name}</td>
                          <td><Pill tone={both ? 'primary' : one ? 'amber' : 'neutral'}>{both ? 'Signed' : one ? 'Partially signed' : 'Unsigned'}</Pill></td>
                          <td className="act"><Btn size="xs" onClick={() => openDocViewer({ fileUrl: a.fileUrl, caption: a.name })}>View</Btn></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="gx-empty">No active tenancy — unit is {u.availability ?? 'unoccupied'}.</div>
        )}
      </Card>
    </OsPage>
  );
}
