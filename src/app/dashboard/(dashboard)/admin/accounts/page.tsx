'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Plus, Mail, Phone, Calendar, Building2, Wrench } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardPage, SectionHeader, DashboardEmpty } from '@/components/dashboard/DashboardWidgets';
import { CanAccess } from '@/components/ui/CanAccess';
import { apiGet } from '@/lib/api';

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
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AdminUser[]>('/admin/accounts')
      .then(setAccounts)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <CanAccess roles={['super_admin']} fallback={
      <DashboardPage title="Admin Accounts">
        <DashboardEmpty message="You do not have permission to view this page." />
      </DashboardPage>
    }>
      <DashboardPage
        back
        title="Admin Accounts"
        subtitle="Manage delegated admin accounts on the platform."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/admin/accounts/new-provider"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-base-100)', color: 'var(--color-neutral-700)', border: '1px solid var(--color-base-200)' }}
            >
              <Building2 size={15} />
              Register Provider
            </Link>
            <Link
              href="/dashboard/admin/accounts/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <Plus size={16} />
              New Admin
            </Link>
          </div>
        }
      >
        <SectionHeader title={`${accounts.length} admin account${accounts.length !== 1 ? 's' : ''}`} />

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

        {!loading && !error && accounts.length === 0 && (
          <DashboardEmpty message="No delegated admin accounts yet. Create the first one." />
        )}

        {!loading && !error && accounts.length > 0 && (
          <div className="space-y-3">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="bg-white rounded-2xl p-5 flex items-center gap-5"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-primary-50)' }}
                >
                  <Users size={18} style={{ color: 'var(--color-primary)' }} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm" style={{ color: 'var(--color-neutral-900)' }}>
                    {a.name}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                      <Mail size={12} /> {a.email}
                    </span>
                    {a.phone && (
                      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
                        <Phone size={12} /> {a.phone}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-400)' }}>
                      <Calendar size={12} /> {new Date(a.createdAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })}
                    </span>
                  </div>
                </div>

                <span
                  className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: a.status === 'active' ? 'var(--color-primary-50)' : '#fef9eb',
                    color: a.status === 'active' ? 'var(--color-primary)' : 'var(--color-gold)',
                  }}
                >
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </DashboardPage>
    </CanAccess>
  );
}
