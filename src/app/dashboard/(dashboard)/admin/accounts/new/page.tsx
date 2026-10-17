'use client';

/**
 * Admin › People › Create admin account (super_admin only).
 *
 * Parity with previous page (every item kept, same validation and payload):
 *  - Permission check: <CanAccess roles={['super_admin']}> with the "You do not have
 *    permission to create admin accounts." fallback.
 *  - react-hook-form + zod: email (valid email), name (2–100), firstName / lastName
 *    (optional, ≤100), phone (optional, /^\+?[1-9]\d{6,14}$/ or empty).
 *  - POST /api/admin/accounts { ...data, phone|firstName|lastName: value || undefined }.
 *  - Success banner "Admin account created. Redirecting…" then router.push to
 *    /dashboard/admin/accounts after 1.5 s; server error shown inline.
 *  - Submit disabled + "Creating…" while submitting; "Back" → /dashboard/admin/accounts.
 *  - Same input ids, autocomplete hints and placeholders. Now kit Field + gx-inp.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CanAccess } from '@/components/ui/CanAccess';
import { apiPost } from '@/lib/api';
import { Btn, Callout, Card, Field, OsPage, PageHead } from '@/components/os/kit';

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

  const back = <Btn href="/dashboard/admin/accounts"><ArrowLeft size={13} aria-hidden /> Back</Btn>;

  return (
    <CanAccess roles={['super_admin']} fallback={
      <OsPage>
        <PageHead eyebrow="Admin › People" title="Create admin account" actions={back} />
        <Callout tone="warn">You do not have permission to create admin accounts.</Callout>
      </OsPage>
    }>
      <OsPage>
        <PageHead
          eyebrow="Admin › People"
          title="Create admin account"
          lede="The new admin will be set to active status and must reset their password on first login."
          actions={back}
        />

        <div style={{ maxWidth: 560 }}>
          {success && <div style={{ marginBottom: 12 }}><Callout>Admin account created. Redirecting…</Callout></div>}
          {serverError && <div style={{ marginBottom: 12 }}><Callout tone="bad">{serverError}</Callout></div>}

          <Card title="Account details" sub="Fields marked * are required." pad>
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <Field label="Email address *" htmlFor="email" error={errors.email?.message}>
                <input id="email" type="email" autoComplete="off" className="gx-inp" placeholder="admin@upnow.ae"
                  aria-invalid={!!errors.email} {...register('email')} />
              </Field>

              <Field label="Display name *" htmlFor="name" error={errors.name?.message}>
                <input id="name" type="text" autoComplete="off" className="gx-inp" placeholder="Platform Admin"
                  aria-invalid={!!errors.name} {...register('name')} />
              </Field>

              <div className="gx-two">
                <Field label="First name" htmlFor="firstName" error={errors.firstName?.message}>
                  <input id="firstName" type="text" autoComplete="given-name" className="gx-inp" placeholder="Optional"
                    {...register('firstName')} />
                </Field>
                <Field label="Last name" htmlFor="lastName" error={errors.lastName?.message}>
                  <input id="lastName" type="text" autoComplete="family-name" className="gx-inp" placeholder="Optional"
                    {...register('lastName')} />
                </Field>
              </div>

              <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
                <input id="phone" type="tel" autoComplete="tel" className="gx-inp" placeholder="+971501234567 (optional)"
                  aria-invalid={!!errors.phone} {...register('phone')} />
              </Field>

              <div className="gx-btn-row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                <Btn href="/dashboard/admin/accounts">Cancel</Btn>
                <Btn type="submit" variant="primary" disabled={isSubmitting || success}>
                  <UserPlus size={13} aria-hidden /> {isSubmitting ? 'Creating…' : 'Create Admin Account'}
                </Btn>
              </div>
            </form>
          </Card>
        </div>
      </OsPage>
    </CanAccess>
  );
}
