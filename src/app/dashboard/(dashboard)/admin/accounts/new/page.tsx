'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { CanAccess } from '@/components/ui/CanAccess';
import { apiPost } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{6,14}$/, 'Enter a valid phone number (e.g. +971501234567)')
    .optional()
    .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export default function NewAdminAccountPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormValues) {
    setServerError(null);
    try {
      await apiPost('/admin/accounts', {
        ...data,
        phone: data.phone || undefined,
        firstName: data.firstName || undefined,
        lastName: data.lastName || undefined,
      });
      setSuccess(true);
      setTimeout(() => router.push('/dashboard/admin/accounts'), 1500);
    } catch (err) {
      setServerError((err as Error).message);
    }
  }

  return (
    <CanAccess roles={['super_admin']} fallback={
      <DashboardPage title="Create Admin Account">
        <p className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>
          You do not have permission to create admin accounts.
        </p>
      </DashboardPage>
    }>
      <DashboardPage
        title="Create Admin Account"
        subtitle="The new admin will be set to active status and must reset their password on first login."
        actions={
          <Link
            href="/dashboard/admin/accounts"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ color: 'var(--color-neutral-600)', backgroundColor: 'var(--color-base-100)' }}
          >
            <ArrowLeft size={14} />
            Back
          </Link>
        }
      >
        <div className="max-w-lg">
          {success && (
            <div
              className="rounded-xl p-4 mb-6 text-sm font-medium"
              style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary)' }}
            >
              Admin account created. Redirecting…
            </div>
          )}

          {serverError && (
            <div
              className="rounded-xl p-4 mb-6 text-sm font-medium"
              style={{ backgroundColor: '#fef2f2', color: 'var(--color-error)' }}
            >
              {serverError}
            </div>
          )}

          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="bg-white rounded-2xl p-6 space-y-5"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-neutral-700)' }}>
                Email address <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="off"
                {...register('email')}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors"
                style={{
                  borderColor: errors.email ? 'var(--color-error)' : 'var(--color-base-200)',
                  color: 'var(--color-neutral-900)',
                }}
                placeholder="admin@upnow.ae"
              />
              {errors.email && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>{errors.email.message}</p>
              )}
            </div>

            {/* Display name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-neutral-700)' }}>
                Display name <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              <input
                id="name"
                type="text"
                autoComplete="off"
                {...register('name')}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors"
                style={{
                  borderColor: errors.name ? 'var(--color-error)' : 'var(--color-base-200)',
                  color: 'var(--color-neutral-900)',
                }}
                placeholder="Platform Admin"
              />
              {errors.name && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>{errors.name.message}</p>
              )}
            </div>

            {/* First / Last name (optional) */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-neutral-700)' }}>
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  autoComplete="given-name"
                  {...register('firstName')}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none"
                  style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-900)' }}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-neutral-700)' }}>
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  autoComplete="family-name"
                  {...register('lastName')}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none"
                  style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-900)' }}
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Phone (optional) */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-neutral-700)' }}>
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                {...register('phone')}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none"
                style={{
                  borderColor: errors.phone ? 'var(--color-error)' : 'var(--color-base-200)',
                  color: 'var(--color-neutral-900)',
                }}
                placeholder="+971501234567 (optional)"
              />
              {errors.phone && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>{errors.phone.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <UserPlus size={16} />
              {isSubmitting ? 'Creating…' : 'Create Admin Account'}
            </button>
          </form>
        </div>
      </DashboardPage>
    </CanAccess>
  );
}
