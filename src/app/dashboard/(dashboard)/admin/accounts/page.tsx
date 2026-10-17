'use client';

/**
 * Admin › People › Admin accounts — delegated admin accounts (super_admin only).
 *
 * Parity with previous page (every item kept, same endpoint):
 *  - Permission check: <CanAccess roles={['super_admin']}> with the "You do not have
 *    permission to view this page." fallback.
 *  - GET /api/admin/accounts → AdminUser[].
 *  - Header actions: "Register Provider" → /dashboard/admin/accounts/new-provider,
 *    "New Admin" → /dashboard/admin/accounts/new.
 *  - "N admin account(s)" count; each row: name, email, phone (if any), created date,
 *    status pill — now a kit table. New: labelled "Open" → read-only Drawer with the
 *    same fields (the list endpoint is the only admin-account data; no edit endpoint).
 *  - Loading / error (message, now with "Try again") / empty ("No delegated admin
 *    accounts yet. Create the first one.") states.
 *  - New (from the same data): KPIs — total, active, not active.
 */

import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { CanAccess } from '@/components/ui/CanAccess';
import { apiGet } from '@/lib/api';
import {
  Btn, Callout, Drawer, EmptyRow, ErrorRow, KV, Kpi, Kpis, OsPage, PageHead, ScopeStrip, SearchField,
  SkeletonRows, StatusTag, TableWrap, Thumb, fmtDate,
} from '@/components/os/kit';

interface AdminUser {
  id: number;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export default function AdminAccountsPage() {
  useAuth();
  const [accounts, setAccounts] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<AdminUser[]>('/admin/accounts')
      .then(setAccounts)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load(); }, [load]);

  const s = q.trim().toLowerCase();
  const rows = s
    ? accounts.filter((a) => [a.name, a.email, a.phone ?? ''].some((x) => x.toLowerCase().includes(s)))
    : accounts;
  const active = accounts.filter((a) => a.status === 'active').length;

  return (
    <CanAccess roles={['super_admin']} fallback={
      <OsPage>
        <PageHead eyebrow="Admin › People" title="Admin accounts" />
        <Callout tone="warn">You do not have permission to view this page.</Callout>
      </OsPage>
    }>
      <OsPage>
        <PageHead
          eyebrow="Admin › People"
          title="Admin accounts"
          lede="Manage delegated admin accounts on the platform, or register a provider on a partner's behalf."
          actions={
            <>
              <Btn href="/dashboard/admin/accounts/new-provider"><Building2 size={13} aria-hidden /> Register Provider</Btn>
              <Btn variant="primary" href="/dashboard/admin/accounts/new"><Plus size={13} aria-hidden /> New Admin</Btn>
            </>
          }
        />
        <ScopeStrip items={[
          { label: 'Workspace', value: 'People' },
          { label: 'Access', value: 'Super admin only' },
          { label: 'Accounts', value: loading ? '…' : `${accounts.length} admin account${accounts.length !== 1 ? 's' : ''}` },
        ]} />

        <Kpis>
          <Kpi k="Admin accounts" v={loading ? '…' : accounts.length} />
          <Kpi k="Active" v={loading ? '…' : active} />
          <Kpi k="Not active" v={loading ? '…' : accounts.length - active} d="pending or suspended" />
        </Kpis>

        <TableWrap toolbar={<SearchField value={q} onChange={setQ} placeholder="Search name, email or phone" />}>
          <table className="gx-tbl">
            <thead><tr><th>Admin</th><th>Phone</th><th>Created</th><th>Status</th><th className="act">Actions</th></tr></thead>
            {loading ? <SkeletonRows rows={4} cols={5} />
              : error ? (
                <>
                  <tbody><tr><td colSpan={5}><Callout tone="bad">{error}</Callout></td></tr></tbody>
                  <ErrorRow cols={5} onRetry={load} />
                </>
              )
              : rows.length === 0 ? (
                accounts.length === 0
                  ? <EmptyRow cols={5} title="No delegated admin accounts yet." text="Create the first one with New Admin." />
                  : <EmptyRow cols={5} title="No accounts match" text="Clear the search to see every account." />
              )
              : (
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="click" onClick={() => setOpen(a)}>
                      <td>
                        <div className="gx-cell">
                          <Thumb text={a.name} />
                          <span><span className="strong">{a.name}</span><span className="sub">{a.email}</span></span>
                        </div>
                      </td>
                      <td className="nowrap">{a.phone ?? '—'}</td>
                      <td className="nowrap">{fmtDate(a.createdAt)}</td>
                      <td><StatusTag status={a.status} /></td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <Btn size="xs" variant="primary" onClick={() => setOpen(a)}>Open</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
          </table>
        </TableWrap>

        <Drawer
          open={!!open}
          onClose={() => setOpen(null)}
          title={open?.name ?? ''}
          sub={open?.email}
          lead={open ? <Thumb text={open.name} /> : undefined}
          footer={<Btn onClick={() => setOpen(null)}>Close</Btn>}
        >
          {open && (
            <KV items={[
              { k: 'Status', v: <StatusTag status={open.status} /> },
              { k: 'Email', v: open.email },
              { k: 'Phone', v: open.phone ?? '—' },
              { k: 'First name', v: open.firstName ?? '—' },
              { k: 'Last name', v: open.lastName ?? '—' },
              { k: 'Created', v: fmtDate(open.createdAt) },
            ]} />
          )}
        </Drawer>
      </OsPage>
    </CanAccess>
  );
}
