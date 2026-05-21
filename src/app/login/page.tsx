/**
 * Login page (/login) — OTP-based sign in.
 *
 * Step 1 — identify: phone OR email + "Send code" → POST /auth/login
 * Step 2 — verify:  6-digit code → POST /auth/login/verify-otp → JWT cookie
 *
 * Layout: 70/30 split (banner left, OTP form right) using login.module.css.
 */
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense, FormEvent } from 'react';
import { Manrope, Instrument_Serif } from 'next/font/google';
import {
  Mail, Phone, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, MapPin, ShieldCheck,
  Sparkles, Wind, Paintbrush, Wrench, Zap, Home, Building2, Factory,
} from 'lucide-react';
import { useAuth, dashboardPath, verificationPath, type AuthResponse } from '@/contexts/AuthContext';
import s from './login.module.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap' });
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], display: 'swap', variable: '--font-serif' });

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

// ─── Banner showcase data ───────────────────────────
const PROPS_DATA = {
  residential: {
    photo: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1100&q=80&auto=format&fit=crop',
    label: 'Residential',
    name:  'Marina-view 2BR',
    loc:   'Dubai Marina · Apt 04-A',
  },
  commercial: {
    photo: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1100&q=80&auto=format&fit=crop',
    label: 'Commercial',
    name:  'Open-plan office',
    loc:   'Business Bay · Floor 14',
  },
  industrial: {
    photo: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1100&q=80&auto=format&fit=crop',
    label: 'Industrial',
    name:  'Warehouse unit',
    loc:   'Al Quoz · Block 7',
  },
} as const;

const SERVICES_DATA = [
  { id: 'cleaning', label: 'Cleaning', Icon: Sparkles,  pro: 'Noor S.',     rating: '4.9', sub: 'today · 6pm' },
  { id: 'plumbing', label: 'Plumbing', Icon: Wrench,    pro: 'Hassan M.',   rating: '4.8', sub: '1 hr ETA'   },
  { id: 'ac',       label: 'AC',       Icon: Wind,      pro: 'Pro AC Co.',  rating: '4.9', sub: 'same-day'   },
  { id: 'electric', label: 'Electric', Icon: Zap,       pro: 'Volt UAE',    rating: '4.7', sub: 'same-day'   },
  { id: 'paint',    label: 'Paint',    Icon: Paintbrush, pro: 'Brushwork',  rating: '4.9', sub: 'next slot'  },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, verifyLoginOtp } = useAuth();

  const [step, setStep] = useState<'identify' | 'verify'>('identify');
  // Single combined identifier — auto-detects phone vs email format.
  const [identifierRaw, setIdentifierRaw] = useState('');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // Banner showcase interactive state
  const [propType, setPropType] = useState<'residential' | 'commercial' | 'industrial'>('residential');
  const [selectedService, setSelectedService] = useState<string>('cleaning');
  const [keepSignedIn, setKeepSignedIn] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const justReset = params.get('reset') === '1';
  const emailVerified = params.get('emailVerified') === '1';
  const redirect = params.get('redirect');

  /**
   * Detects whether the raw input is an email or a phone number.
   * Phone numbers get normalized to E.164 with +971 default if no country code.
   */
  function buildIdentifier(): { value: string; kind: 'phone' | 'email' | 'unknown' } {
    const raw = identifierRaw.trim();
    if (!raw) return { value: '', kind: 'unknown' };
    if (raw.includes('@')) return { value: raw.toLowerCase(), kind: 'email' };
    const digits = raw.replace(/[^\d+]/g, '');
    if (!digits) return { value: '', kind: 'unknown' };
    if (digits.startsWith('+')) return { value: digits, kind: 'phone' };
    // UAE default — strip leading zeros and prefix +971
    const trimmed = digits.replace(/^0+/, '');
    return { value: `+971${trimmed}`, kind: 'phone' };
  }
  const identifierKind = buildIdentifier().kind;

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  async function onRequestOtp(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const { value: identifier, kind } = buildIdentifier();
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
      const { value: identifier } = buildIdentifier();
      const res = await verifyLoginOtp(identifier, code);
      if (res.requiresVerification) {
        router.push(`${verificationPath(res.verificationStep)}?email=${encodeURIComponent(identifier)}`);
      } else {
        router.push(redirect ?? dashboardPath(res.user?.role ?? 'customer'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code.');
    } finally {
      setSubmitting(false);
    }
  }

  function onResend() {
    if (resendIn > 0) return;
    setOtp(['', '', '', '', '', '']);
    onRequestOtp();
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
      const last = Math.min(5, digits.length - 1);
      otpRefs.current[last]?.focus();
      return;
    }
    setOtp((prev) => { const next = [...prev]; next[idx] = digits; return next; });
    if (idx < 5) otpRefs.current[idx + 1]?.focus();
  }

  function onOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
    if (e.key === 'Enter') {
      const full = otp.every((d) => !!d);
      if (full) onVerify();
    }
  }

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (step === 'verify' && otp.every((d) => !!d) && !submitting) {
      onVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  const identifierForDisplay = (() => {
    const { value, kind } = buildIdentifier();
    if (kind === 'email') return value;
    if (kind === 'phone') return value.replace(/^(\+\d{1,4})(\d.*)$/, '$1 $2');
    return identifierRaw || 'your phone or email';
  })();

  const fontClass = cn(manrope.className, instrumentSerif.variable);

  return (
    <div className={cn(s.page, fontClass)}>

      {/* ── Banner (left, 70%) ── */}
      <section className={s.banner}>
        <div className={s.bannerBg} />

        <div className={s.bannerTop}>
          <Link href="/" className={s.brand}>
            <span className={s.brandMark}>U</span>
            UpNow
          </Link>
          {/* Property type pills — interactive */}
          <div className={s.typePills} role="tablist" aria-label="Property type">
            {[
              { id: 'residential' as const, label: 'Residential', Icon: Home },
              { id: 'commercial'  as const, label: 'Commercial',  Icon: Building2 },
              { id: 'industrial'  as const, label: 'Industrial',  Icon: Factory },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={cn(s.typePill, propType === p.id && s.active)}
                onClick={() => setPropType(p.id)}
              >
                <span className={s.typePillIc}><p.Icon size={14} /></span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={s.showcase}>
          <div className={s.showcaseLeft}>
            <span className={s.eyebrow}>Property + services, one platform</span>
            <h1 className={s.headline}>
              Your property.<br />
              A service away.{' '}
              <span className={s.serif}>In one tap.</span>
            </h1>
            <p className={s.sub}>
              Residential, commercial or industrial — every property in your portfolio is one tap from a verified pro for cleaning, maintenance, repairs and 240+ more services across the UAE.
            </p>
            <div className={s.stats}>
              <div>
                <div className={s.statNum}>12,400<em>+</em></div>
                <div className={s.statLbl}>Properties managed</div>
              </div>
              <div>
                <div className={s.statNum}>240<em>+</em></div>
                <div className={s.statLbl}>Services on demand</div>
              </div>
              <div>
                <div className={s.statNum}>&lt;60<em>s</em></div>
                <div className={s.statLbl}>Avg. time to book</div>
              </div>
            </div>
          </div>

          {/* Property showcase card */}
          {(() => {
            const prop = PROPS_DATA[propType];
            const svc = SERVICES_DATA.find((x) => x.id === selectedService) ?? SERVICES_DATA[0];
            return (
              <div className={s.propCardWrap}>
                <div className={s.floatTip}>
                  <span className={s.floatTipPulse} />
                  Pick a service · book in 1 tap
                </div>
                <div className={s.propCard}>
                  <div
                    className={s.propPhoto}
                    style={{ backgroundImage: `url("${prop.photo}")` }}
                  >
                    <span className={s.propBadge}><span className={s.dot} /> {prop.label}</span>
                    <span className={s.propYours}>Your property</span>
                    <div className={s.propMeta}>
                      <div>
                        <div className={s.propTitle}>{prop.name}</div>
                        <div className={s.propLoc}><MapPin size={11} /> {prop.loc}</div>
                      </div>
                      <span className={s.propVerified}><ShieldCheck size={13} /> Verified</span>
                    </div>
                  </div>

                  <div className={s.propBody}>
                    <div className={s.svcHead}>
                      <span className={s.svcLbl}>Quick book a service</span>
                      <span className={s.svcMore}>See all 240+ →</span>
                    </div>
                    <div className={s.svcGrid}>
                      {SERVICES_DATA.map(({ id, label, Icon }) => {
                        const active = id === selectedService;
                        return (
                          <button
                            key={id}
                            type="button"
                            className={cn(s.svcItem, active && s.active)}
                            onClick={() => setSelectedService(id)}
                          >
                            {active && <span className={s.svcRibbon}>1 tap</span>}
                            <div className={s.svcIcWrap}><Icon size={16} /></div>
                            <div className={s.svcItemLbl}>{label}</div>
                          </button>
                        );
                      })}
                    </div>

                    <button type="button" className={s.bookCta}>
                      <div>
                        <div className={s.t}>Book {svc.label.toLowerCase()}</div>
                        <div className={s.s}>{svc.pro} ★ {svc.rating} · {svc.sub}</div>
                      </div>
                      <span className={s.right}>1 tap <ArrowRight size={14} /></span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* ── Form column (right, 30%) ── */}
      <section className={s.formCol}>
        <div className={s.formTop}>
          <Link href="/" className={s.brand}>
            <span className={s.brandMark}>U</span>
            UpNow
          </Link>
          <div className={s.formTopAlt}>
            New here?<Link href="/#signup">Create account</Link>
          </div>
        </div>

        <div className={s.formInner}>
          {step === 'identify' ? (
            <>
              <div className={s.formHead}>
                <h2>
                  Welcome back
                  <span className={s.serif}>to UpNow.</span>
                </h2>
                <p>Sign in with your phone number or email — we&apos;ll send you a 6-digit code.</p>
              </div>

              <form onSubmit={onRequestOtp} className={s.formBody}>
                {(justReset || emailVerified) && (
                  <div className={cn(s.alert, s.alertSuccess)}>
                    <CheckCircle2 size={15} />
                    {justReset ? 'Password updated. Sign in to continue.' : 'Email verified. Sign in to continue.'}
                  </div>
                )}

                <div className={s.field}>
                  <label className={s.fieldLabel}>Phone or email</label>
                  <div className={s.inputWrap}>
                    <span className={s.inputIcon}>
                      {identifierKind === 'email' ? <Mail size={16} /> : <Phone size={16} />}
                    </span>
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="50 123 4567 or you@example.com"
                      value={identifierRaw}
                      onChange={(e) => setIdentifierRaw(e.target.value)}
                      className={cn(s.input, s.withIcon)}
                      autoFocus
                    />
                  </div>
                  {identifierRaw && identifierKind !== 'unknown' && (
                    <p style={{ fontSize: 12, color: 'var(--mute)', margin: '2px 0 0' }}>
                      We&apos;ll send a 6-digit code to your <strong style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{identifierKind}</strong>.
                    </p>
                  )}
                </div>

                <div className={s.rememberRow}>
                  <label className={s.checkbox}>
                    <input
                      type="checkbox"
                      checked={keepSignedIn}
                      onChange={(e) => setKeepSignedIn(e.target.checked)}
                    />
                    Keep me signed in
                  </label>
                  <span className={s.mono}>Secured · UAE-hosted</span>
                </div>

                {error && (
                  <div className={cn(s.alert, s.alertError)}>
                    <AlertCircle size={15} /> {error}
                  </div>
                )}

                <div className={s.formActions}>
                  <button type="submit" className={s.btnPrimary} disabled={submitting}>
                    {submitting ? 'Sending…' : (<>Send code <ArrowRight size={16} /></>)}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setStep('identify'); setOtp(['', '', '', '', '', '']); setError(null); setDevOtp(null); }}
                className={s.backRow}
              >
                <ArrowLeft size={14} /> Use a different phone or email
              </button>

              <div className={s.formHead}>
                <h2>
                  Enter the code
                  <span className={s.serif}>we just sent.</span>
                </h2>
                <p className={s.codeMeta}>
                  Sent to <strong>{identifierForDisplay}</strong>. The code expires in 10 minutes.
                </p>
              </div>

              <form onSubmit={onVerify} className={s.formBody}>
                {process.env.NODE_ENV !== 'production' && devOtp && (
                  <div className={s.devOtp}>
                    <span>Dev OTP</span>
                    <b>{devOtp}</b>
                  </div>
                )}

                <div className={s.otpGrid}>
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
                      className={cn(s.otpInput, d && s.filled)}
                    />
                  ))}
                </div>

                {error && (
                  <div className={cn(s.alert, s.alertError)}>
                    <AlertCircle size={15} /> {error}
                  </div>
                )}

                <div className={s.resend}>
                  <span>Didn&apos;t get the code?</span>
                  {resendIn > 0 ? (
                    <span className={s.resendTimer}>Resend in {resendIn}s</span>
                  ) : (
                    <button type="button" onClick={onResend} className={s.resendBtn}>
                      Resend code
                    </button>
                  )}
                </div>

                <div className={s.formActions}>
                  <button type="submit" className={s.btnPrimary} disabled={submitting || otp.some((d) => !d)}>
                    {submitting ? 'Verifying…' : (<>Verify &amp; sign in <ArrowRight size={16} /></>)}
                  </button>
                </div>
              </form>
            </>
          )}

          <div className={s.formFoot}>
            <span>© UpNow {new Date().getFullYear()}</span>
            <div className={s.formFootLegal}>
              <Link href="/legal/terms">Terms</Link>
              <Link href="/legal/privacy">Privacy</Link>
              <Link href="/help">Help</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
