'use client';

/**
 * Customer "My Profile" — merged settings + KYC docs into a single page.
 *
 * Layout:
 *   • Hero
 *   • Two columns:
 *       Left: avatar / verification list / profile completion checklist
 *       Right: Personal Info card, Identity card, KYC Documents card
 *   • Sticky save bar slides up when any field is dirty.
 *
 * Backend wiring:
 *   PATCH /auth/me          → firstName, lastName, phone, gender, nationality, emiratesIdNumber
 *   GET   /profiles/customer/me → { profile, checklist } — feeds KycDocumentsPanel
 */

import { useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import {
  User, Mail, Phone, CreditCard, ShieldCheck, BadgeCheck, AlertCircle, Check,
  Camera, FileText, ChevronRight, X, Loader2,
} from 'lucide-react';
import { KycDocumentsPanel } from '@/components/dashboard/KycDocumentsPanel';
import s from './profile.module.css';

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

const NATIONALITIES = [
  'Afghan','Albanian','Algerian','American','Angolan','Argentinian','Armenian','Australian','Austrian',
  'Azerbaijani','Bahraini','Bangladeshi','Belgian','Bolivian','Bosnian','Brazilian','British','Bulgarian',
  'Cambodian','Cameroonian','Canadian','Chilean','Chinese','Colombian','Congolese','Croatian','Cuban',
  'Czech','Danish','Egyptian','Emirati','Ethiopian','Filipino','Finnish','French','Georgian','German',
  'Ghanaian','Greek','Guatemalan','Haitian','Honduran','Hungarian','Indian','Indonesian','Iranian','Iraqi',
  'Irish','Israeli','Italian','Jamaican','Japanese','Jordanian','Kazakh','Kenyan','Korean','Kuwaiti',
  'Lebanese','Libyan','Malaysian','Mexican','Moroccan','Namibian','Nepali','New Zealander','Nigerian',
  'Norwegian','Omani','Pakistani','Palestinian','Paraguayan','Peruvian','Polish','Portuguese','Qatari',
  'Romanian','Russian','Saudi','Serbian','Singaporean','Slovak','Somali','South African','Spanish',
  'Sri Lankan','Sudanese','Swedish','Swiss','Syrian','Taiwanese','Tanzanian','Thai','Tunisian','Turkish',
  'Ugandan','Ukrainian','Venezuelan','Vietnamese','Yemeni','Zambian','Zimbabwean',
].sort();

export default function CustomerProfilePage() {
  const { user, refresh } = useAuth();

  // ── Form state ──
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [phone, setPhone]         = useState('');
  const [gender, setGender]       = useState<'' | 'male' | 'female' | 'other'>('');
  const [nationality, setNationality] = useState('');
  const [emiratesId, setEmiratesId]   = useState('');

  // ── UI state ──
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ── Avatar upload ──
  const [avatarUrl, setAvatarUrl]       = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError]   = useState<string | null>(null);
  const [tenantProfileId, setTenantProfileId] = useState<number | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Track "original" snapshot to know what's dirty
  const [original, setOriginal] = useState<{ firstName: string; lastName: string; phone: string; gender: string; nationality: string; emiratesId: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    const snap = {
      firstName: user.firstName ?? '',
      lastName:  user.lastName ?? '',
      phone:     user.phone ?? '',
      gender:    (user.gender as string) ?? '',
      nationality: user.nationality ?? '',
      emiratesId: user.emiratesIdNumber ?? '',
    };
    setFirstName(snap.firstName);
    setLastName(snap.lastName);
    setPhone(snap.phone);
    setGender((snap.gender as 'male' | 'female' | 'other') || '');
    setNationality(snap.nationality);
    setEmiratesId(snap.emiratesId);
    setOriginal(snap);
    setAvatarUrl(user.profilePictureUrl ?? null);
  }, [user]);

  // Fetch tenant profile id (needed as the upload owner)
  useEffect(() => {
    apiGet<{ profile: { id: number } }>("/profiles/customer/me")
      .then((res) => setTenantProfileId(res?.profile?.id ?? null))
      .catch(() => setTenantProfileId(null));
  }, []);

  const dirty = useMemo(() => {
    if (!original) return false;
    return (
      firstName !== original.firstName ||
      lastName  !== original.lastName  ||
      phone     !== original.phone     ||
      gender    !== original.gender    ||
      nationality !== original.nationality ||
      emiratesId !== original.emiratesId
    );
  }, [original, firstName, lastName, phone, gender, nationality, emiratesId]);

  function discard() {
    if (!original) return;
    setFirstName(original.firstName);
    setLastName(original.lastName);
    setPhone(original.phone);
    setGender((original.gender as 'male' | 'female' | 'other') || '');
    setNationality(original.nationality);
    setEmiratesId(original.emiratesId);
  }

  // ── Avatar upload (presigned URL flow, same pipeline as KYC docs) ──
  const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

  function onAvatarClick() { avatarInputRef.current?.click(); }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
      setAvatarError('Use a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5 MB.');
      return;
    }
    if (!tenantProfileId) {
      setAvatarError('Profile not ready yet. Try again in a moment.');
      return;
    }
    setAvatarError(null);
    setAvatarUploading(true);
    const localPreview = URL.createObjectURL(file);
    setAvatarUrl(localPreview); // instant preview
    try {
      const { uploadUrl, fileUrl, fileKey } = await apiPost<{ uploadUrl: string; fileUrl: string; fileKey: string }>(
        '/documents/upload-url',
        { ownerType: 'customer', ownerId: tenantProfileId, documentKey: 'profile_picture', mimeType: file.type, originalName: file.name },
      );
      const uploadTarget = (() => {
        try {
          const u = new URL(uploadUrl);
          return u.pathname.startsWith('/api/') ? u.pathname + u.search : uploadUrl;
        } catch { return uploadUrl; }
      })();
      const putRes = await fetch(uploadTarget, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!putRes.ok) throw new Error('Upload failed');

      // Register the file as a document so it's tracked (low priority — keep going if it fails)
      try {
        await apiPost('/documents', {
          ownerType: 'customer', ownerId: tenantProfileId,
          category: 'identity', documentKey: 'profile_picture',
          displayName: 'Profile picture', fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3',
        });
      } catch { /* not critical */ }

      // Persist URL on the user record
      await apiPatch('/auth/me', { profilePictureUrl: fileUrl });
      await refresh();
      setAvatarUrl(fileUrl);
    } catch (err) {
      URL.revokeObjectURL(localPreview);
      setAvatarUrl(user?.profilePictureUrl ?? null);
      setAvatarError(err instanceof Error ? err.message : 'Could not upload.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Note: phone is intentionally excluded — PhoneField has its own
      // OTP-verified update flow. Email same — handled by EmailField.
      await apiPatch('/auth/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emiratesIdNumber: emiratesId.trim() || null,
        gender: gender || null,
        nationality: nationality.trim() || null,
      });
      await refresh();
      setOriginal({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), gender, nationality: nationality.trim(), emiratesId: emiratesId.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Derived ──
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || user?.name || 'You';
  const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || (user?.name ?? 'U').charAt(0).toUpperCase();

  const kycStatus = user?.kycStatus ?? 'unverified';
  const kycVerified = ['verified', 'approved'].includes(kycStatus);
  const kycPending = kycStatus === 'pending_review';
  const kycActionRequired = ['rejected', 'action_required'].includes(kycStatus);
  // For customers, the default unverified state is shown as "Open" (neutral) —
  // no urgent warning. Only show the warning state when an admin has explicitly
  // sent KYC back as action-required.
  const kycRowState: 'done' | 'pending' | 'warn' =
    kycVerified ? 'done' :
    kycPending ? 'pending' :
    kycActionRequired ? 'warn' :
    'pending';
  const kycRowSub =
    kycVerified ? 'Identity confirmed' :
    kycPending ? 'Under review' :
    kycActionRequired ? 'Action needed' :
    'Optional — upload anytime';
  const kycRowBadge =
    kycVerified ? 'Verified' :
    kycPending ? 'In review' :
    kycActionRequired ? 'Action needed' :
    'Open';

  // Profile completion checklist
  const completionItems = [
    { key: 'name',        label: 'Add your full name',     done: !!firstName.trim() && !!lastName.trim(), actionTarget: 'firstName' },
    { key: 'phone',       label: 'Add a phone number',     done: !!phone.trim(),                          actionTarget: 'phone'     },
    { key: 'gender',      label: 'Tell us your gender',    done: !!gender,                                actionTarget: 'gender'    },
    { key: 'nationality', label: 'Add your nationality',   done: !!nationality.trim(),                    actionTarget: 'nationality' },
    { key: 'emiratesId',  label: 'Add Emirates ID number', done: !!emiratesId.trim(),                     actionTarget: 'emiratesId' },
    { key: 'emailVerified', label: 'Verify your email',    done: !!user?.emailVerified, actionable: false },
    { key: 'phoneVerified', label: 'Verify your phone',    done: !!user?.phoneVerified, actionable: false },
  ];
  const doneCount = completionItems.filter((i) => i.done).length;
  const completion = Math.round((doneCount / completionItems.length) * 100);

  // Focus a field when its checklist item is clicked
  const fieldRefs = {
    firstName:   useRef<HTMLInputElement>(null),
    phone:       useRef<HTMLInputElement>(null),
    nationality: useRef<HTMLSelectElement>(null),
    emiratesId:  useRef<HTMLInputElement>(null),
    gender:      useRef<HTMLDivElement>(null),
  };
  function focusField(target: string) {
    const ref = (fieldRefs as Record<string, React.RefObject<HTMLElement | null>>)[target];
    ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (ref?.current && 'focus' in ref.current) (ref.current as HTMLElement).focus({ preventScroll: true });
  }

  return (
    <div className={s.app}>
      <div className={s.main}>

        {/* Hero */}
        <div className={s.hero}>
          <h1 className={s.heroTitle}>My profile</h1>
          <p className={s.heroDesc}>Your personal details, identity verification, and uploaded documents — all in one place.</p>
        </div>

        <div className={s.grid}>

          {/* ── Left column ───────────────────────────────────── */}
          <div className={s.colLeft}>

            {/* Avatar card */}
            <div className={cn(s.card, s.avatarCard)}>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={onAvatarChange}
              />
              <div className={s.avatarWrap}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className={s.avatar}
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  <div className={s.avatar}>{initials}</div>
                )}
                <button
                  type="button"
                  className={s.avatarEdit}
                  aria-label="Change photo"
                  onClick={onAvatarClick}
                  disabled={avatarUploading || !tenantProfileId}
                  title={tenantProfileId ? 'Change photo' : 'Setting up — try again in a moment'}
                >
                  {avatarUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                </button>
              </div>
              <div className={s.avatarNm}>{displayName}</div>
              <div className={s.avatarEm}>{user?.email}</div>
              <span className={s.rolePill}>Tenant</span>
              {avatarError && (
                <p className={s.fieldErr} style={{ marginTop: 10, justifyContent: 'center' }}>
                  <AlertCircle size={12} /> {avatarError}
                </p>
              )}
            </div>

            {/* Verification list */}
            <div className={s.card}>
              <div className={s.verifH}>
                <div className={s.verifLbl}>Verification</div>
                <h3 className={s.verifTitle}>Account status</h3>
              </div>
              <ul className={s.verifList} style={{ margin: 0, listStyle: 'none' }}>
                <VerifRow
                  Icon={Mail} title="Email" sub={user?.email}
                  state={user?.emailVerified ? 'done' : 'warn'}
                />
                <VerifRow
                  Icon={Phone} title="Phone" sub={user?.phone || 'Not added'}
                  state={user?.phoneVerified ? 'done' : 'warn'}
                />
                <VerifRow
                  Icon={ShieldCheck} title="KYC" sub={kycRowSub}
                  state={kycRowState} badgeLabel={kycRowBadge}
                />
              </ul>
            </div>

            {/* Completion checklist */}
            <div className={s.card}>
              <div className={s.completionHd}>
                <div className={s.pctBig}>{completion}%</div>
                <div className={s.completionTtls}>
                  <div className={s.completionLbl}>Profile completion</div>
                  <h3 className={s.completionTitle}>{doneCount} of {completionItems.length} steps complete</h3>
                </div>
              </div>
              <div className={s.completionBar}>
                <div className={s.completionFill} style={{ width: `${completion}%` }} />
              </div>

              {completion === 100 ? (
                <div className={s.completionDone}>
                  <span className={s.completionDoneIc}><Check size={14} strokeWidth={3} /></span>
                  Your profile is fully complete.
                </div>
              ) : (
                <ul className={s.completionList} style={{ margin: 0, listStyle: 'none' }}>
                  {completionItems.map((item) => {
                    const actionable = item.actionable !== false && !item.done;
                    return (
                      <li
                        key={item.key}
                        className={cn(s.completionItem, item.done && s.done, actionable && s.actionable)}
                        onClick={() => actionable && item.actionTarget && focusField(item.actionTarget)}
                      >
                        <span className={s.ciMark}>
                          {item.done && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className={s.ciLbl}>{item.label}</span>
                        {actionable && item.actionTarget && (
                          <button
                            type="button"
                            className={s.ciAction}
                            onClick={(e) => { e.stopPropagation(); focusField(item.actionTarget!); }}
                          >
                            Add <ChevronRight size={12} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* ── Right column ──────────────────────────────────── */}
          <div className={s.colRight}>
            <form onSubmit={onSubmit} className={s.colRight} style={{ gap: 14 }}>

              {/* Personal information card */}
              <div className={s.card}>
                <div className={s.cardH}>
                  <span className={s.cardHIc}><User size={15} /></span>
                  <h2>Personal information</h2>
                </div>
                <div className={s.formSection}>
                  <div className={s.formGrid}>
                    <div className={s.field}>
                      <label className={s.fieldLabel}>First name <span className={s.req}>*</span></label>
                      <div className={s.input}>
                        <input ref={fieldRefs.firstName} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Ahmed" />
                      </div>
                    </div>
                    <div className={s.field}>
                      <label className={s.fieldLabel}>Last name <span className={s.req}>*</span></label>
                      <div className={s.input}>
                        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Al Mansouri" />
                      </div>
                    </div>

                    <div className={cn(s.field, s.fieldFull)}>
                      <label className={s.fieldLabel}>Email address</label>
                      <EmailField currentEmail={user?.email ?? ''} verified={!!user?.emailVerified} onUpdated={refresh} />
                    </div>

                    <div className={cn(s.field, s.fieldFull)}>
                      <label className={s.fieldLabel}>Phone number</label>
                      <PhoneField currentPhone={user?.phone ?? ''} verified={!!user?.phoneVerified} onUpdated={refresh} />
                    </div>

                    <div className={s.field}>
                      <label className={s.fieldLabel}>
                        Gender <span className={s.opt}>(optional)</span>
                      </label>
                      <div className={s.seg} ref={fieldRefs.gender} tabIndex={-1}>
                        {(['male','female','other'] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={gender === opt ? s.active : undefined}
                            onClick={() => setGender(gender === opt ? '' : opt)}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={s.field}>
                      <label className={s.fieldLabel}>
                        Nationality <span className={s.opt}>(optional)</span>
                      </label>
                      <div className={cn(s.input, s.dropdown)}>
                        <select ref={fieldRefs.nationality} value={nationality} onChange={(e) => setNationality(e.target.value)}>
                          <option value="">Select nationality…</option>
                          {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Identity card */}
              <div className={s.card}>
                <div className={s.cardH}>
                  <span className={s.cardHIc}><BadgeCheck size={15} /></span>
                  <h2>Identity</h2>
                  <span className={s.cardHMeta}>{kycRowBadge}</span>
                </div>
                <div className={s.formSection}>
                  <div className={s.formGrid}>
                    <div className={cn(s.field, s.fieldFull)}>
                      <label className={s.fieldLabel}>Emirates ID number</label>
                      <div className={s.input}>
                        <span className={s.inputPrefix}><CreditCard size={14} /></span>
                        <input ref={fieldRefs.emiratesId} value={emiratesId} onChange={(e) => setEmiratesId(e.target.value)} placeholder="784-XXXX-XXXXXXX-X" style={{ fontFamily: 'ui-monospace, monospace' }} />
                      </div>
                      <div className={s.fieldHint}>Required for contract generation and Ejari registration.</div>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className={s.fieldErr} style={{ padding: '12px 16px', background: 'var(--danger-bg)', borderRadius: 10 }}>
                  <AlertCircle size={14} /> {error}
                </div>
              )}
            </form>

            {/* KYC Documents */}
            <div className={s.card}>
              <div className={s.cardH}>
                <span className={s.cardHIc}><FileText size={15} /></span>
                <h2>KYC Documents</h2>
              </div>
              <div className={s.docsWrap}>
                <KycDocumentsPanel
                  profileApiPath="/profiles/customer/me"
                  ownerType="customer"
                />
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className={cn(s.saveBar, (dirty || saving || saved) && s.show)}>
        <div className={s.saveBarLeft}>
          {saved ? (
            <span className={s.savedToast}><Check size={13} strokeWidth={3} /> Saved</span>
          ) : dirty ? (
            <>You have <b>unsaved changes</b>.</>
          ) : null}
        </div>
        <div className={s.saveBarRight}>
          {dirty && (
            <button type="button" className={cn(s.btn, s.btnGhost, s.btnSm)} onClick={discard} disabled={saving}>
              <X size={14} /> Discard
            </button>
          )}
          <button type="button" className={cn(s.btn, s.btnGreen, s.btnSm)} disabled={!dirty || saving} onClick={() => onSubmit()}>
            <Check size={14} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Email field with inline edit + OTP re-verification ───
//
// Common case: customers who registered with phone get an auto-generated email
// like `phone-971501234567@upnow.local`. This component lets them swap it for
// a real address and trigger the existing email-verification OTP flow.
function EmailField({
  currentEmail,
  verified,
  onUpdated,
}: {
  currentEmail: string;
  verified: boolean;
  onUpdated: () => Promise<unknown> | void;
}) {
  const isAutoGenerated = /@upnow\.local$/i.test(currentEmail) || /^phone-/.test(currentEmail);
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState(isAutoGenerated ? '' : currentEmail);
  const [step, setStep] = useState<'idle' | 'verifying'>('idle');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Dev-only: backend returns `devOtp` in non-prod responses so testers can
  // verify without waiting for an actual email to arrive.
  const [devOtp, setDevOtp] = useState<string | null>(null);

  async function saveAndSendOtp() {
    const value = next.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setErr('Enter a valid email address');
      return;
    }
    if (value === currentEmail.toLowerCase()) {
      setErr('That is your current email');
      return;
    }
    setBusy(true); setErr(null); setInfo(null); setDevOtp(null);
    try {
      // 1. PATCH the email — backend resets `emailVerified=false`
      await apiPatch('/auth/me', { email: value });
      // 2. Trigger an OTP to the new address using the authed endpoint
      //    (server reads the user's freshly-updated email from the JWT context).
      try {
        const sendRes = await apiPost<{ sent: boolean; devOtp?: string }>('/auth/email/resend', {});
        if (sendRes?.devOtp) setDevOtp(sendRes.devOtp);
      } catch {
        // Non-fatal — user can use "Resend code" inside the verify step
      }
      await onUpdated();
      setStep('verifying');
      setInfo(`We've sent a 6-digit code to ${value}. Enter it below to verify.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update email');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (otp.trim().length !== 6) { setErr('Enter the 6-digit code'); return; }
    setBusy(true); setErr(null); setInfo(null);
    try {
      await apiPost('/auth/email/verify-otp', { email: next.trim().toLowerCase(), code: otp.trim() });
      await onUpdated();
      setEditing(false);
      setStep('idle');
      setOtp('');
      setInfo('Email verified ✓');
      setTimeout(() => setInfo(null), 3000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid or expired code');
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    try {
      const r = await apiPost<{ sent: boolean; devOtp?: string }>('/auth/email/resend', {});
      if (r?.devOtp) setDevOtp(r.devOtp);
      setInfo('A fresh code has been sent.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not resend');
    }
  }

  // Idle (not editing) — show current email + Edit button
  if (!editing) {
    return (
      <>
        <div className={s.input}>
          <span className={s.inputPrefix}><Mail size={14} /></span>
          <input value={currentEmail} readOnly />
          <button type="button" onClick={() => { setEditing(true); setNext(isAutoGenerated ? '' : currentEmail); setErr(null); setInfo(null); }}
            style={{ marginRight: 6, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--color-primary, #2e9f82)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {isAutoGenerated ? 'Set email' : 'Change'}
          </button>
        </div>
        <div className={s.fieldHint}>
          {isAutoGenerated
            ? 'You signed up with phone — add a real email to receive notifications, receipts, and verification codes.'
            : verified
              ? 'Verified — change anytime; you\'ll need to re-verify the new address.'
              : 'Not verified yet — please verify or change.'}
        </div>
        {info && <div className={s.fieldHint} style={{ color: '#2e9f82' }}>{info}</div>}
      </>
    );
  }

  // Step 1 — entering new email
  if (step === 'idle') {
    return (
      <>
        <div className={s.input}>
          <span className={s.inputPrefix}><Mail size={14} /></span>
          <input
            type="email"
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="you@example.com"
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={saveAndSendOtp} disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#2e9f82', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Sending code…' : 'Save & send verification code'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setErr(null); }} disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, background: '#f4f3ef', color: '#3d3b35', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {err && <div className={s.fieldHint} style={{ color: '#dc2626' }}>{err}</div>}
        {info && <div className={s.fieldHint} style={{ color: '#2e9f82' }}>{info}</div>}
      </>
    );
  }

  // Step 2 — verifying OTP
  return (
    <>
      <div className={s.input}>
        <span className={s.inputPrefix}><Mail size={14} /></span>
        <input value={next} readOnly />
      </div>
      <div className={s.fieldHint} style={{ color: '#2e9f82' }}>{info ?? `Code sent to ${next}`}</div>

      {/* Dev-only OTP display — backend returns `devOtp` in non-prod responses
          so testers can verify without waiting for the real email to arrive. */}
      {devOtp && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 8,
          background: '#fef3c7', border: '1px dashed #f59e0b',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <p style={{ fontSize: 9, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>
              Dev mode · OTP
            </p>
            <p style={{ fontSize: 18, color: '#1a1916', fontWeight: 700, margin: '2px 0 0', letterSpacing: '4px', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
              {devOtp}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOtp(devOtp)}
            style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Auto-fill
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit code"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d8d6d0', fontSize: 14, width: 130, letterSpacing: '2px', fontWeight: 600 }}
        />
        <button type="button" onClick={verifyOtp} disabled={busy || otp.length !== 6}
          style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#2e9f82', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy || otp.length !== 6 ? 0.5 : 1 }}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" onClick={resendOtp} disabled={busy}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#6b6860', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Resend code
        </button>
        <button type="button" onClick={() => { setStep('idle'); setOtp(''); setErr(null); setInfo(null); }}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#6b6860', border: 'none', cursor: 'pointer' }}>
          Use different email
        </button>
      </div>
      {err && <div className={s.fieldHint} style={{ color: '#dc2626' }}>{err}</div>}
    </>
  );
}

// ─── Phone field with inline edit + OTP re-verification ───
//
// Mirrors EmailField: changing the phone number requires verifying it via
// the existing phone-OTP flow (POST /auth/otp/request → /auth/otp/verify).
// Backend resets phoneVerified=false when phone changes on PATCH /auth/me.
function PhoneField({
  currentPhone,
  verified,
  onUpdated,
}: {
  currentPhone: string;
  verified: boolean;
  onUpdated: () => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState(currentPhone);
  const [step, setStep] = useState<'idle' | 'verifying'>('idle');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);

  function isValidPhone(p: string) {
    return /^\+?\d{8,16}$/.test(p.replace(/[\s-]/g, ''));
  }

  async function saveAndSendOtp() {
    const value = next.trim().replace(/[\s-]/g, '');
    if (!isValidPhone(value)) {
      setErr('Enter a valid phone (8–16 digits, optional leading +)');
      return;
    }
    if (value === currentPhone.replace(/[\s-]/g, '')) {
      setErr('That is your current phone');
      return;
    }
    setBusy(true); setErr(null); setInfo(null); setDevOtp(null);
    try {
      // 1. PATCH the phone — backend resets `phoneVerified=false`
      await apiPatch('/auth/me', { phone: value });
      // 2. Trigger an OTP — server reads the user's freshly-updated phone from JWT context
      try {
        const sendRes = await apiPost<{ sent: boolean; devOtp?: string; maskedPhone?: string }>('/auth/otp/request', {});
        if (sendRes?.devOtp) setDevOtp(sendRes.devOtp);
        if (sendRes?.maskedPhone) setMaskedPhone(sendRes.maskedPhone);
      } catch {
        // Non-fatal — user can use "Resend code" inside the verify step
      }
      await onUpdated();
      setStep('verifying');
      setInfo(`We've sent a 6-digit code to ${value}. Enter it below to verify.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update phone');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (otp.trim().length !== 6) { setErr('Enter the 6-digit code'); return; }
    setBusy(true); setErr(null); setInfo(null);
    try {
      await apiPost('/auth/otp/verify', { code: otp.trim() });
      await onUpdated();
      setEditing(false);
      setStep('idle');
      setOtp('');
      setInfo('Phone verified ✓');
      setTimeout(() => setInfo(null), 3000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid or expired code');
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    try {
      const r = await apiPost<{ sent: boolean; devOtp?: string }>('/auth/otp/request', {});
      if (r?.devOtp) setDevOtp(r.devOtp);
      setInfo('A fresh code has been sent.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not resend');
    }
  }

  if (!editing) {
    return (
      <>
        <div className={s.input}>
          <span className={s.inputPrefix}><Phone size={14} /></span>
          <input value={currentPhone || ''} readOnly placeholder="No phone number set" />
          <button type="button"
            onClick={() => { setEditing(true); setNext(currentPhone); setErr(null); setInfo(null); setDevOtp(null); }}
            style={{ marginRight: 6, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#2e9f82', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {currentPhone ? 'Change' : 'Add phone'}
          </button>
        </div>
        <div className={s.fieldHint}>
          {!currentPhone
            ? 'Add a phone number to receive SMS notifications and OTP login codes.'
            : verified
              ? 'Verified — change anytime; you\'ll need to re-verify the new number.'
              : 'Not verified yet — please verify or change.'}
        </div>
        {info && <div className={s.fieldHint} style={{ color: '#2e9f82' }}>{info}</div>}
      </>
    );
  }

  if (step === 'idle') {
    return (
      <>
        <div className={s.input}>
          <span className={s.inputPrefix}><Phone size={14} /></span>
          <input
            type="tel"
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="+971 50 123 4567"
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={saveAndSendOtp} disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#2e9f82', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Sending code…' : 'Save & send verification code'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setErr(null); }} disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, background: '#f4f3ef', color: '#3d3b35', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {err && <div className={s.fieldHint} style={{ color: '#dc2626' }}>{err}</div>}
        {info && <div className={s.fieldHint} style={{ color: '#2e9f82' }}>{info}</div>}
      </>
    );
  }

  return (
    <>
      <div className={s.input}>
        <span className={s.inputPrefix}><Phone size={14} /></span>
        <input value={next} readOnly />
      </div>
      <div className={s.fieldHint} style={{ color: '#2e9f82' }}>
        {info ?? `Code sent to ${maskedPhone ?? next}`}
      </div>

      {devOtp && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 8,
          background: '#fef3c7', border: '1px dashed #f59e0b',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <p style={{ fontSize: 9, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, margin: 0 }}>
              Dev mode · OTP
            </p>
            <p style={{ fontSize: 18, color: '#1a1916', fontWeight: 700, margin: '2px 0 0', letterSpacing: '4px', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
              {devOtp}
            </p>
          </div>
          <button type="button" onClick={() => setOtp(devOtp)}
            style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Auto-fill
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit code"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d8d6d0', fontSize: 14, width: 130, letterSpacing: '2px', fontWeight: 600 }}
        />
        <button type="button" onClick={verifyOtp} disabled={busy || otp.length !== 6}
          style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#2e9f82', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy || otp.length !== 6 ? 0.5 : 1 }}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" onClick={resendOtp} disabled={busy}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#6b6860', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Resend code
        </button>
        <button type="button" onClick={() => { setStep('idle'); setOtp(''); setErr(null); setInfo(null); setDevOtp(null); }}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#6b6860', border: 'none', cursor: 'pointer' }}>
          Use different number
        </button>
      </div>
      {err && <div className={s.fieldHint} style={{ color: '#dc2626' }}>{err}</div>}
    </>
  );
}

// ─── Verification row ───
function VerifRow({ Icon, title, sub, state, badgeLabel }: {
  Icon: React.ElementType; title: string; sub?: string | null;
  state: 'done' | 'pending' | 'warn';
  badgeLabel?: string;
}) {
  const defaultLabel = state === 'done' ? 'Verified' : state === 'pending' ? 'In review' : 'Pending';
  return (
    <li className={cn(s.verifItem, state === 'done' && s.done, state === 'warn' && s.warn)}>
      <span className={s.verifIc}><Icon size={15} /></span>
      <div className={s.verifInfo}>
        <div className={s.verifInfoTtl}>{title}</div>
        <div className={s.verifInfoSub}>{sub || '—'}</div>
      </div>
      <span className={cn(
        s.verifBadge,
        state === 'done' ? s.verifBadgeDone : state === 'pending' ? s.verifBadgePending : s.verifBadgeWarn,
      )}>
        {badgeLabel ?? defaultLabel}
      </span>
    </li>
  );
}
