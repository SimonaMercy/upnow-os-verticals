'use client';

/**
 * Admin › People › Team — oversight of invited sub-accounts. Managers and technicians
 * have no KYC, so they don't appear in Profile Verification. This page shows who has
 * been delegated to whom: managers with their landlords + exact granted permissions,
 * technicians with their provider.
 *
 * Parity with previous page (every item kept, same endpoints):
 *  - GET /api/admin/team/managers → ManagerRow[] (landlords[] with permissions map).
 *  - GET /api/admin/team/technicians → TechnicianRow[].
 *    Both fetched in parallel on mount. Previously a failure silently became an empty
 *    list; now a failure shows an error row with "Try again" (same requests).
 *  - Tabs Managers / Technicians with counts — now a kit Seg.
 *  - Manager row: initials avatar, name, email, landlord count, status pill. The old
 *    inline expand (per-landlord name, "N permissions", granted-permission pills or
 *    "No permissions granted") now lives in a Drawer opened by row click / "Open".
 *  - Technician row: name, email, provider (spName), status pill — plus an "Open"
 *    Drawer with the same fields and the created date.
 *  - Loading / empty ("No managers / technicians have been invited yet.") states.
 *  - New (from the same data): KPIs — managers, technicians, landlords covered,
 *    delegations with no permissions granted.
 *  - The old `back` header arrow is covered by the shell breadcrumb.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api';
import {
  Btn, Card, Drawer, EmptyRow, ErrorRow, Evid, KV, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, Seg,
  SkeletonRows, StatusTag, TableWrap, Thumb, fmtDate,
} from '@/components/os/kit';

interface ManagerLandlord {
  rentalProviderId: number;
  rpName: string;
  grantedCount: number;
  permissions: Record<string, boolean>;
}
interface ManagerRow {
  id: number; name: string; email: string; status: string;
  createdAt: string; lastLoginAt: string | null;
  landlordCount: number; landlords: ManagerLandlord[];
}
interface TechnicianRow {
  id: number | null; name: string; email: string | null; status: string;
  spName: string; createdAt: string;
}

function permLabel(k: string) {
  return k.replace('can', '').replace(/([A-Z])/g, ' $1').trim();
}
const grantedOf = (l: ManagerLandlord) => Object.entries(l.permissions).filter(([, v]) => v).map(([k]) => permLabel(k));

type Tab = 'managers' | 'technicians';

export default function AdminTeamPage() {
  const [tab, setTab] = useState<Tab>('managers');
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [techs, setTechs] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<{ managers: boolean; technicians: boolean }>({ managers: false, technicians: false });
  const [openManager, setOpenManager] = useState<ManagerRow | null>(null);
  const [openTech, setOpenTech] = useState<TechnicianRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const f = { managers: false, technicians: false };
    Promise.all([
      apiGet<ManagerRow[]>('/admin/team/managers').catch(() => { f.managers = true; return [] as ManagerRow[]; }),
      apiGet<TechnicianRow[]>('/admin/team/technicians').catch(() => { f.technicians = true; return [] as TechnicianRow[]; }),
    ]).then(([m, t]) => { setManagers(m); setTechs(t); setFailed(f); }).finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load(); }, [load]);

  const landlordsCovered = useMemo(
    () => new Set(managers.flatMap((m) => m.landlords.map((l) => l.rentalProviderId))).size,
    [managers],
  );
  const emptyDelegations = useMemo(
    () => managers.reduce((n, m) => n + m.landlords.filter((l) => grantedOf(l).length === 0).length, 0),
    [managers],
  );

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › People"
        title="Team"
        lede="Managers and technicians delegated by landlords and service providers. They are invited sub-accounts with no KYC of their own."
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'People' },
        { label: 'View', value: tab === 'managers' ? 'Managers' : 'Technicians' },
      ]} />

      <Kpis>
        <Kpi k="Managers" v={loading ? '…' : managers.length} d={`${managers.filter((m) => m.status === 'active').length} active`} />
        <Kpi k="Technicians" v={loading ? '…' : techs.length} d={`${techs.filter((t) => t.status === 'active').length} active`} />
        <Kpi k="Landlords covered" v={loading ? '…' : landlordsCovered} d="with at least one manager" />
        <Kpi k="No permissions granted" v={loading ? '…' : emptyDelegations} d="manager–landlord links" />
      </Kpis>

      <div style={{ marginBottom: 12 }}>
        <Seg
          label="Team type"
          value={tab}
          options={[
            { v: 'managers', l: 'Managers', n: managers.length },
            { v: 'technicians', l: 'Technicians', n: techs.length },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'managers' ? (
        <TableWrap>
          <table className="gx-tbl">
            <thead><tr><th>Manager</th><th>Landlords</th><th>Status</th><th>Last sign-in</th><th className="act">Actions</th></tr></thead>
            {loading ? <SkeletonRows rows={5} cols={5} />
              : failed.managers ? <ErrorRow cols={5} onRetry={load} />
              : managers.length === 0 ? <EmptyRow cols={5} title="No managers have been invited yet." text="Landlords invite managers from their Team page." />
              : (
                <tbody>
                  {managers.map((m) => (
                    <tr key={m.id} className="click" onClick={() => setOpenManager(m)}>
                      <td>
                        <div className="gx-cell">
                          <Thumb text={m.name} />
                          <span><span className="strong">{m.name}</span><span className="sub">{m.email}</span></span>
                        </div>
                      </td>
                      <td className="nowrap">
                        {m.landlordCount} landlord{m.landlordCount !== 1 ? 's' : ''}
                        {m.landlords.length > 0 && <span className="sub">{m.landlords.map((l) => l.rpName).join(', ')}</span>}
                      </td>
                      <td><StatusTag status={m.status} /></td>
                      <td className="nowrap">{m.lastLoginAt ? fmtDate(m.lastLoginAt) : <span style={{ color: 'var(--ms-ink-3)' }}>Never signed in</span>}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <Btn size="xs" variant="primary" onClick={() => setOpenManager(m)}>Open</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
          </table>
        </TableWrap>
      ) : (
        <TableWrap>
          <table className="gx-tbl">
            <thead><tr><th>Technician</th><th>Provider</th><th>Status</th><th>Added</th><th className="act">Actions</th></tr></thead>
            {loading ? <SkeletonRows rows={5} cols={5} />
              : failed.technicians ? <ErrorRow cols={5} onRetry={load} />
              : techs.length === 0 ? <EmptyRow cols={5} title="No technicians have been invited yet." text="Service providers invite technicians from their Team page." />
              : (
                <tbody>
                  {techs.map((t, i) => (
                    <tr key={t.id ?? `t-${i}`} className="click" onClick={() => setOpenTech(t)}>
                      <td>
                        <div className="gx-cell">
                          <Thumb text={t.name} />
                          <span><span className="strong">{t.name}</span>{t.email && <span className="sub">{t.email}</span>}</span>
                        </div>
                      </td>
                      <td>{t.spName}</td>
                      <td><StatusTag status={t.status} /></td>
                      <td className="nowrap">{fmtDate(t.createdAt)}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <Btn size="xs" variant="primary" onClick={() => setOpenTech(t)}>Open</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
          </table>
        </TableWrap>
      )}

      <Drawer
        open={!!openManager}
        onClose={() => setOpenManager(null)}
        title={openManager?.name ?? ''}
        sub={openManager?.email}
        lead={openManager ? <Thumb text={openManager.name} /> : undefined}
        footer={<Btn onClick={() => setOpenManager(null)}>Close</Btn>}
      >
        {openManager && (
          <>
            <KV items={[
              { k: 'Status', v: <StatusTag status={openManager.status} /> },
              { k: 'Landlords', v: openManager.landlordCount },
              { k: 'Invited', v: fmtDate(openManager.createdAt) },
              { k: 'Last sign-in', v: openManager.lastLoginAt ? fmtDate(openManager.lastLoginAt) : 'Never signed in' },
            ]} />
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              {openManager.landlords.length === 0 && <Evid>Not delegated to any landlord yet.</Evid>}
              {openManager.landlords.map((l) => {
                const granted = grantedOf(l);
                return (
                  <Card key={l.rentalProviderId} title={l.rpName} right={<span style={{ fontSize: 11 }}>{l.grantedCount} permission{l.grantedCount !== 1 ? 's' : ''}</span>} pad>
                    {granted.length === 0
                      ? <Evid tone="warn">No permissions granted</Evid>
                      : <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{granted.map((p) => <Pill key={p} tone="primary" dot={false}>{p}</Pill>)}</div>}
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </Drawer>

      <Drawer
        open={!!openTech}
        onClose={() => setOpenTech(null)}
        title={openTech?.name ?? ''}
        sub={openTech?.spName}
        lead={openTech ? <Thumb text={openTech.name} /> : undefined}
        footer={<Btn onClick={() => setOpenTech(null)}>Close</Btn>}
      >
        {openTech && (
          <KV items={[
            { k: 'Status', v: <StatusTag status={openTech.status} /> },
            { k: 'Email', v: openTech.email ?? '—' },
            { k: 'Service provider', v: openTech.spName },
            { k: 'Added', v: fmtDate(openTech.createdAt) },
          ]} />
        )}
      </Drawer>
    </OsPage>
  );
}
