'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserPlus, Building2, Wrench } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { apiPost } from '@/lib/api';

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z
  .object({
    role: z.enum(['rental_provider', 'service_provider']),
    email: z.string().email('Enter a valid email address'),
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{6,14}$/, 'Enter a valid phone number e.g. +971501234567')
      .optional()
      .or(z.literal('')),
    entityType: z.enum(['individual', 'company']),
    companyName: z.string().max(255).optional().or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    if (data.entityType === 'company' && !data.companyName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Company name is required for company accounts',
        path: ['companyName'],
      });
    }
  });

type FormValues = z.infer<typeof schema>;

// ─── Field helper ─────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-neutral-700)' }}>
        {label} {required && <span style={{ color: 'var(--color-error)' }}>*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors';
const inputStyle = (hasErr: boolean) => ({
  borderColor: hasErr ? 'var(--color-error)' : 'var(--color-base-200)',
  color: 'var(--color-neutral-900)',
});

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewProviderAccountPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'rental_provider', entityType: 'individual' },
  });

  const role = watch('role');
  const entityType = watch('entityType');

  async function onSubmit(data: FormValues) {
    setServerError(null);
    try {
      await apiPost('/admin/accounts/provider', {
        ...data,
        phone: data.phone || undefined,
        companyName: data.companyName || undefined,
      });
      setSuccess(true);
      setTimeout(() => router.push('/dashboard/admin/kyc'), 1800);
    } catch (err) {
      setServerError((err as Error).message);
    }
  }

  return (
    <DashboardPage
      title="Register Provider"
      subtitle="Create a pre-activated Rental Provider or Service Provider account on behalf of a partner."
      actions={
        <Link
          href="/dashboard/admin/accounts"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ color: 'var(--color-neutral-600)', backgroundColor: 'var(--color-base-100)' }}
        >
          <ArrowLeft size={14} /> Back
        </Link>
      }
    >
      <div className="max-w-lg">
        {success && (
          <div className="rounded-xl p-4 mb-6 text-sm font-medium"
            style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}>
            Account created successfully. Redirecting to KYC queue…
          </div>
        )}
        {serverError && (
          <div className="rounded-xl p-4 mb-6 text-sm font-medium"
            style={{ backgroundColor: '#fef2f2', color: 'var(--color-error)' }}>
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

          {/* Role selector */}
          <div>
            <p className="block text-sm font-medium mb-2" style={{ color: 'var(--color-neutral-700)' }}>
              Provider type <span style={{ color: 'var(--color-error)' }}>*</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { value: 'rental_provider', label: 'Rental Provider', Icon: Building2, desc: 'Landlords, agencies, brokers' },
                { value: 'service_provider', label: 'Service Provider', Icon: Wrench, desc: 'Maintenance, cleaning, etc.' },
              ] as const).map(({ value, label, Icon, desc }) => {
                const active = role === value;
                return (
                  <label key={value}
                    className="flex flex-col gap-1.5 p-4 rounded-xl border-2 cursor-pointer transition-colors"
                    style={{
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-base-200)',
                      backgroundColor: active ? 'var(--color-primary-50)' : '#fff',
                    }}>
                    <input type="radio" value={value} {...register('role')} className="sr-only" />
                    <div className="flex items-center gap-2">
                      <Icon size={15} style={{ color: active ? 'var(--color-primary)' : 'var(--color-neutral-500)' }} />
                      <span className="text-sm font-medium" style={{ color: active ? 'var(--color-primary)' : 'var(--color-neutral-800)' }}>
                        {label}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>{desc}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Account info */}
          <div className="bg-white rounded-2xl p-5 space-y-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-neutral-400)' }}>Account Info</p>

            <Field label="Email address" required error={errors.email?.message}>
              <input id="email" type="email" autoComplete="off" {...register('email')}
                className={inputCls} style={inputStyle(!!errors.email)} placeholder="provider@company.ae" />
            </Field>

            <Field label="Full name" required error={errors.name?.message}>
              <input id="name" type="text" autoComplete="off" {...register('name')}
                className={inputCls} style={inputStyle(!!errors.name)} placeholder="Ahmad Al Mansouri" />
            </Field>

            <Field label="Phone number" error={errors.phone?.message}>
              <input id="phone" type="tel" autoComplete="tel" {...register('phone')}
                className={inputCls} style={inputStyle(!!errors.phone)} placeholder="+971501234567 (optional)" />
            </Field>
          </div>

          {/* Entity type */}
          <div className="bg-white rounded-2xl p-5 space-y-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-neutral-400)' }}>Entity Type</p>

            <div className="grid grid-cols-2 gap-3">
              {([
                { value: 'individual', label: 'Individual', desc: 'Natural person / sole owner' },
                { value: 'company',    label: 'Company',    desc: 'LLC, PJSC, brokerage, etc.' },
              ] as const).map(({ value, label, desc }) => {
                const active = entityType === value;
                return (
                  <label key={value}
                    className="flex flex-col gap-1 p-3.5 rounded-xl border-2 cursor-pointer transition-colors"
                    style={{
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-base-200)',
                      backgroundColor: active ? 'var(--color-primary-50)' : '#fff',
                    }}>
                    <input type="radio" value={value} {...register('entityType')} className="sr-only" />
                    <span className="text-sm font-medium" style={{ color: active ? 'var(--color-primary)' : 'var(--color-neutral-800)' }}>
                      {label}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-neutral-500)' }}>{desc}</span>
                  </label>
                );
              })}
            </div>

            {entityType === 'company' && (
              <Field label="Company name" required error={errors.companyName?.message}>
                <input id="companyName" type="text" {...register('companyName')}
                  className={inputCls} style={inputStyle(!!errors.companyName)}
                  placeholder="Al Mansouri Real Estate LLC" />
              </Field>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <UserPlus size={16} />
            {isSubmitting ? 'Creating…' : `Register ${role === 'rental_provider' ? 'Rental Provider' : 'Service Provider'}`}
          </button>
        </form>
      </div>
    </DashboardPage>
  );
}
