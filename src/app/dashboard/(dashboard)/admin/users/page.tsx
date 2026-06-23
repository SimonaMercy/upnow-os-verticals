'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Search, RefreshCw, ShieldCheck, UserX, UserCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPatch } from '@/lib/api';

const STATUSES = ['', 'active', 'pending_verification', 'suspended', 'banned'];

// Role tabs — split the user list by role (the user-facing term for
// `rental_provider` is "Landlords").
const ROLE_TABS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'rental_provider', label: 'Rental Providers' },
  { key: 'manager', label: 'Managers' },
  { key: 'service_provider', label: 'Service Providers' },
  { key: 'technician', label: 'Technicians' },
  { key: 'admin', label: 'Admins' },
  { key: 'super_admin', label: 'Super Admins' },
  { key: 'customer', label: 'Customers' },
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
}

const statusColor: Record<string, { bg: string; color: string }> = {
  active: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)' },
  pending_verification: { bg: '#fef9eb', color: 'var(--color-gold)' },
  suspended: { bg: '#fef2f2', color: 'var(--color-error)' },
  banned: { bg: '#fef2f2', color: 'var(--color-error)' },
};

const roleLabel: Record<string, string> = {
  customer: 'Customer',
  rental_provider: 'Rental Provider',
  service_provider: 'Service Provider',
  technician: 'Technician',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

export default function AdminUsersPage() {
  useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
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

      const result = await apiGet<{ data: AdminUser[]; total: number }>(`/admin/users?${params}`);
      setUsers(result.data);
      setTotal(result.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, offset]);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  // Deep-link support: seed filters from the URL query (?role=&status=&search=) on
  // mount, so Overview drill-downs can land here pre-filtered.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('role'); const s = p.get('status'); const q = p.get('search');
    if (r != null) setRoleFilter(r);
    if (s != null) setStatusFilter(s);
    if (q != null) setSearch(q);
  }, []);

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

  return (
    <DashboardPage
      title="User Management"
      subtitle={`${total} users on the platform`}
    >
      {/* Role tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ROLE_TABS.map((t) => {
          const active = roleFilter === t.key;
          return (
            <button
              key={t.key || 'all'}
              onClick={() => { setRoleFilter(t.key); setOffset(0); }}
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

          <div className="space-y-2 mb-6">
            {users.map((u) => {
              const sc = statusColor[u.status] ?? { bg: 'var(--color-base-100)', color: 'var(--color-neutral-600)' };
              return (
                <div
                  key={u.id}
                  onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}
                  className="bg-white rounded-2xl p-4 flex flex-wrap items-center gap-4 cursor-pointer transition-shadow hover:shadow-md"
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  {/* Icon */}
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-base-100)' }}
                  >
                    <Users size={16} style={{ color: 'var(--color-neutral-500)' }} />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-neutral-900)' }}>
                      {u.name}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-neutral-500)' }}>
                      {u.email}
                      {u.phone ? ` · ${u.phone}` : ''}
                    </p>
                  </div>

                  {/* Role */}
                  <span
                    className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-600)' }}
                  >
                    {roleLabel[u.role] ?? u.role}
                  </span>

                  {/* Status */}
                  <span
                    className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: sc.bg, color: sc.color }}
                  >
                    {u.status.replace('_', ' ')}
                  </span>

                  {/* KYC */}
                  {u.kycStatus === 'pending_review' && (
                    <span
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{ backgroundColor: '#fef9eb', color: 'var(--color-gold)' }}
                    >
                      <ShieldCheck size={11} /> KYC Pending
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {u.status !== 'suspended' && u.role !== 'super_admin' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); void updateStatus(u.id, 'suspended'); }}
                        disabled={actionLoading === u.id}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{
                          backgroundColor: '#fef2f2',
                          color: 'var(--color-error)',
                          opacity: actionLoading === u.id ? 0.5 : 1,
                        }}
                      >
                        <UserX size={12} />
                        Suspend
                      </button>
                    )}
                    {u.status === 'suspended' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); void updateStatus(u.id, 'active'); }}
                        disabled={actionLoading === u.id}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{
                          backgroundColor: 'var(--color-primary-50)',
                          color: 'var(--color-primary)',
                          opacity: actionLoading === u.id ? 0.5 : 1,
                        }}
                      >
                        <UserCheck size={12} />
                        Reactivate
                      </button>
                    )}
                  </div>

                  {/* Date */}
                  <span className="text-xs ml-auto flex-shrink-0" style={{ color: 'var(--color-neutral-400)' }}>
                    {new Date(u.createdAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })}
                  </span>
                  <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--color-neutral-300)' }} />
                </div>
              );
            })}
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
