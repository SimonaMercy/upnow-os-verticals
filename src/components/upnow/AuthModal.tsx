'use client';

/**
 * AuthModal — lightweight sign-in / sign-up popup used from the landing header.
 *
 *  • mode="signin" → the OTP login flow (identify → verify) inline.
 *  • mode="signup" → pick a role, then register INLINE (no separate page):
 *      - Customer        → phone + Google / Apple social sign-up.
 *      - Rental Provider  → email only (no social login).
 *      - Service Provider → email only (no social login).
 *    On submit we hand off to the existing OTP verification page, exactly like
 *    the standalone /register/* pages do. Manager & Technician are invite-only.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, FormEvent } from 'react';
import {
  X, Home, Building2, Wrench, ArrowRight, ArrowLeft, Mail, Phone,
  AlertCircle, CheckCircle2,
} from 'lucide-react';
import {
  useAuth, dashboardPath, verificationPath,
  type AuthResponse, type SelfRegisterRole,
} from '@/contexts/AuthContext';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { apiPost } from '@/lib/api';

export type AuthModalMode = 'signin' | 'signup';

// ─── role config ──────────────────────────────────────────────────────────────

const ROLE_META: Record<SelfRegisterRole, {
  icon: typeof Home;
  title: string;
  field: 'phone' | 'email';
  oauth: boolean;
}> = {
  customer:         { icon: Home,      title: 'Customer',         field: 'phone', oauth: true  },
  rental_provider:  { icon: Building2, title: 'Rental Provider',  field: 'email', oauth: false },
  service_provider: { icon: Wrench,    title: 'Service Provider', field: 'email', oauth: false },
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Detect phone vs email, normalising UAE phone numbers to E.164. */
function buildIdentifier(raw: string): { value: string; kind: 'phone' | 'email' | 'unknown' } {
  const t = raw.trim();
  if (!t) return { value: '', kind: 'unknown' };
  if (t.includes('@')) return { value: t.toLowerCase(), kind: 'email' };
  const digits = t.replace(/[^\d+]/g, '');
  if (!digits) return { value: '', kind: 'unknown' };
  if (digits.startsWith('+')) return { value: digits, kind: 'phone' };
  return { value: `+971${digits.replace(/^0+/, '')}`, kind: 'phone' };
}

/** Phone normalisation for customer sign-up (mirrors CustomerRegisterForm). */
function normalisePhone(raw: string): string {
  const trimmed = raw.replace(/\s+/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`;
  if (/^\d{8,12}$/.test(trimmed)) return `+971${trimmed.replace(/^0+/, '')}`;
  return trimmed;
}
function isValidPhone(input: string): boolean {
  return /^\+?\d{8,16}$/.test(input.replace(/\s+/g, ''));
}

// ─── component ────────────────────────────────────────────────────────────────

export function AuthModal({
  mode,
  onClose,
  onModeChange,
}: {
  mode: AuthModalMode;
  onClose: () => void;
  onModeChange: (m: AuthModalMode) => void;
}) {
  const router = useRouter();
  const { login, verifyLoginOtp, register, refresh, verifyOtp, requestOtp } = useAuth();

  // Sign-in (OTP) state
  const [step, setStep] = useState<'identify' | 'verify'>('identify');
  const [identifierRaw, setIdentifierRaw] = useState('');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Sign-up state
  const [signupRole, setSignupRole] = useState<SelfRegisterRole | null>(null);
  const [signupStep, setSignupStep] = useState<'form' | 'otp'>('form');
  const [signupValue, setSignupValue] = useState('');
  const [signupIdentifier, setSignupIdentifier] = useState(''); // email or normalised phone actually registered
  const [signupWebsite, setSignupWebsite] = useState(''); // T-108 honeypot
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const identifierKind = buildIdentifier(identifierRaw).kind;

  // Reset all transient state whenever the modal mode flips.
  useEffect(() => {
    setStep('identify');
    setOtp(['', '', '', '', '', '']);
    setDevOtp(null);
    setError(null);
    setSignupRole(null);
    setSignupStep('form');
    setSignupValue('');
    setSignupIdentifier('');
    setSignupError(null);
  }, [mode]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // ── sign-in handlers ──
  async function onRequestOtp(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const { value: identifier, kind } = buildIdentifier(identifierRaw);
    if (!identifier || kind === 'unknown') { setError('Enter your phone number or email.'); return; }
    if (kind === 'email' && !/^\S+@\S+\.\S+$/.test(identifier)) { setError('Enter a valid email address.'); return; }
    setSubmitting(true);
    try {
      const res: AuthResponse = await login(identifier);
      if (res?.devOtp) setDevOtp(res.devOtp);
      setStep('verify');
      setResendIn(45);
      setTimeout(() => otpRefs.current[0]?.focus(), 60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const code = otp.join('');
    if (code.length !== 6) { setError('Enter the 6-digit code.'); return; }
    setSubmitting(true);
    try {
      const { value: identifier } = buildIdentifier(identifierRaw);
      const res = await verifyLoginOtp(identifier, code);
      if (res.requiresVerification) {
        router.push(`${verificationPath(res.verificationStep)}?email=${encodeURIComponent(identifier)}`);
      } else {
        onClose();
        router.push(dashboardPath(res.user?.role ?? 'customer'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setSubmitting(false);
    }
  }

  function onOtpDigit(idx: number, val: string) {
    const digits = val.replace(/\D/g, '');
    if (!digits.length) {
      setOtp((prev) => { const next = [...prev]; next[idx] = ''; return next; });
      return;
    }
    if (digits.length > 1) {
      const padded = digits.slice(0, 6).padEnd(6, ' ').slice(0, 6);
      setOtp(padded.split('').map((c) => (c === ' ' ? '' : c)));
      otpRefs.current[Math.min(5, digits.length - 1)]?.focus();
      return;
    }
    setOtp((prev) => { const next = [...prev]; next[idx] = digits; return next; });
    if (idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  // ── sign-up handler ──
  async function onSignupSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!signupRole) return;
    const meta = ROLE_META[signupRole];
    setSignupError(null);

    let payload: { email?: string; phone?: string; website: string };
    if (meta.field === 'phone') {
      const normalised = normalisePhone(signupValue.trim());
      if (!normalised) { setSignupError('Enter your phone number.'); return; }
      if (!isValidPhone(normalised)) { setSignupError('Enter a valid phone number (8–16 digits).'); return; }
      payload = { phone: normalised, website: signupWebsite };
    } else {
      const email = signupValue.trim().toLowerCase();
      if (!email) { setSignupError('Enter your email address.'); return; }
      if (!/^\S+@\S+\.\S+$/.test(email)) { setSignupError('Enter a valid email address.'); return; }
      payload = { email, website: signupWebsite };
    }

    setSignupSubmitting(true);
    try {
      const res = await register(signupRole, payload);
      if (res.requiresVerification) {
        // Bring the OTP step inline instead of navigating to /verify(-email).
        setSignupIdentifier(payload.email ?? payload.phone!);
        setDevOtp(res.devOtp ?? null);
        setOtp(['', '', '', '', '', '']);
        setResendIn(45);
        setSignupStep('otp');
        setTimeout(() => otpRefs.current[0]?.focus(), 60);
      } else {
        const me = await refresh();
        onClose();
        router.push(dashboardPath(me?.role ?? res.user?.role ?? 'customer'));
      }
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSignupSubmitting(false);
    }
  }

  // Verify the registration OTP inline: customers by phone, providers by email.
  async function onSignupVerify(e?: FormEvent) {
    e?.preventDefault();
    if (!signupRole) return;
    const meta = ROLE_META[signupRole];
    setSignupError(null);
    const code = otp.join('');
    if (code.length !== 6) { setSignupError('Enter the 6-digit code.'); return; }
    setSignupSubmitting(true);
    try {
      if (meta.field === 'phone') {
        await verifyOtp(code);                                          // /auth/otp/verify (session)
      } else {
        await apiPost('/auth/email/verify-otp', { email: signupIdentifier, code });
      }
      const me = await refresh();
      const role = me?.role ?? signupRole;
      onClose();
      const dest =
        role === 'rental_provider'  ? '/dashboard/rental-provider/onboarding'
        : role === 'service_provider' ? '/dashboard/service-provider/onboarding'
        : '/';
      router.push(dest);
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setSignupSubmitting(false);
    }
  }

  // Resend the registration OTP through the matching channel.
  async function onSignupResend() {
    if (!signupRole || resendIn > 0) return;
    const meta = ROLE_META[signupRole];
    setSignupError(null);
    setOtp(['', '', '', '', '', '']);
    try {
      if (meta.field === 'phone') {
        const res = await requestOtp() as { maskedPhone?: string; devOtp?: string };
        if (res.devOtp) setDevOtp(res.devOtp);
      } else {
        const res = await apiPost<{ sent?: boolean; devOtp?: string }>('/auth/email/resend-otp', { email: signupIdentifier });
        if (res.devOtp) setDevOtp(res.devOtp);
      }
      setResendIn(45);
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : 'Could not resend code.');
    }
  }

  // Route an OTP submission to sign-in verify or sign-up verify depending on context.
  function submitOtp() {
    if (mode === 'signup' && signupStep === 'otp') onSignupVerify();
    else onVerify();
  }

  function onOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
    if (e.key === 'Enter' && otp.every((d) => !!d)) submitOtp();
  }

  // Auto-submit once all six digits are present (both sign-in and sign-up OTP steps).
  useEffect(() => {
    const inOtp = (mode === 'signin' && step === 'verify') || (mode === 'signup' && signupStep === 'otp');
    if (inOtp && otp.every((d) => !!d) && !submitting && !signupSubmitting) submitOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step, signupStep, mode]);

  // ── shared bits ──
  const switchLink = (target: AuthModalMode, lead: string, cta: string) => (
    <p style={{ textAlign: 'center', fontSize: 14, color: '#6b7a74', marginTop: 18 }}>
      {lead}{' '}
      <button
        onClick={() => onModeChange(target)}
        style={{ background: 'none', border: 'none', color: '#2e9f82', fontWeight: 600, cursor: 'pointer', fontSize: 14, padding: 0, fontFamily: 'inherit' }}
      >
        {cta}
      </button>
    </p>
  );

  const heading = (text: string) => (
    <h2 style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: '#0e1a16', margin: 0 }}>{text}</h2>
  );

  const inputStyle = {
    width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12,
    border: '1.5px solid #e8ece9', fontSize: 15, outline: 'none', fontFamily: 'inherit',
  } as const;

  // Six-box OTP input — shared by the sign-in and sign-up verify steps.
  const otpBoxes = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
      {otp.map((d, i) => (
        <input
          key={i}
          ref={(el) => { otpRefs.current[i] = el; }}
          value={d}
          onChange={(e) => onOtpDigit(i, e.target.value)}
          onKeyDown={(e) => onOtpKeyDown(i, e)}
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          style={{
            width: '100%', aspectRatio: '1', textAlign: 'center', fontSize: 20, fontWeight: 700,
            borderRadius: 12, border: `1.5px solid ${d ? '#2e9f82' : '#e8ece9'}`, outline: 'none',
            color: '#0e1a16', fontFamily: 'inherit',
          }}
        />
      ))}
    </div>
  );

  const devOtpBox = devOtp && (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#e7f5f0', color: '#155a48', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
      <span>Your OTP</span>
      <b style={{ letterSpacing: 2 }}>{devOtp}</b>
    </div>
  );

  // Role choice row — icon + title + arrow. Customer is emphasized (green).
  // Attribute sign-up intent for the UTM funnel — modelled as a page-visit
  // event to /signup/<role> so it lands in page_visits with the same UTM the
  // visitor arrived on. Lets us tie traffic → who chose to become a
  // customer / rental provider / service provider.
  const trackSignupIntent = (role: SelfRegisterRole) => {
    try {
      const params = new URLSearchParams(window.location.search);
      const payload: Record<string, string> = { path: `/signup/${role.replace(/_/g, '-')}` };
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        const v = params.get(k);
        if (v) payload[k] = v;
      }
      if (document.referrer) payload.referrer = document.referrer;
      void fetch('/api/track/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* telemetry never throws */
    }
  };

  const roleButton = (role: SelfRegisterRole, emphasized: boolean) => {
    const meta = ROLE_META[role];
    const Icon = meta.icon;
    return (
      <button
        key={role}
        onClick={() => { trackSignupIntent(role); setSignupRole(role); setSignupStep('form'); setSignupValue(''); setSignupError(null); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: 14, width: '100%',
          border: `1.5px solid ${emphasized ? '#2e9f82' : '#e8ece9'}`, borderRadius: 14,
          background: 'white', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
          transition: 'border-color .15s, box-shadow .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2e9f82'; e.currentTarget.style.boxShadow = '0 4px 16px -6px rgba(46,159,130,0.35)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = emphasized ? '#2e9f82' : '#e8ece9'; e.currentTarget.style.boxShadow = 'none'; }}
      >
        <span style={{
          width: 42, height: 42, borderRadius: 11, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: emphasized ? '#2e9f82' : '#e7f5f0',
          color: emphasized ? 'white' : '#2e9f82',
        }}>
          <Icon size={19} />
        </span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 15, color: '#0e1a16' }}>{meta.title}</span>
        <ArrowRight size={16} style={{ color: '#9ca3af', flexShrink: 0 }} />
      </button>
    );
  };

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(14,26,22,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 20, width: '100%',
          maxWidth: 420,
          boxShadow: '0 24px 64px -12px rgba(0,0,0,0.35)',
          padding: 28, position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 16, right: 16, width: 32, height: 32,
            borderRadius: '50%', border: 'none', background: '#f2f5f3',
            color: '#6b7a74', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={16} />
        </button>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 9, background: '#2e9f82', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 17,
          }}>U</span>
          <span style={{ fontWeight: 800, fontSize: 19, color: '#0e1a16' }}>UpNow</span>
        </div>

        {mode === 'signup' ? (
          signupRole === null ? (
            /* ── role choice ── */
            <>
              {heading('How will you use UpNow?')}
              <p style={{ fontSize: 13.5, color: '#6b7a74', margin: '6px 0 0', lineHeight: 1.5 }}>
                You can add another role later from your profile.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
                {roleButton('customer', true)}
                {roleButton('rental_provider', false)}
                {roleButton('service_provider', false)}
              </div>
              {switchLink('signin', 'Already have an account?', 'Sign in')}
            </>
          ) : signupStep === 'otp' ? (
            /* ── inline OTP verification ── */
            (() => {
              const meta = ROLE_META[signupRole];
              return (
                <>
                  <button
                    type="button"
                    onClick={() => { setSignupStep('form'); setOtp(['', '', '', '', '', '']); setSignupError(null); setDevOtp(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#6b7a74', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14, fontFamily: 'inherit' }}
                  >
                    <ArrowLeft size={14} /> Back
                  </button>

                  {heading('Enter the code')}
                  <p style={{ fontSize: 14, color: '#6b7a74', margin: '6px 0 18px', lineHeight: 1.55 }}>
                    Sent to <strong style={{ color: '#0e1a16' }}>{signupIdentifier}</strong> to verify your {meta.field === 'phone' ? 'phone' : 'email'}. It expires in 10 minutes.
                  </p>

                  <form onSubmit={onSignupVerify}>
                    {devOtpBox}

                    {otpBoxes()}

                    {signupError && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', color: '#b91c1c', padding: '10px 12px', borderRadius: 10, fontSize: 13, margin: '12px 0' }}>
                        <AlertCircle size={15} /> {signupError}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: '#6b7a74', margin: '14px 0' }}>
                      <span>Didn&apos;t get the code?</span>
                      {resendIn > 0 ? (
                        <span style={{ color: '#9ca3af' }}>Resend in {resendIn}s</span>
                      ) : (
                        <button type="button" onClick={onSignupResend} style={{ background: 'none', border: 'none', color: '#2e9f82', fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>
                          Resend code
                        </button>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={signupSubmitting || otp.some((d) => !d)}
                      style={{
                        width: '100%', padding: '13px 16px', borderRadius: 999,
                        background: '#2e9f82', color: 'white', border: 'none', fontWeight: 600, fontSize: 15,
                        cursor: (signupSubmitting || otp.some((d) => !d)) ? 'default' : 'pointer',
                        opacity: (signupSubmitting || otp.some((d) => !d)) ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
                      }}
                    >
                      {signupSubmitting ? 'Verifying…' : (<><CheckCircle2 size={16} /> Verify &amp; create account</>)}
                    </button>
                  </form>
                </>
              );
            })()
          ) : (
            /* ── inline registration form ── */
            (() => {
              const meta = ROLE_META[signupRole];
              const isPhone = meta.field === 'phone';
              return (
                <>
                  <button
                    type="button"
                    onClick={() => { setSignupRole(null); setSignupValue(''); setSignupError(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#6b7a74', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14, fontFamily: 'inherit' }}
                  >
                    <ArrowLeft size={14} /> Back
                  </button>

                  {heading(`Sign up as ${meta.title}`)}

                  <form onSubmit={onSignupSubmit} style={{ marginTop: 18 }} noValidate>
                    {/* T-108 honeypot */}
                    <div aria-hidden="true" style={{ position: 'absolute', left: -9999, top: -9999, height: 0, width: 0, overflow: 'hidden' }}>
                      <label>Website (leave blank)
                        <input type="text" tabIndex={-1} autoComplete="off" value={signupWebsite} onChange={(e) => setSignupWebsite(e.target.value)} />
                      </label>
                    </div>

                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#36433d', marginBottom: 6 }}>
                      {isPhone ? 'Phone number' : 'Email address'}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>
                        {isPhone ? <Phone size={16} /> : <Mail size={16} />}
                      </span>
                      <input
                        type={isPhone ? 'tel' : 'email'}
                        inputMode={isPhone ? 'tel' : 'email'}
                        autoComplete={isPhone ? 'tel' : 'email'}
                        autoFocus
                        placeholder={isPhone ? '+971 50 123 4567' : 'you@example.com'}
                        value={signupValue}
                        onChange={(e) => setSignupValue(e.target.value)}
                        style={inputStyle}
                      />
                    </div>

                    {signupError && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', color: '#b91c1c', padding: '10px 12px', borderRadius: 10, fontSize: 13, marginTop: 10 }}>
                        <AlertCircle size={15} /> {signupError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={signupSubmitting}
                      style={{
                        width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: 999,
                        background: '#2e9f82', color: 'white', border: 'none', fontWeight: 600, fontSize: 15,
                        cursor: signupSubmitting ? 'default' : 'pointer', opacity: signupSubmitting ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
                      }}
                    >
                      {signupSubmitting ? 'Creating…' : (<>Create account <ArrowRight size={16} /></>)}
                    </button>
                  </form>

                  {/* Social sign-up — customers only */}
                  {meta.oauth && (
                    <div style={{ marginTop: 16 }}>
                      <OAuthButtons redirect={null} />
                    </div>
                  )}

                  {switchLink('signin', 'Already have an account?', 'Sign in')}
                </>
              );
            })()
          )
        ) : step === 'identify' ? (
          /* ── sign-in: identify ── */
          <>
            {heading('Welcome back')}
            <p style={{ fontSize: 14, color: '#6b7a74', margin: '6px 0 20px', lineHeight: 1.55 }}>
              Sign in with your phone or email — we&apos;ll send you a 6-digit code.
            </p>

            <form onSubmit={onRequestOtp}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#36433d', marginBottom: 6 }}>
                Phone or email
              </label>
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>
                  {identifierKind === 'email' ? <Mail size={16} /> : <Phone size={16} />}
                </span>
                <input
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="50 123 4567 or you@example.com"
                  value={identifierRaw}
                  onChange={(e) => setIdentifierRaw(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', color: '#b91c1c', padding: '10px 12px', borderRadius: 10, fontSize: 13, margin: '10px 0' }}>
                  <AlertCircle size={15} /> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: 999,
                  background: '#2e9f82', color: 'white', border: 'none', fontWeight: 600, fontSize: 15,
                  cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
                }}
              >
                {submitting ? 'Sending…' : (<>Send code <ArrowRight size={16} /></>)}
              </button>
            </form>

            {switchLink('signup', 'New here?', 'Create account')}
          </>
        ) : (
          /* ── sign-in: verify ── */
          <>
            <button
              type="button"
              onClick={() => { setStep('identify'); setOtp(['', '', '', '', '', '']); setError(null); setDevOtp(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#6b7a74', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14, fontFamily: 'inherit' }}
            >
              <ArrowLeft size={14} /> Use a different phone or email
            </button>

            {heading('Enter the code')}
            <p style={{ fontSize: 14, color: '#6b7a74', margin: '6px 0 18px', lineHeight: 1.55 }}>
              Sent to <strong style={{ color: '#0e1a16' }}>{buildIdentifier(identifierRaw).value || identifierRaw}</strong>. It expires in 10 minutes.
            </p>

            <form onSubmit={onVerify}>
              {devOtpBox}

              {otpBoxes()}

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', color: '#b91c1c', padding: '10px 12px', borderRadius: 10, fontSize: 13, margin: '12px 0' }}>
                  <AlertCircle size={15} /> {error}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: '#6b7a74', margin: '14px 0' }}>
                <span>Didn&apos;t get the code?</span>
                {resendIn > 0 ? (
                  <span style={{ color: '#9ca3af' }}>Resend in {resendIn}s</span>
                ) : (
                  <button type="button" onClick={() => { setOtp(['', '', '', '', '', '']); onRequestOtp(); }} style={{ background: 'none', border: 'none', color: '#2e9f82', fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>
                    Resend code
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || otp.some((d) => !d)}
                style={{
                  width: '100%', padding: '13px 16px', borderRadius: 999,
                  background: '#2e9f82', color: 'white', border: 'none', fontWeight: 600, fontSize: 15,
                  cursor: (submitting || otp.some((d) => !d)) ? 'default' : 'pointer',
                  opacity: (submitting || otp.some((d) => !d)) ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
                }}
              >
                {submitting ? 'Verifying…' : (<><CheckCircle2 size={16} /> Verify &amp; sign in</>)}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
