'use client';

/**
 * Admin — User detail.
 *
 * Shows a summary for any user, plus (for a Landlord / rental_provider) a full
 * breakdown: their properties, units, the customers engaged with them, and
 * their leases. The four breakdown lists are laid out two-per-row and each
 * scrolls internally (capped height) so the page itself stays compact even for
 * a landlord with hundreds of units / leases. Data: GET /admin/users/:id.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Building2, Home, Users as UsersIcon, FileText, Mail, Phone,
  ShieldCheck, BadgeCheck, Clock, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { apiGet } from '@/lib/api';

const roleLabel: Record<string, string> = {
  customer: 'Customer',
  rental_provider: 'Rental Provider',
  service_provider: 'Service Provider',
  technician: 'Technician',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

interface UserDetail {
  user: {
    id: number; name: string; firstName: string | null; lastName: string | null;
    email: string; phone: string | null; role: string; status: string;
    kycStatus: string; emailVerified: boolean; phoneVerified: boolean;
    profilePictureUrl: string | null; nationality: string | null;
    createdAt: string; lastLoginAt: string | null;
  };
  landlord: null | {
    profile: {
      rentalProviderId: number; companyName: string | null;
      entityType: string | null; companyType: string | null;
      tradeLicenseNumber: string | null;
    };
    summary: {
      properties: number; units: number; occupiedUnits: number;
      customers: number; leases: number; activeLeases: number;
    };
    properties: { id: number; buildingName: string; spaceCategory: string; fullAddress: string | null; unitCount: number; occupiedCount: number }[];
    units: { id: number; unitNumber: string; unitName: string | null; unitType: string; availability: string; rentalPrice: number | null; propertyId: number; propertyName: string | null }[];
    customers: { tenantId: number; userId: number; name: string; email: string | null; phone: string | null; hasLease: boolean }[];
    leases: { id: number; status: string; contractStartDate: string | null; contractEndDate: string | null; annualRent: number | null; tenantName: string; unitNumber: string | null }[];
    insights: {
      financials: { annualRecurringRent: number; totalContractValue: number; avgRentActive: number; depositsHeld: number; vatCollected: number };
      occupancy: { totalUnits: number; occupiedUnits: number; vacantUnits: number; occupancyPct: number; vacantRentPotential: number };
      collections: { byStatus: Record<string, { count: number; amount: number }>; collectedAmount: number; pendingAmount: number; bouncedCount: number; collectionRatePct: number };
      listings: { byStatus: Record<string, number>; published: number; total: number };
      leaseLifecycle: { byStatus: Record<string, number>; expiring30: number; expiring60: number; expiring90: number; renewalBacklog: number };
      pipeline: { byStage: Record<string, number>; totalLeads: number; convertedLeads: number; conversionPct: number };
      unitMix: Record<string, number>;
    };
  };
}

const aed = (n: number | null | undefined) =>
  n == null ? '—' : `AED ${Math.round(Number(n)).toLocaleString('en-AE')}`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-AE') : '—');
const titleCase = (s: string | null | undefined) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—';

const statusColor: Record<string, { bg: string; color: string }> = {
  active: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  occupied: { bg: '#eff6ff', color: '#1e40af' },
  available: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  pending_verification: { bg: '#fef9eb', color: 'var(--color-gold)' },
  suspended: { bg: '#fef2f2', color: 'var(--color-error)' },
  banned: { bg: '#fef2f2', color: 'var(--color-error)' },
};

const ROW = 'rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-3';
const ROW_STYLE = { border: '1px solid var(--color-base-200)', backgroundColor: '#fff' };

function KpiCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <p className="text-xs mb-1.5" style={{ color: 'var(--color-neutral-500)' }}>{label}</p>
      <p className="text-xl font-bold leading-tight truncate" style={{ color: accent ?? 'var(--color-neutral-900)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--color-neutral-400)' }}>{sub}</p>}
    </div>
  );
}

function MiniPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-neutral-900)' }}>{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ label, value, dot }: { label: string; value: React.ReactNode; dot?: string }) {
  return (
    <div className="flex items-center justify-between text-sm gap-3">
      <span className="flex items-center gap-2 min-w-0" style={{ color: 'var(--color-neutral-600)' }}>
        {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold flex-shrink-0" style={{ color: 'var(--color-neutral-900)' }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--color-base-200)', margin: '8px 0' }} />;
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-neutral-400)' }}>{children}</p>;
}

type LandlordInsights = NonNullable<UserDetail['landlord']>['insights'];

function Insights({ ins }: { ins: LandlordInsights }) {
  const f = ins.financials, o = ins.occupancy, col = ins.collections, ls = ins.leaseLifecycle, lst = ins.listings, pl = ins.pipeline;
  const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1];
  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <KpiCard label="Annual recurring rent" value={aed(f.annualRecurringRent)} sub={`avg ${aed(f.avgRentActive)}/unit`} accent="var(--color-primary)" />
        <KpiCard label="Occupancy" value={`${o.occupancyPct}%`} sub={`${o.occupiedUnits}/${o.totalUnits} · ${o.vacantUnits} vacant`} />
        <KpiCard label="Rent collected" value={aed(col.collectedAmount)} sub={`${aed(col.pendingAmount)} pending · ${col.bouncedCount} bounced`} />
        <KpiCard label="Listed units" value={`${lst.published}/${lst.total}`} sub="published on platform" accent={lst.total > 0 && lst.published === 0 ? 'var(--color-error)' : undefined} />
        <KpiCard label="Renewal backlog" value={ls.renewalBacklog} sub="expired leases" accent={ls.renewalBacklog > 0 ? 'var(--color-gold)' : undefined} />
        <KpiCard label="Expiring ≤90d" value={ls.expiring90} sub={`30d: ${ls.expiring30} · 60d: ${ls.expiring60}`} />
      </div>

      {/* Detail panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <MiniPanel title="Financials & collections">
          <KV label="Total contract value" value={aed(f.totalContractValue)} />
          <KV label="VAT collected" value={aed(f.vatCollected)} />
          <KV label="Deposits held" value={aed(f.depositsHeld)} />
          <Divider />
          <KV label="Cleared cheques" value={`${col.byStatus.cleared?.count ?? 0} · ${aed(col.byStatus.cleared?.amount ?? 0)}`} dot="var(--color-primary)" />
          <KV label="Pending cheques" value={`${col.byStatus.pending?.count ?? 0} · ${aed(col.byStatus.pending?.amount ?? 0)}`} dot="var(--color-gold)" />
          <KV label="Bounced cheques" value={`${col.byStatus.bounced?.count ?? 0} · ${aed(col.byStatus.bounced?.amount ?? 0)}`} dot="var(--color-error)" />
          <KV label="Collection rate" value={`${col.collectionRatePct}%`} />
        </MiniPanel>

        <MiniPanel title="Lease lifecycle">
          {Object.entries(ls.byStatus).sort(byCount).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
          <Divider />
          <KV label="Expiring 30 / 60 / 90 days" value={`${ls.expiring30} / ${ls.expiring60} / ${ls.expiring90}`} />
          <KV label="Renewal backlog (expired)" value={ls.renewalBacklog} />
        </MiniPanel>

        <MiniPanel title="Listings & unit mix">
          <Caption>Listing status</Caption>
          {Object.entries(lst.byStatus).sort(byCount).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
          <Divider />
          <Caption>Unit mix</Caption>
          {Object.entries(ins.unitMix).sort(byCount).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
        </MiniPanel>

        <MiniPanel title="Demand pipeline">
          <KV label="Total leads" value={pl.totalLeads} />
          <KV label="Converted" value={`${pl.convertedLeads} (${pl.conversionPct}%)`} />
          <Divider />
          {pl.totalLeads === 0
            ? <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>No platform leads yet.</p>
            : Object.entries(pl.byStage).sort(byCount).map(([k, v]) => <KV key={k} label={titleCase(k)} value={v} />)}
        </MiniPanel>
      </div>
    </>
  );
}

/** A breakdown card: header (title + count) and an internally-scrolling body. */
function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl flex flex-col overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)', maxHeight: 440 }}>
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-base-200)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{title}</h3>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>{count}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {count === 0
          ? <p className="text-sm py-2 text-center" style={{ color: 'var(--color-neutral-400)' }}>None.</p>
          : children}
      </div>
    </div>
  );
}

function Pill({ value }: { value: string }) {
  const sc = statusColor[value] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' };
  return <span className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0" style={{ backgroundColor: sc.bg, color: sc.color }}>{value.replace(/_/g, ' ')}</span>;
}

export default function AdminUserDetailPage() {
  useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      setData(await apiGet<UserDetail>(`/admin/users/${id}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const u = data?.user;
  const L = data?.landlord;

  return (
    <DashboardPage title="User Detail" subtitle={u ? u.name : ''}>
      <button
        onClick={() => router.push('/dashboard/admin/users')}
        className="flex items-center gap-1.5 text-sm mb-4 transition-colors"
        style={{ color: 'var(--color-neutral-500)' }}
      >
        <ArrowLeft size={15} /> Back to users
      </button>

      {loading && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>Loading…</div>
      )}
      {!loading && error && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-error)', boxShadow: 'var(--shadow-sm)' }}>{error}</div>
      )}

      {!loading && !error && u && (
        <>
          {/* ── Summary ── */}
          <div className="bg-white rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--color-base-100)' }}>
              {u.profilePictureUrl
                ? <img src={u.profilePictureUrl} alt="" className="w-full h-full object-cover" />
                : <UsersIcon size={22} style={{ color: 'var(--color-neutral-500)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold" style={{ color: 'var(--color-neutral-900)' }}>{u.name}</h2>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{roleLabel[u.role] ?? u.role}</span>
                <Pill value={u.status} />
                {u.kycStatus === 'pending_review' && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}><ShieldCheck size={11} /> KYC Pending</span>
                )}
                {u.kycStatus === 'verified' && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}><BadgeCheck size={11} /> KYC Verified</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-sm flex-wrap" style={{ color: 'var(--color-neutral-500)' }}>
                <span className="flex items-center gap-1"><Mail size={13} /> {u.email}{u.emailVerified ? ' ✓' : ''}</span>
                {u.phone && <span className="flex items-center gap-1"><Phone size={13} /> {u.phone}{u.phoneVerified ? ' ✓' : ''}</span>}
                {u.nationality && <span>{u.nationality}</span>}
                <span className="flex items-center gap-1"><Clock size={13} /> Joined {fmtDate(u.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* ── Landlord breakdown ── */}
          {L ? (
            <>
              {/* Profile line */}
              {(L.profile.companyName || L.profile.tradeLicenseNumber) && (
                <div className="bg-white rounded-2xl p-4 mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  {L.profile.companyName && <span><span style={{ color: 'var(--color-neutral-400)' }}>Company: </span><span style={{ color: 'var(--color-neutral-800)', fontWeight: 600 }}>{L.profile.companyName}</span></span>}
                  <span><span style={{ color: 'var(--color-neutral-400)' }}>Type: </span><span style={{ color: 'var(--color-neutral-800)', fontWeight: 600 }}>{titleCase(L.profile.companyType ?? L.profile.entityType)}</span></span>
                  {L.profile.tradeLicenseNumber && <span><span style={{ color: 'var(--color-neutral-400)' }}>Trade License: </span><span style={{ color: 'var(--color-neutral-800)', fontWeight: 600 }}>{L.profile.tradeLicenseNumber}</span></span>}
                </div>
              )}

              {/* Platform insights */}
              <Insights ins={L.insights} />

              {/* Breakdown — two per row, each scrolls internally */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Section title="Properties" count={L.properties.length}>
                  {L.properties.map((p) => (
                    <div key={p.id} className={ROW} style={ROW_STYLE}>
                      <Building2 size={16} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{p.buildingName}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{p.fullAddress ?? '—'}</p>
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}>{titleCase(p.spaceCategory)}</span>
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-neutral-500)' }}>{p.occupiedCount}/{p.unitCount}</span>
                    </div>
                  ))}
                </Section>

                <Section title="Units" count={L.units.length}>
                  {L.units.map((un) => (
                    <div key={un.id} className={ROW} style={ROW_STYLE}>
                      <Home size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                          {un.unitName || `Unit ${un.unitNumber}`}
                          <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · {un.propertyName}</span>
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>{titleCase(un.unitType)} · {aed(un.rentalPrice)}/yr</p>
                      </div>
                      <Pill value={un.availability} />
                    </div>
                  ))}
                </Section>

                <Section title="Customers" count={L.customers.length}>
                  {L.customers.map((c) => (
                    <Link key={c.tenantId} href={`/dashboard/admin/users/${c.userId}`} className={`${ROW} transition-colors hover:brightness-95`} style={ROW_STYLE}>
                      <UsersIcon size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>{c.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>{c.email ?? '—'}{c.phone ? ` · ${c.phone}` : ''}</p>
                      </div>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={c.hasLease ? { backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' } : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-500)' }}>{c.hasLease ? 'Tenant' : 'Lead'}</span>
                      <ChevronRight size={15} style={{ color: 'var(--color-neutral-300)' }} className="flex-shrink-0" />
                    </Link>
                  ))}
                </Section>

                <Section title="Leases" count={L.leases.length}>
                  {L.leases.map((c) => (
                    <div key={c.id} className={ROW} style={ROW_STYLE}>
                      <FileText size={15} style={{ color: 'var(--color-neutral-400)' }} className="flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                          {c.tenantName}
                          {c.unitNumber && <span className="font-normal" style={{ color: 'var(--color-neutral-400)' }}> · Unit {c.unitNumber}</span>}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>{fmtDate(c.contractStartDate)} → {fmtDate(c.contractEndDate)} · {aed(c.annualRent)}/yr</p>
                      </div>
                      <Pill value={c.status} />
                    </div>
                  ))}
                </Section>
              </div>
            </>
          ) : (
            u.role !== 'rental_provider' && (
              <p className="text-sm bg-white rounded-2xl p-4" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
                No additional breakdown for {roleLabel[u.role] ?? u.role} accounts yet.
              </p>
            )
          )}
        </>
      )}
    </DashboardPage>
  );
}
