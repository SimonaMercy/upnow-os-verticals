'use client';

import { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LucideIcon, ArrowLeft } from 'lucide-react';

/* ── Back link (returns to the previous page) ── */
export function BackLink({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={cn('inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 mb-4', className)}
    >
      <ArrowLeft size={16} /> Back
    </button>
  );
}

/* ── StatCard ── */
export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  color = 'primary',
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color?: 'primary' | 'gold' | 'error' | 'neutral';
}) {
  const colorMap = {
    primary: { bg: 'var(--color-primary-50)', icon: 'var(--color-primary)' },
    gold:    { bg: '#fef9eb',                  icon: 'var(--color-gold)' },
    error:   { bg: '#fef2f2',                  icon: 'var(--color-error)' },
    neutral: { bg: 'var(--color-base-100)',    icon: 'var(--color-neutral-500)' },
  }[color];

  return (
    <div
      className="rounded-2xl p-5 bg-white"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>{label}</p>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--color-neutral-900)' }}>{value}</p>
          {trend && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>{trend}</p>
          )}
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: colorMap.bg }}>
          <Icon size={20} style={{ color: colorMap.icon }} />
        </div>
      </div>
    </div>
  );
}

/* ── Page chrome ── */
export function DashboardPage({
  title,
  subtitle,
  actions,
  children,
  back,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Show a "Back" link above the title (returns to the previous page). */
  back?: boolean;
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {back && <BackLink />}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-neutral-900)' }}>{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm" style={{ color: 'var(--color-neutral-500)' }}>{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex-shrink-0 flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Quick action card ── */
export function QuickAction({
  label,
  href,
  icon: Icon,
  description,
}: {
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-4 p-4 bg-white rounded-2xl hover:shadow-md transition-shadow group"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
        style={{ backgroundColor: 'var(--color-primary-50)' }}
      >
        <Icon size={18} style={{ color: 'var(--color-primary)' }} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>{label}</p>
        {description && (
          <p className="text-xs truncate" style={{ color: 'var(--color-neutral-400)' }}>{description}</p>
        )}
      </div>
    </a>
  );
}

/* ── Section header ── */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-semibold text-base" style={{ color: 'var(--color-neutral-900)' }}>{title}</h2>
      {action}
    </div>
  );
}

/* ── Empty placeholder ── */
export function DashboardEmpty({ message }: { message: string }) {
  return (
    <div
      className="rounded-2xl p-10 flex flex-col items-center justify-center text-center bg-white"
      style={{ boxShadow: 'var(--shadow-sm)', minHeight: 160 }}
    >
      <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>{message}</p>
    </div>
  );
}
