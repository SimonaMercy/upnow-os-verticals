'use client';

/**
 * Admin › People › Register provider — create a pre-activated Rental Provider or
 * Service Provider account on behalf of a partner.
 *
 * Parity with previous page (every item kept, same validation and payload):
 *  - react-hook-form + zod: role (rental_provider | service_provider, default
 *    rental_provider), email, name (2–100), phone (optional, /^\+?[1-9]\d{6,14}$/ or
 *    empty), entityType (individual | company, default individual), companyName
 *    (≤255; required via superRefine when entityType = company).
 *  - Provider type picker (Rental Provider "Landlords, agencies, brokers" / Service
 *    Provider "Maintenance, cleaning, etc.") and entity type picker (Individual /
 *    Company with descriptions) — now kit chips (aria-pressed) writing the same fields.
 *  - Company name field shown only for company accounts.
 *  - POST /api/admin/accounts/provider { ...data, phone|companyName: value || undefined }.
 *  - Success banner then router.push('/dashboard/admin/kyc') after 1.8 s; server error
 *    shown inline. Submit label "Register Rental Provider / Service Provider",
 *    "Creating…" while submitting. "Back" → /dashboard/admin/accounts.
 *  - No permission gate on the previous page — none added.
 *  - Now kit Field + gx-inp; same ids, autocomplete hints and placeholders.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, UserPlus, Wrench } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiPost } from '@/lib/api';
import { Btn, Callout, Card, Field, OsPage, PageHead } from '@/components/os/kit';

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

const ROLE_OPTIONS = [
  { value: 'rental_provider', label: 'Rental Provider', Icon: Building2, desc: 'Landlords, agencies, brokers' },
  { value: 'service_provider', label: 'Service Provider', Icon: Wrench, desc: 'Maintenance, cleaning, etc.' },
] as const;
const ENTITY_OPTIONS = [
  { value: 'individual', label: 'Individual', desc: 'Natural person / sole owner' },
  { value: 'company', label: 'Company', desc: 'LLC, PJSC, brokerage, etc.' },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewProviderAccountPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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

  const roleDesc = ROLE_OPTIONS.find((o) => o.value === role)?.desc;
  const entityDesc = ENTITY_OPTIONS.find((o) => o.value === entityType)?.desc;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › People"
        title="Register provider"
        lede="Create a pre-activated Rental Provider or Service Provider account on behalf of a partner. They still pass Gate 1 business verification in Profile Verification."
        actions={<Btn href="/dashboard/admin/accounts"><ArrowLeft size={13} aria-hidden /> Back</Btn>}
      />

      <div style={{ maxWidth: 560 }}>
        {success && <div style={{ marginBottom: 12 }}><Callout>Account created successfully. Redirecting to Profile Verification…</Callout></div>}
        {serverError && <div style={{ marginBottom: 12 }}><Callout tone="bad">{serverError}</Callout></div>}

        <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'grid', gap: 14 }}>
          <Card title="Provider type *" pad>
            <div className="gx-chips" role="group" aria-label="Provider type">
              {ROLE_OPTIONS.map(({ value, label, Icon }) => (
                <button key={value} type="button" className="gx-chip" aria-pressed={role === value}
                  onClick={() => setValue('role', value, { shouldDirty: true })}>
                  <Icon size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />{label}
                </button>
              ))}
            </div>
            {roleDesc && <div className="gx-hint">{roleDesc}</div>}
          </Card>

          <Card title="Account info" pad>
            <Field label="Email address *" htmlFor="email" error={errors.email?.message}>
              <input id="email" type="email" autoComplete="off" className="gx-inp" placeholder="provider@company.ae"
                aria-invalid={!!errors.email} {...register('email')} />
            </Field>
            <Field label="Full name *" htmlFor="name" error={errors.name?.message}>
              <input id="name" type="text" autoComplete="off" className="gx-inp" placeholder="Ahmad Al Mansouri"
                aria-invalid={!!errors.name} {...register('name')} />
            </Field>
            <Field label="Phone number" htmlFor="phone" error={errors.phone?.message}>
              <input id="phone" type="tel" autoComplete="tel" className="gx-inp" placeholder="+971501234567 (optional)"
                aria-invalid={!!errors.phone} {...register('phone')} />
            </Field>
          </Card>

          <Card title="Entity type" pad>
            <div className="gx-form-row">
              <div className="gx-chips" role="group" aria-label="Entity type">
                {ENTITY_OPTIONS.map(({ value, label }) => (
                  <button key={value} type="button" className="gx-chip" aria-pressed={entityType === value}
                    onClick={() => setValue('entityType', value, { shouldDirty: true })}>
                    {label}
                  </button>
                ))}
              </div>
              {entityDesc && <div className="gx-hint">{entityDesc}</div>}
            </div>

            {entityType === 'company' && (
              <Field label="Company name *" htmlFor="companyName" error={errors.companyName?.message}>
                <input id="companyName" type="text" className="gx-inp" placeholder="Al Mansouri Real Estate LLC"
                  aria-invalid={!!errors.companyName} {...register('companyName')} />
              </Field>
            )}
          </Card>

          <div className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
            <Btn href="/dashboard/admin/accounts">Cancel</Btn>
            <Btn type="submit" variant="primary" disabled={isSubmitting || success}>
              <UserPlus size={13} aria-hidden />
              {isSubmitting ? 'Creating…' : `Register ${role === 'rental_provider' ? 'Rental Provider' : 'Service Provider'}`}
            </Btn>
          </div>
        </form>
      </div>
    </OsPage>
  );
}
