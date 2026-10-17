'use client';

/**
 * Admin › People › Users — Genspark OS rebuild of User Management.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /api/admin/users?limit=25&offset=N[&search][&role][&status][&engagement]
 *    → { data: AdminUser[]; total }. `engagement` is only sent on the Customers tab.
 *  - PATCH /api/admin/users/:id/status { status: 'suspended' | 'active' } — row actions
 *    Suspend (never for super_admin, never when already suspended) and Reactivate
 *    (suspended or legacy banned). Row status updates in place on success; a failure
 *    is shown (was alert(), now an inline danger Callout).
 *  - Role tabs (always exactly one role; default rental_provider; unknown ?role= falls
 *    back to the default) — now a kit Seg. Switching role resets engagement + page.
 *  - Customers-only engagement filter (All / Rental only / Service only / Both) — kit chips.
 *  - Search (name, email, phone) and status filter (active / pending verification /
 *    suspended / banned — banned is retired but stays filterable), both reset the page.
 *  - Filters restored from ?role / ?status / ?search / ?engagement on mount; role +
 *    engagement synced back to the URL with history.replaceState.
 *  - Refresh button; "Showing X–Y of N" + Previous / Next pagination with page count.
 *  - Row click → /dashboard/admin/users/:id (detail route, unchanged); now also a
 *    labelled "Open" button.
 *  - Customer rows show Rental / Service engagement pills; KYC Pending pill when
 *    kycStatus = pending_review; Last active = lastLoginAt or "Never signed in".
 *  - Loading / error (message + retry) / empty states.
 *  - New: "Gate 1" column on the Rental Providers / Service Providers tabs, from the
 *    kycStatus the list already returns (no extra request). No Gate 2 here.
 *    Badge copy names the check: "KYC docs verified" — never a bare "Verified". The list
 *    returns no decision date, so the pill says "date not in list" (decision dates live on
 *    the KYC record's document rows).
 *  - The old `back` header arrow is covered by the shell breadcrumb.
 *  - No manager/other route re-exports this page.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, apiPatch } from '@/lib/api';
import {
  Btn, Callout, EmptyRow, ErrorRow, OsPage, PageHead, Pill, ScopeStrip, SearchField, Seg, SkeletonRows,
  StatusTag, TableWrap, Thumb, fmtDate,
} from '@/components/os/kit';

// `banned` is retired — no button writes it any more — but it stays filterable
// and renderable so any row left on that status from before is still findable.
const STATUSES = ['active', 'pending_verification', 'suspended', 'banned'];

// Role tabs — the list is always filtered to exactly one role; there is no "All" view.
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
const PROVIDER_ROLES = new Set(['rental_provider', 'service_provider']);

// Customer engagement split — rental tenancy vs service bookings vs both.
const ENGAGEMENT_TABS: { key: string; label: string }[] = [
  { key: '', label: 'All customers' },
  { key: 'rental', label: 'Rental only' },
  { key: 'service', label: 'Service only' },
  { key: 'both', label: 'Both' },
];

const KYC_LABEL: Record<string, string> = {
  verified: 'Verified', pending_review: 'Pending review', unverified: 'Not started', rejected: 'Rejected',
};

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

const LIMIT = 25;

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
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch whenever the filters change
  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  // Restore filters from URL on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('role'); const s = p.get('status'); const q = p.get('search'); const e = p.get('engagement');
    // Old links carrying ?role= (the retired All tab) land on the default role.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot URL filter restore after hydration
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

  // Suspend is the only lock-out (Ban set a status the auth service never checked).
  async function updateStatus(userId: number, status: string) {
    setActionLoading(userId);
    setActionError(null);
    try {
      await apiPatch(`/admin/users/${userId}/status`, { status });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, status } : u)));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const activeRoleLabel = ROLE_TABS.find((t) => t.key === roleFilter)?.label ?? 'users';
  const isProviderTab = PROVIDER_ROLES.has(roleFilter);
  const cols = isProviderTab ? 5 : 4;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › People"
        title="Users"
        lede="Every account on the platform, one role at a time. Open a user for their full record; suspend blocks sign-in."
        actions={<Btn onClick={() => void fetchUsers()} disabled={loading}><RefreshCw size={13} aria-hidden /> Refresh</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'People' },
        { label: 'Role', value: activeRoleLabel },
        { label: 'Matching', value: loading ? '…' : total },
        ...(statusFilter ? [{ label: 'Status', value: statusFilter.replace(/_/g, ' ') }] : []),
      ]} />

      <div style={{ marginBottom: 12, overflowX: 'auto' }}>
        <Seg
          label="Role"
          value={roleFilter}
          options={ROLE_TABS.map((t) => ({ v: t.key, l: t.label, n: t.key === roleFilter && !loading ? total : undefined }))}
          onChange={(v) => { setRoleFilter(v); setEngagementFilter(''); setOffset(0); }}
        />
      </div>

      {actionError && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="bad" title="Status change failed.">{actionError}</Callout>
        </div>
      )}

      {isProviderTab && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="info" title="Gate 1 is business verification.">
            The column shows the account&apos;s KYC status from this list. Decisions are made in the <Link href="/dashboard/admin/kyc" style={{ fontWeight: 700, textDecoration: 'underline' }}>Profile Verification queue</Link>.
          </Callout>
        </div>
      )}

      <TableWrap toolbar={
        <>
          <SearchField value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Search by name, email or phone…" />
          <select
            className="gx-sel"
            style={{ width: 'auto', height: 30 }}
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          {roleFilter === 'customer' && (
            <div className="gx-chips" role="group" aria-label="Active in">
              {ENGAGEMENT_TABS.map((t) => (
                <button
                  key={t.key || 'all'}
                  type="button"
                  className="gx-chip"
                  aria-pressed={engagementFilter === t.key}
                  onClick={() => { setEngagementFilter(t.key); setOffset(0); }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <span className="sp" />
          {!loading && !error && users.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>
              Showing {offset + 1}–{Math.min(offset + users.length, total)} of {total}
            </span>
          )}
        </>
      }>
        <table className="gx-tbl">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              {isProviderTab && <th>Gate 1</th>}
              <th>Last active</th>
              <th className="act">Actions</th>
            </tr>
          </thead>
          {loading ? (
            <SkeletonRows rows={8} cols={cols} />
          ) : error ? (
            <>
              <tbody><tr><td colSpan={cols}><Callout tone="bad">{error}</Callout></td></tr></tbody>
              <ErrorRow cols={cols} onRetry={() => void fetchUsers()} />
            </>
          ) : users.length === 0 ? (
            <EmptyRow cols={cols} title="No users match the current filters." text="Clear the search or status filter, or pick another role." />
          ) : (
            <tbody>
              {users.map((u) => {
                const busy = actionLoading === u.id;
                return (
                  <tr key={u.id} className="click" onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}>
                    <td>
                      <div className="gx-cell">
                        <Thumb text={u.name} />
                        <span>
                          <span className="strong">{u.name}</span>
                          <span className="sub">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span>
                        </span>
                        {u.role === 'customer' && u.rentalActive && <Pill tone="info" dot={false}>Rental</Pill>}
                        {u.role === 'customer' && u.serviceActive && <Pill tone="outline" dot={false}>Service</Pill>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <StatusTag status={u.status} />
                        {u.kycStatus === 'pending_review' && <Pill tone="amber">KYC Pending</Pill>}
                      </div>
                    </td>
                    {isProviderTab && (
                      <td>
                        {u.kycStatus === 'verified'
                          ? <Pill tone="primary" title="Identity / KYC documents verified by an admin. The users list returns no decision date — open the record for document verification dates.">KYC docs verified · date not in list</Pill>
                          : <StatusTag status={u.kycStatus} label={KYC_LABEL[u.kycStatus] ?? undefined} />}
                      </td>
                    )}
                    <td className="nowrap">
                      {u.lastLoginAt ? fmtDate(u.lastLoginAt) : <span style={{ color: 'var(--ms-ink-3)' }}>Never signed in</span>}
                    </td>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      <div className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                        {u.status !== 'suspended' && u.role !== 'super_admin' && (
                          <Btn size="xs" variant="danger" disabled={busy} title="Block this user from signing in"
                            onClick={() => void updateStatus(u.id, 'suspended')}>
                            Suspend
                          </Btn>
                        )}
                        {(u.status === 'suspended' || u.status === 'banned') && (
                          <Btn size="xs" disabled={busy} onClick={() => void updateStatus(u.id, 'active')}>Reactivate</Btn>
                        )}
                        <Btn size="xs" variant="primary" href={`/dashboard/admin/users/${u.id}`}>Open</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </TableWrap>

      {!loading && !error && totalPages > 1 && (
        <div className="gx-btn-row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <Btn size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Btn>
          <span style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>Page {currentPage} of {totalPages}</span>
          <Btn size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Next</Btn>
        </div>
      )}
    </OsPage>
  );
}
