/**
 * Admin unit detail (read-only) — SCRUM-588 click-through target.
 * Full parity with the RP unit view: photos, specs, leasing configuration +
 * pricing, plan agreement/addendum, unit documents, and the current tenancy's
 * contract addendums. Documents/addendums open inline (view-only) per policy.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Home, Building2, ExternalLink, FileText, ImageIcon, Settings2, ScrollText, Paperclip, History, ClipboardCheck } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';
import { leaseTermsFromUnit } from '@/lib/unitForm';

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

const availCls: Record<string, string> = {
  available: 'bg-[#d8f2e8] text-[#1a7a5a]', occupied: 'bg-[#e8f0fb] text-[#1a5fb4]',
  maintenance: 'bg-[#fef9eb] text-[#b45309]', reserved: 'bg-[#f3effb] text-[#7c3aed]',
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const titleCase = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const aed = (v: number | null | undefined) => (v == null ? '—' : `AED ${Number(v).toLocaleString('en-AE')}`);
const isImg = (u: string) => /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">{label}</div>
      <div className="text-sm font-semibold text-[#3f3d39] mt-0.5">{value}</div>
    </div>
  );
}
function Card({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e8e6e0] bg-white p-5 mb-5">
      <div className="flex items-center gap-2 mb-4"><Icon size={15} className="text-[#9b9890]" /><span className="text-sm font-semibold text-[#3f3d39]">{title}</span></div>
      {children}
    </div>
  );
}

export default function AdminUnitDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<UnitDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiGet<UnitDetail>(`/admin/units/${params.id}`).then(setD).catch((e) => setErr(e?.message || 'Failed to load'));
  }, [params?.id]);

  if (err) return (
    <div className="p-8">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>
      <div className="rounded-xl border border-[#e8e6e0] bg-white p-10 text-center text-[#6b6860]">Unit not found — {err}</div>
    </div>
  );
  if (!d) return <div className="p-8 text-[#6b6860]">Loading…</div>;

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

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Back</button>

      {/* Header + specs */}
      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-6 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-[#f0faf6] text-[#1a7a5a] grid place-items-center shrink-0"><Home size={20} /></span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[#1a1916] leading-tight">{u.unitNumber ? `Unit ${u.unitNumber}` : (u.unitName ?? `Unit #${u.id}`)}</h1>
              <Link href={`/dashboard/admin/properties/${u.propertyId}`} className="text-sm text-[#1a7a5a] hover:underline inline-flex items-center gap-1.5 mt-1"><Building2 size={13} /> {prop?.buildingName ?? 'Property'} <ExternalLink size={11} /></Link>
              <p className="text-xs text-[#9b9890] mt-0.5">{loc}{u.planLabel ? ` · Plan: ${u.planLabel}` : ''}</p>
            </div>
          </div>
          {u.availability && <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${availCls[u.availability] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>{u.availability}</span>}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-[#f0ede8]">
          <Stat label="Type" value={titleCase(u.unitType)} />
          <Stat label="Tier" value={titleCase(u.unitTier)} />
          <Stat label="Bedrooms" value={u.bedrooms != null ? String(u.bedrooms) : '—'} />
          <Stat label="Bathrooms" value={u.bathrooms != null ? String(u.bathrooms) : '—'} />
          <Stat label="Parking" value={u.parkingSpaces != null ? String(u.parkingSpaces) : '—'} />
          <Stat label="Furnishing" value={titleCase(u.furnishing)} />
          <Stat label="Size" value={u.unitSizeSqm != null ? `${u.unitSizeSqm} sqm` : (u.unitSizeSqft != null ? `${u.unitSizeSqft} sqft` : '—')} />
          <Stat label="Floor" value={u.floor ?? '—'} />
          <Stat label="View" value={u.view ?? '—'} />
          <Stat label="Premise no." value={u.premiseNumber ?? '—'} />
          <Stat label="Rent / yr" value={aed(u.rentalPrice)} />
          <Stat label="Listing" value={titleCase(u.listingStatus)} />
          {d.owner && <div><div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Owner (RP)</div>{d.owner.userId ? <Link href={`/dashboard/admin/users/${d.owner.userId}`} className="text-sm font-semibold text-[#1a7a5a] hover:underline mt-0.5 inline-block">{d.owner.name ?? 'RP'}</Link> : <div className="text-sm font-semibold text-[#3f3d39] mt-0.5">{d.owner.name ?? '—'}</div>}</div>}
        </div>
      </div>

      {/* Photos */}
      {d.media.length > 0 && (
        <Card icon={ImageIcon} title={`Photos (${d.media.length})`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {d.media.map((m) => (
              isImg(m.url) ? (
                <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-[#e8e6e0] group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.caption ?? 'Unit photo'} className="w-full h-32 object-cover group-hover:opacity-90 transition" />
                  {m.caption && <p className="text-[11px] text-[#6b6860] px-2 py-1 truncate">{m.caption}</p>}
                </a>
              ) : (
                <button key={m.id} onClick={() => openDocViewer({ fileUrl: m.url, caption: m.caption ?? 'Floor plan' })} className="rounded-xl border border-[#e8e6e0] h-32 grid place-items-center text-[#9b9890] hover:bg-[#faf9f7]">
                  <span className="flex flex-col items-center gap-1 text-xs"><FileText size={20} /> {m.mediaType === 'floor_plan' ? 'Floor plan' : 'View'}</span>
                </button>
              )
            ))}
          </div>
        </Card>
      )}

      {/* Leasing configuration + pricing + amenities */}
      {(leaseRows.length > 0 || pricingRows.length > 0 || amenities.length > 0) && (
        <Card icon={Settings2} title="Leasing configuration">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-2">Lease terms</p>
              {leaseRows.length ? (
                <div className="grid grid-cols-2 gap-3">{leaseRows.map(([k, v]) => <Stat key={k} label={k} value={v} />)}</div>
              ) : <p className="text-sm text-[#9b9890]">No lease terms configured.</p>}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-2">Pricing & fees</p>
              {pricingRows.length ? (
                <div className="grid grid-cols-2 gap-3">{pricingRows.map(([k, v]) => <Stat key={k} label={k} value={v} />)}</div>
              ) : <p className="text-sm text-[#9b9890]">No fees configured.</p>}
            </div>
          </div>
          {amenities.length > 0 && (
            <div className="mt-5 pt-4 border-t border-[#f0ede8]">
              <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-2">Amenities</p>
              <div className="flex flex-wrap gap-1.5">{amenities.map((a) => <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860]">{titleCase(a)}</span>)}</div>
            </div>
          )}
          {lt.specialConditions && (
            <div className="mt-5 pt-4 border-t border-[#f0ede8]">
              <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-1">Special conditions</p>
              <p className="text-sm text-[#3f3d39] whitespace-pre-wrap">{lt.specialConditions}</p>
            </div>
          )}
        </Card>
      )}

      {/* Plan agreement / addendum */}
      {d.planAddendum && (d.planAddendum.addendumFileUrl || d.planAddendum.specialConditions) && (
        <Card icon={ScrollText} title={`Plan agreement & addendum${d.planAddendum.versionNo ? ` · v${d.planAddendum.versionNo}` : ''}`}>
          {d.planAddendum.addendumFileUrl && (
            <button onClick={() => openDocViewer({ fileUrl: d.planAddendum!.addendumFileUrl!, caption: d.planAddendum!.addendumFileName ?? 'Agreement addendum' })}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8e6e0] text-sm text-[#3f3d39] hover:bg-[#faf9f7]">
              <Paperclip size={14} /> {d.planAddendum.addendumFileName ?? 'Agreement addendum'}
            </button>
          )}
          {d.planAddendum.specialConditions && <p className="text-sm text-[#3f3d39] whitespace-pre-wrap mt-3">{d.planAddendum.specialConditions}</p>}
        </Card>
      )}

      {/* Unit documents */}
      <Card icon={FileText} title={`Unit documents (${d.documents.length})`}>
        {d.documents.length ? (
          <div className="space-y-2">
            {d.documents.map((doc) => (
              <button key={doc.id} onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: (doc.displayName ?? doc.documentKey).replace(/_/g, ' ') })}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#e8e6e0] hover:bg-[#faf9f7] text-left">
                <FileText size={15} className="text-[#9b9890] shrink-0" />
                <span className="text-sm text-[#3f3d39] flex-1 truncate">{(doc.displayName ?? doc.documentKey).replace(/_/g, ' ')}</span>
                <span className="text-[11px] text-[#9b9890]">{titleCase(doc.status)}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-[#9b9890]">No documents uploaded for this unit.</p>}
      </Card>

      {/* Last recorded move-out condition — the unit's last known state and what
          was chargeable against the outgoing customer's deposit. */}
      {d.lastMoveOut && (
        <Card icon={ClipboardCheck} title="Last move-out condition">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Stat label="Recorded" value={fmtDate(d.lastMoveOut.recordedAt)} />
            <Stat label="Areas inspected" value={String(d.lastMoveOut.categories)} />
            <Stat
              label={d.lastMoveOut.priced ? 'Items charged' : 'Items inspected'}
              value={d.lastMoveOut.priced
                ? `${d.lastMoveOut.itemsChargeable} of ${d.lastMoveOut.itemsTotal}`
                : String(d.lastMoveOut.itemsTotal)}
            />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Chargeable</div>
              {/* A legacy inspection carries no price book — showing "AED 0"
                  would read as "nothing chargeable" when it means "not priced". */}
              <div className={`text-sm font-semibold mt-0.5 ${d.lastMoveOut.priced && d.lastMoveOut.totalCostAed > 0 ? 'text-[#b45309]' : 'text-[#3f3d39]'}`}>
                {d.lastMoveOut.priced ? aed(d.lastMoveOut.totalCostAed) : <span className="text-[#9b9890] font-normal">Not priced</span>}
              </div>
            </div>
          </div>

          {d.lastMoveOut.flagged.length > 0 ? (
            <>
              <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-2">
                Flagged items{d.lastMoveOut.flaggedTotal > d.lastMoveOut.flagged.length
                  ? ` · showing ${d.lastMoveOut.flagged.length} of ${d.lastMoveOut.flaggedTotal}`
                  : ''}
              </p>
              <div className="space-y-1.5">
                {d.lastMoveOut.flagged.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[#e8e6e0]">
                    <span className="text-sm text-[#3f3d39] flex-1 truncate">
                      {f.component}
                      <span className="text-[#9b9890]"> · {f.category}</span>
                    </span>
                    {f.outCondition && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#6b6860] capitalize shrink-0">
                        {f.outCondition.replace(/_/g, ' ')}
                      </span>
                    )}
                    {f.costAed > 0 && (
                      <span className="text-sm font-medium text-[#b45309] tabular-nums shrink-0">{aed(f.costAed)}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-[#9b9890]">Inspection recorded with nothing flagged and nothing chargeable.</p>
          )}
        </Card>
      )}

      {/* Price history — lease rents + between-tenancy repricing. Rendered only
          when there is something to show, per the data-not-configuration rule. */}
      {(d.priceHistory?.timeline?.length ?? 0) > 0 && (
        <Card icon={History} title={`Price history (${d.priceHistory!.leaseCount} lease${d.priceHistory!.leaseCount === 1 ? '' : 's'} · ${d.priceHistory!.repriceCount} repricing${d.priceHistory!.repriceCount === 1 ? '' : 's'})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8e6e0] text-left text-xs font-semibold uppercase tracking-wide text-[#9b9890]">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {d.priceHistory!.timeline.map((ev, i) => (
                  <tr key={i} className="border-b border-[#f4f3ef] last:border-b-0">
                    <td className="py-2.5 pr-4 whitespace-nowrap text-[#1a1916]">{fmtDate(ev.date)}</td>
                    <td className="py-2.5 pr-4 text-[#6b6860]">
                      {ev.kind === 'lease' ? (
                        <>
                          <span className="font-medium text-[#1a1916]">Lease</span>
                          {ev.contractType ? ` · ${titleCase(ev.contractType)}` : ''}
                          {ev.effectiveTo ? ` · to ${fmtDate(ev.effectiveTo)}` : ''}
                          {(ev.discountAmount ?? 0) > 0 && ev.listedPrice != null && (
                            <span className="text-[#b45309]"> · {aed(ev.discountAmount)} off {aed(ev.listedPrice)}</span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="font-medium text-[#1a1916]">Repriced</span>
                          {ev.field ? ` · ${titleCase(ev.field)}` : ''}
                          {ev.source ? ` · ${titleCase(ev.source)}` : ''}
                          {ev.reason ? ` · ${ev.reason}` : ''}
                        </>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-[#1a1916] whitespace-nowrap">
                      {ev.kind === 'lease'
                        ? aed(ev.annualRent)
                        : <>{ev.oldPrice != null && <span className="text-[#9b9890] line-through mr-1.5">{aed(ev.oldPrice)}</span>}{aed(ev.newPrice)}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Current tenancy + its contract addendums */}
      <Card icon={FileText} title="Current tenancy">
        {d.currentTenancy ? (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <Link href={`/dashboard/admin/users/${d.currentTenancy.tenantUserId ?? ''}`} className={`text-sm font-semibold ${d.currentTenancy.tenantUserId ? 'text-[#1a7a5a] hover:underline' : 'text-[#3f3d39] pointer-events-none'}`}>{d.currentTenancy.tenantName ?? 'Tenant'}</Link>
                <div className="text-xs text-[#6b6860] mt-0.5">{d.currentTenancy.ref} · {fmtDate(d.currentTenancy.startDate)} – {fmtDate(d.currentTenancy.endDate)}</div>
              </div>
              {d.currentTenancy.annualRent != null && <span className="text-sm font-medium text-[#3f3d39] tabular-nums">{aed(d.currentTenancy.annualRent)}/yr</span>}
            </div>
            {d.contractAddendums.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#f0ede8]">
                <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold mb-2">Contract addendums</p>
                <div className="space-y-2">
                  {d.contractAddendums.map((a) => (
                    <button key={a.id} onClick={() => openDocViewer({ fileUrl: a.fileUrl, caption: a.name })}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#e8e6e0] hover:bg-[#faf9f7] text-left">
                      <Paperclip size={14} className="text-[#9b9890] shrink-0" />
                      <span className="text-sm text-[#3f3d39] flex-1 truncate">{a.name}</span>
                      <span className="text-[11px] text-[#9b9890]">{a.tenantSigned && a.landlordSigned ? 'Signed' : a.tenantSigned || a.landlordSigned ? 'Partially signed' : 'Unsigned'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-[#9b9890]">No active tenancy — unit is {u.availability ?? 'unoccupied'}.</div>
        )}
      </Card>
    </div>
  );
}
