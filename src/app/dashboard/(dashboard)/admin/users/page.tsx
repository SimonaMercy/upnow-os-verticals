'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Search, RefreshCw, ShieldCheck, UserX, UserCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPatch } from '@/lib/api';

// `banned` is retired — no button writes it any more — but it stays filterable
// and renderable so any row left on that status from before is still findable.
const STATUSES = ['', 'active', 'pending_verification', 'suspended', 'banned'];

// Role tabs — the list is always filtered to exactly one role; there is no "All"
// pour-everything-in view. Rental Providers leads because it is the role admins
// open this page for. Landing tab, and the fallback for any unknown ?role=.
const DEFAULT_ROLE = 'rental_provider';
const ROLE_TABS: { key: string; label: string }[] = [
  { key: 'rental_provider', label: 'Rental Providers' },
  { key: 'manager', label: 'Managers' },
  { key: 'service_provider', label: 'Service Providers' },
  { key: 'technician', label: 'Technicians' },
  { key: 'admin', label: 'Admins' },
  { key: 'super_admin', label: 'Super Admins' },
  { key: 'customer', label: 'Customers' },
];

// Customer engagement split — rental tenancy vs service bookings vs both.
const ENGAGEMENT_TABS: { key: string; label: string }[] = [
  { key: '', label: 'All customers' },
  { key: 'rental', label: 'Rental only' },
  { key: 'service', label: 'Service only' },
  { key: 'both', label: 'Both' },
];

interface AdminUser {
  id: number;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string;
  status: string;
  kycStatus: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  rentalActive?: boolean;
  serviceActive?: boolean;
}

const statusColor: Record<string, { bg: string; color: string }> = {
  active: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  pending_verification: { bg: '#fef9eb', color: 'var(--color-gold)' },
  suspended: { bg: '#fef2f2', color: 'var(--color-error)' },
  banned: { bg: '#fef2f2', color: 'var(--color-error)' },
};


export default function AdminUsersPage() {
  useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState(DEFAULT_ROLE);
  const [statusFilter, setStatusFilter] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const limit = 25;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (roleFilter === 'customer' && engagementFilter) params.set('engagement', engagementFilter);

      const result = await apiGet<{ data: AdminUser[]; total: number }>(`/admin/users?${params}`);
      setUsers(result.data);
      setTotal(result.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, engagementFilter, offset]);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  // Restore filters from URL on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('role'); const s = p.get('status'); const q = p.get('search'); const e = p.get('engagement');
    // Old links carrying ?role= (the retired All tab) land on the default role
    // rather than on an unfiltered list with no tab lit up.
    if (ROLE_TABS.some((t) => t.key === r)) setRoleFilter(r!);
    if (s != null) setStatusFilter(s);
    if (q != null) setSearch(q);
    if (e != null) setEngagementFilter(e);
  }, []);

  // Sync role and engagement tabs to URL on change (replaceState for no history spam)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (roleFilter) url.searchParams.set('role', roleFilter);
    else url.searchParams.delete('role');
    if (roleFilter === 'customer' && engagementFilter) url.searchParams.set('engagement', engagementFilter);
    else url.searchParams.delete('engagement');
    window.history.replaceState(null, '', url.toString());
  }, [roleFilter, engagementFilter]);

  // Suspend is the only lock-out. Ban used to sit beside it but set a status the
  // auth service never checked, so it blocked nothing — it is gone rather than
  // fixed, since a working Ban would have been Suspend under another name.
  async function updateStatus(userId: number, status: string) {
    setActionLoading(userId);
    try {
      await apiPatch(`/admin/users/${userId}/status`, { status });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  // One role is always in force, so the count is that role's — never a platform total.
  const activeRoleLabel = ROLE_TABS.find((t) => t.key === roleFilter)?.label ?? 'users';

  return (
    <DashboardPage
      back
      title="User Management"
      subtitle={`${total} ${activeRoleLabel.toLowerCase()}`}
    >
      {/* Role tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ROLE_TABS.map((t) => {
          const active = roleFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => { setRoleFilter(t.key); setEngagementFilter(''); setOffset(0); }}
              className="px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors"
              style={
                active
                  ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                  : { backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Customer engagement split — only for the Customers tab */}
      {roleFilter === 'customer' && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: 'var(--color-neutral-400)' }}>
            Active in
          </span>
          {ENGAGEMENT_TABS.map((t) => {
            const active = engagementFilter === t.key;
            return (
              <button
                key={t.key || 'all'}
                onClick={() => { setEngagementFilter(t.key); setOffset(0); }}
                className="px-3 py-1 rounded-full text-xs font-medium transition-colors border"
                style={active
                  ? { backgroundColor: 'var(--color-neutral-800)', color: '#fff', borderColor: 'var(--color-neutral-800)' }
                  : { backgroundColor: '#fff', color: 'var(--color-neutral-600)', borderColor: 'var(--color-base-200)' }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div
          className="flex items-center gap-2 flex-1 min-w-[220px] px-3.5 py-2.5 rounded-xl bg-white text-sm"
          style={{ boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-base-200)' }}
        >
          <Search size={15} style={{ color: 'var(--color-neutral-400)' }} />
          <input
            type="text"
            placeholder="Search by name, email or phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="flex-1 outline-none bg-transparent text-sm"
            style={{ color: 'var(--color-neutral-900)' }}
          />
        </div>

        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
            className="appearance-none pl-3.5 pr-8 py-2.5 rounded-xl bg-white text-sm outline-none"
            style={{ boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-base-200)', color: 'var(--color-neutral-700)' }}
          >
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-neutral-400)' }} />
        </div>

        <button
          onClick={() => void fetchUsers()}
          className="p-2.5 rounded-xl bg-white transition-colors hover:bg-base-100"
          style={{ boxShadow: 'var(--shadow-sm)', border: '1px solid var(--color-base-200)' }}
          title="Refresh"
        >
          <RefreshCw size={15} style={{ color: 'var(--color-neutral-500)' }} />
        </button>
      </div>

      {/* Table */}
      {loading && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-neutral-400)', boxShadow: 'var(--shadow-sm)' }}>
          Loading…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl p-8 bg-white text-center text-sm" style={{ color: 'var(--color-error)', boxShadow: 'var(--shadow-sm)' }}>
          {error}
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <DashboardEmpty message="No users match the current filters." />
      )}

      {!loading && !error && users.length > 0 && (
        <>
          <SectionHeader title={`Showing ${offset + 1}–${Math.min(offset + users.length, total)} of ${total}`} />

          <div className="bg-white rounded-2xl overflow-hidden mb-6" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-base-100)' }}>
                    {['Details', 'Status', 'Last active', 'Action'].map((h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] whitespace-nowrap ${i === 3 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--color-neutral-500)' }}
                      >
                        {h}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const sc = statusColor[u.status] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' };
                    return (
                      <tr
                        key={u.id}
                        onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}
                        className="cursor-pointer transition-colors hover:bg-[var(--color-base-100)]"
                        style={{ borderTop: '1px solid var(--color-base-200)' }}
                      >
                        {/* Details — identity, and the badges that qualify it */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: 'var(--color-base-100)' }}
                            >
                              <Users size={16} style={{ color: 'var(--color-neutral-500)' }} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{u.name}</p>
                              <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                                {u.email}{u.phone ? ` · ${u.phone}` : ''}
                              </p>
                            </div>
                            {/* Engagement badges (customers only) */}
                            {u.role === 'customer' && u.rentalActive && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: '#eff6ff', color: '#3b82f6' }}>Rental</span>
                            )}
                            {u.role === 'customer' && u.serviceActive && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: '#ecfeff', color: '#0891b2' }}>Service</span>
                            )}
                          </div>
                        </td>

                        {/* Status — account state, plus KYC only when it needs a decision */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
                              style={{ backgroundColor: sc.bg, color: sc.color }}>
                              {u.status.replace('_', ' ')}
                            </span>
                            {u.kycStatus === 'pending_review' && (
                              <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
                                style={{ backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}>
                                <ShieldCheck size={11} /> KYC Pending
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Last active — last sign-in, not sign-up */}
                        <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                          {u.lastLoginAt
                            ? new Date(u.lastLoginAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })
                            : <span style={{ color: 'var(--color-neutral-300)' }}>Never signed in</span>}
                        </td>

                        {/* Action — super admins are never suspendable */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {u.status !== 'suspended' && u.role !== 'super_admin' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); void updateStatus(u.id, 'suspended'); }}
                                disabled={actionLoading === u.id}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                style={{
                                  backgroundColor: '#fef2f2',
                                  color: 'var(--color-error)',
                                  opacity: actionLoading === u.id ? 0.5 : 1,
                                }}
                                title="Block this user from signing in"
                              >
                                <UserX size={12} /> Suspend
                              </button>
                            )}
                            {(u.status === 'suspended' || u.status === 'banned') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); void updateStatus(u.id, 'active'); }}
                                disabled={actionLoading === u.id}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                style={{
                                  backgroundColor: 'var(--color-primary-50)',
                                  color: 'var(--color-primary)',
                                  opacity: actionLoading === u.id ? 0.5 : 1,
                                }}
                              >
                                <UserCheck size={12} /> Reactivate
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="pr-3">
                          <ChevronRight size={16} style={{ color: 'var(--color-neutral-300)' }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-700)' }}
              >
                Previous
              </button>
              <span className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-700)' }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </DashboardPage>
  );
}
