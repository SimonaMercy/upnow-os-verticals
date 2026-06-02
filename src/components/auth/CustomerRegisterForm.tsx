'use client';

/**
 * Customer-only registration — phone-mandatory variant.
 *
 * Why phone-only here:
 *  - Every signed-up customer is a potential rental / service lead. The RP
 *    and service provider need a reachable number from day one, so phone
 *    is required.
 *  - Email is optional and added/verified later from the customer profile
 *    via the existing /auth/email/request-otp + /auth/email/verify-otp flow.
 *
 * Business signups (RP / SP) keep the original email-or-phone shape via
 * the shared RegisterForm component.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth, dashboardPath, verificationPath } from '@/contexts/AuthContext';
import { AuthShell, FormField, Alert, PrimaryButton, inputClass } from './AuthShell';
import { OAuthButtons } from './OAuthButtons';

/** UAE phone numbers are 9 digits after the +971 country code (e.g.
 *  +971 50 123 4567). We accept any 8–16 digit length to stay friendly to
 *  expats keeping their home-country numbers, but default the prefix to
 *  +971 since most customers register on a UAE handset. */
function normalisePhone(raw: string): string {
  const trimmed = raw.replace(/\s+/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  // Default to UAE prefix when the user types digits only
  if (/^\d{8,12}$/.test(trimmed)) return `+971${trimmed.replace(/^0+/, '')}`;
  return trimmed;
}

function isValidPhone(input: string): boolean {
  return /^\+?\d{8,16}$/.test(input.replace(/\s+/g, ''));
}

export function CustomerRegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { register, refresh } = useAuth();

  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState(''); // T-108 honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const normalised = normalisePhone(phone.trim());
    if (!normalised) { setError('Enter your phone number'); return; }
    if (!isValidPhone(normalised)) { setError('Enter a valid phone number (8–16 digits, optional leading +)'); return; }

    setError(null);
    setSubmitting(true);
    try {
      const payload = { phone: normalised, website };
      const res = await register('customer', payload);
      const redirect = params.get('redirect');

      const me = res.requiresVerification ? null : await refresh();
      router.push(
        res.requiresVerification
          ? `${verificationPath(res.verificationStep)}?email=${encodeURIComponent(normalised)}${res.devOtp ? `&devOtp=${res.devOtp}` : ''}`
          : (redirect ?? dashboardPath(me?.role ?? res.user?.role ?? 'customer')),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    handleSubmit();
  }

  return (
    <AuthShell
      title="Sign up as a Customer"
      subtitle="We'll send a one-time code to your phone to verify your account. You can add and verify an email later from your profile."
      footer={
        <p className="text-sm text-center" style={{ color: 'var(--neutral-700)' }}>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: 'var(--primary)' }}
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onFormSubmit} className="flex flex-col gap-4" noValidate>
        {/* T-108 honeypot */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', height: 0, width: 0, overflow: 'hidden' }}>
          <label>
            Website (leave blank)
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        <FormField
          label="Phone number"
          hint="Required. We'll text you a verification code now and your rental provider can reach you here once you book."
        >
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+971 50 123 4567"
            autoComplete="tel"
            inputMode="tel"
            required
            className={inputClass}
            data-testid="customer-register-phone"
          />
        </FormField>

        {error && <Alert kind="error">{error}</Alert>}

        <PrimaryButton type="button" onClick={handleSubmit} loading={submitting}>
          Create account
        </PrimaryButton>
      </form>

      <div className="mt-4">
        <OAuthButtons redirect={params.get('redirect')} />
      </div>
    </AuthShell>
  );
}
