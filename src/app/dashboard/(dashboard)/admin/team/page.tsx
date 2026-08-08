'use client';

/**
 * Admin — Team oversight. Managers and technicians are invited sub-accounts
 * with no KYC, so they don't appear in Profile Verification. This page is where an
 * admin sees who's been delegated to whom: managers grouped with their
 * landlords + exact granted permissions, and technicians with their provider.
 */

import { useEffect, useState } from 'react';
import { Users, Building2, Wrench, ChevronDown, Loader2, Mail } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { DashboardPage, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';

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
const statusStyle = (s: string) =>
  s === 'active'
    ? { bg: 'var(--color-primary-light)', fg: 'var(--color-primary-dark)' }
    : s === 'suspended' || s === 'deactivated'
      ? { bg: '#fef2f2', fg: 'var(--color-error)' }
      : { bg: '#fef9eb', fg: '#92400e' };

export default function AdminTeamPage() {
  const [tab, setTab] = useState<'managers' | 'technicians'>('managers');
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [techs, setTechs] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<ManagerRow[]>('/admin/team/managers').catch(() => []),
      apiGet<TechnicianRow[]>('/admin/team/technicians').catch(() => []),
    ]).then(([m, t]) => { setManagers(m); setTechs(t); }).finally(() => setLoading(false));
  }, []);

  const chip = (active: boolean) =>
    active
      ? { backgroundColor: 'var(--color-neutral-900)', color: 'white' }
      : { backgroundColor: 'white', color: 'var(--color-neutral-600)', border: '1px solid var(--color-base-200)' };

  return (
    <DashboardPage
      back
      title="Team"
      subtitle="Managers and technicians delegated by landlords and service providers"
      actions={
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setTab('managers')}
            className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors" style={chip(tab === 'managers')}>
            <Building2 size={12} /> Managers
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: tab === 'managers' ? 'rgba(255,255,255,.2)' : 'var(--color-base-100)' }}>{managers.length}</span>
          </button>
          <button type="button" onClick={() => setTab('technicians')}
            className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors" style={chip(tab === 'technicians')}>
            <Wrench size={12} /> Technicians
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: tab === 'technicians' ? 'rgba(255,255,255,.2)' : 'var(--color-base-100)' }}>{techs.length}</span>
          </button>
        </div>
      }
    >
      {loading ? (
        <DashboardEmpty message="Loading team…" />
      ) : tab === 'managers' ? (
        managers.length === 0 ? (
          <DashboardEmpty message="No managers have been invited yet." />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {managers.map(m => {
              const open = expanded === m.id;
              const ss = statusStyle(m.status);
              return (
                <div key={m.id} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setExpanded(open ? null : m.id)}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ backgroundColor: 'var(--color-primary)' }}>
                      {m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{m.name}</p>
                      <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>
                        <Mail size={10} /> {m.email}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                        {m.landlordCount} landlord{m.landlordCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="text-[10px] font-medium rounded-full px-2 py-0.5 capitalize" style={{ backgroundColor: ss.bg, color: ss.fg }}>{m.status}</span>
                    <ChevronDown size={16} style={{ color: 'var(--color-neutral-400)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                  </div>

                  {open && (
                    <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--color-base-100)' }}>
                      {m.landlords.map(l => {
                        const granted = Object.entries(l.permissions).filter(([, v]) => v).map(([k]) => permLabel(k));
                        return (
                          <div key={l.rentalProviderId} className="mt-3 rounded-xl p-3" style={{ backgroundColor: 'var(--color-base-100)' }}>
                            <div className="flex items-center gap-2 mb-2">
                              <Building2 size={13} style={{ color: 'var(--color-primary)' }} />
                              <span className="text-sm font-medium" style={{ color: 'var(--color-neutral-900)' }}>{l.rpName}</span>
                              <span className="text-[10px] ml-auto" style={{ color: 'var(--color-neutral-400)' }}>{l.grantedCount} permission{l.grantedCount !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {granted.length === 0 ? (
                                <span className="text-[11px]" style={{ color: 'var(--color-gold)' }}>No permissions granted</span>
                              ) : granted.map(p => (
                                <span key={p} className="text-[10px] rounded-full px-2 py-0.5" style={{ backgroundColor: 'white', color: 'var(--color-primary-dark)', border: '1px solid var(--color-primary-light)' }}>{p}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        techs.length === 0 ? (
          <DashboardEmpty message="No technicians have been invited yet." />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {techs.map((t, i) => {
              const ss = statusStyle(t.status);
              return (
                <div key={t.id ?? i} className="bg-white rounded-2xl flex items-center gap-4 p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-base-100)' }}>
                    <Wrench size={16} style={{ color: 'var(--color-neutral-500)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>{t.name}</p>
                    {t.email && <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--color-neutral-400)' }}><Mail size={10} /> {t.email}</p>}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>{t.spName}</span>
                  <span className="text-[10px] font-medium rounded-full px-2 py-0.5 capitalize" style={{ backgroundColor: ss.bg, color: ss.fg }}>{t.status}</span>
                </div>
              );
            })}
          </div>
        )
      )}
    </DashboardPage>
  );
}
