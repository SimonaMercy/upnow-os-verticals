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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import {
  User, Mail, Phone, CreditCard, ShieldCheck, BadgeCheck, AlertCircle, Check,
  Camera, FileText, ChevronRight, X, Loader2,
} from 'lucide-react';
import { KycDocumentsPanel } from '@/components/dashboard/KycDocumentsPanel';
import { openDocViewer } from '@/lib/docViewer';
import { RESIDENTIAL_RENTAL_DOCS } from '@/lib/docRequirements';
import { NATIONALITIES, normalizeNationality } from '@/lib/nationalities';
import { authorityName, isKnownAuthority, licenseAuthorityGroups } from '@/lib/tradeLicenseAuthorities';
import s from './profile.module.css';

const cn = (...x: Array<string | false | null | undefined>) => x.filter(Boolean).join(' ');

// Country names, shared with the Step 2 KYC form — both write users.nationality,
// so they must offer the same options. An older demonym value ("Pakistani") is
// snapped to its country on load rather than showing the field as blank.

export default function CustomerProfilePage() {
  const { user, refresh } = useAuth();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  // ── Form state ──
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [phone, setPhone]         = useState('');
  const [gender, setGender]       = useState<'' | 'male' | 'female'>('');
  const [nationality, setNationality] = useState('');
  const [emiratesId, setEmiratesId]   = useState('');

  // ── UI state ──
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ── OCR scanning state ──
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrExtracted, setOcrExtracted] = useState(false);
  const ocrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startOcrPolling = () => {
    setOcrScanning(true);
    setOcrExtracted(false);
    let attempts = 0;
    const MAX_ATTEMPTS = 12; // 24s max
    ocrPollRef.current = setInterval(async () => {
      attempts++;
      try {
        await refresh();
      } catch { /* ignore */ }
      // Check if user data has been populated by OCR (accessed via closure — stale, so we re-read from auth)
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(ocrPollRef.current!);
        setOcrScanning(false);
      }
    }, 2000);
  };

  // When `user` changes (refresh returned new data) while OCR is scanning → auto-fill + stop
  const prevOcrUserRef = useRef<typeof user>(null);
  useEffect(() => {
    if (!ocrScanning) return;
    if (!user) return;
    const prev = prevOcrUserRef.current;
    const hasNewData =
      (user.firstName && user.firstName !== prev?.firstName) ||
      (user.emiratesIdNumber && user.emiratesIdNumber !== prev?.emiratesIdNumber);
    if (hasNewData) {
      clearInterval(ocrPollRef.current!);
      setOcrScanning(false);
      setOcrExtracted(true);
      // Auto-fill form fields that are currently empty
      if (user.firstName  && !firstName)   setFirstName(user.firstName);
      if (user.lastName   && !lastName)    setLastName(user.lastName);
      if (user.nationality && !nationality) setNationality(normalizeNationality(user.nationality));
      if (user.emiratesIdNumber && !emiratesId) setEmiratesId(user.emiratesIdNumber);
      if (user.gender && !gender && (user.gender === 'male' || user.gender === 'female')) setGender(user.gender);
      setTimeout(() => setOcrExtracted(false), 5000);
    }
    prevOcrUserRef.current = user;
  }, [user, ocrScanning]);

  useEffect(() => () => { if (ocrPollRef.current) clearInterval(ocrPollRef.current); }, []);

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
    setGender((snap.gender === 'male' || snap.gender === 'female') ? snap.gender : '');
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
    setGender((original.gender === 'male' || original.gender === 'female') ? original.gender : '');
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

  async function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!firstName.trim()) {
      setError('First name is required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Note: phone is intentionally excluded — PhoneField has its own
      // OTP-verified update flow. Email same — handled by EmailField.
      await apiPatch('/auth/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
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
    { key: 'name',        label: 'Add your name',          done: !!firstName.trim(),                      actionTarget: 'firstName' },
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

        {/* ReturnTo banner — shown when arriving from interest flow */}
        {returnTo && (user?.kycStatus === 'verified' || user?.kycStatus === 'pending_review') && (
          <div style={{ background: '#d8efe3', border: '1px solid #047246', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <p style={{ fontSize: 14, color: '#1f5a3f', fontWeight: 600, margin: 0 }}>KYC complete — you can now continue your application.</p>
            <Link href={returnTo} style={{ fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', background: '#047246', color: '#fff', borderRadius: 8, padding: '7px 14px' }}>
              Continue →
            </Link>
          </div>
        )}

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
              <span className={s.rolePill}>Customer</span>
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
                      <label className={s.fieldLabel}>Last name</label>
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
                        {(['male','female'] as const).map((opt) => (
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
                          {/* Keep a stored value that isn't on the list selectable,
                              so opening this page can't silently blank it. */}
                          {nationality && !NATIONALITIES.includes(nationality) && (
                            <option value={nationality}>{nationality}</option>
                          )}
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
                      <div className={s.fieldHint}>Required for contract generation and Contract Registration.</div>
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
                {ocrScanning && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(4,114,70,0.08)', border: '1px solid rgba(4,114,70,0.3)', marginBottom: 12 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--color-primary, #047246)', flexShrink: 0, animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    <span style={{ fontSize: 13, color: '#1a6b57', fontWeight: 500 }}>Scanning Emirates ID — extracting your details…</span>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                )}
                {ocrExtracted && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(4,114,70,0.08)', border: '1px solid rgba(4,114,70,0.3)', marginBottom: 12 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--color-primary, #047246)', flexShrink: 0 }}><path d="M20 6 9 17l-5-5" /></svg>
                    <span style={{ fontSize: 13, color: '#1a6b57', fontWeight: 500 }}>Details extracted — your form has been filled in automatically.</span>
                  </div>
                )}
                <KycDocumentsPanel
                  profileApiPath="/profiles/customer/me"
                  ownerType="customer"
                  onAfterUpload={key => { if (key === 'emirates_id') startOcrPolling(); }}
                />
              </div>
            </div>

            {/* Renting as individual / company (commercial tenants) */}
            <CompanyTenantCard />

            {/* Additional / Rental Documents */}
            <div className={s.card}>
              <div className={s.cardH}>
                <span className={s.cardHIc}><FileText size={15} /></span>
                <h2>Additional Documents</h2>
              </div>
              <div className={s.docsWrap}>
                <AdditionalDocumentsSection tenantProfileId={tenantProfileId} />
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

// ─── Additional (rental) documents section ────────────────────────────────────

interface MyDoc { documentKey: string; status: string | null; fileUrl: string | null; mimeType: string | null; }

const ALLOWED_DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function AdditionalDocumentsSection({ tenantProfileId }: { tenantProfileId: number | null }) {
  const [myDocs, setMyDocs]         = useState<MyDoc[]>([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState<string | null>(null);
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [previews, setPreviews]     = useState<Record<string, { url: string; mime: string }>>({});
  const fileRef                     = useRef<HTMLInputElement>(null);
  const pendingKey                  = useRef<string | null>(null);

  const load = () => {
    setLoading(true);
    apiGet<{ documents: MyDoc[] }>('/documents/my')
      .then(r => setMyDocs(r.documents ?? []))
      .catch(() => setMyDocs([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const byKey = new Map(myDocs.map(d => [d.documentKey, d]));

  const handleUpload = (key: string) => { pendingKey.current = key; fileRef.current?.click(); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const key = pendingKey.current;
    e.target.value = '';
    if (!file || !key || !tenantProfileId) return;
    if (!ALLOWED_DOC_MIME.includes(file.type)) {
      setErrors(p => ({ ...p, [key]: 'Only JPG, PNG, WebP or PDF files are allowed.' }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors(p => ({ ...p, [key]: 'File must be under 10 MB.' }));
      return;
    }
    setErrors(p => { const n = { ...p }; delete n[key]; return n; });
    setUploading(key);
    const localUrl = URL.createObjectURL(file);
    try {
      const doc = RESIDENTIAL_RENTAL_DOCS.find(d => d.key === key)!;
      const { uploadUrl, fileUrl, fileKey } = await apiPost<{ uploadUrl: string; fileUrl: string; fileKey: string }>(
        '/documents/upload-url',
        { ownerType: 'customer', ownerId: tenantProfileId, documentKey: key, mimeType: file.type, originalName: file.name },
      );
      const target = (() => { try { const u = new URL(uploadUrl); return u.pathname.startsWith('/api/') ? u.pathname + u.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('Upload to storage failed');
      await apiPost('/documents', {
        ownerType: 'customer', ownerId: tenantProfileId,
        category: doc.category, documentKey: key,
        displayName: doc.label, fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3',
      });
      setPreviews(p => ({ ...p, [key]: { url: localUrl, mime: file.type } }));
      load();
    } catch (err) {
      URL.revokeObjectURL(localUrl);
      setErrors(p => ({ ...p, [key]: err instanceof Error ? err.message : 'Upload failed. Try again.' }));
    } finally {
      setUploading(null);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 0' }}>
      <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
      <span style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>Loading…</span>
    </div>
  );

  const required = RESIDENTIAL_RENTAL_DOCS.filter(d => d.required);
  const optional = RESIDENTIAL_RENTAL_DOCS.filter(d => !d.required);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" style={{ display: 'none' }} onChange={handleFileChange} />
      <p style={{ fontSize: 13, color: 'var(--color-neutral-500)', margin: 0 }}>
        These documents are required to proceed with a rental application.
      </p>

      {[{ title: 'Required', docs: required }, { title: 'Optional', docs: optional }].map(({ title, docs }) => (
        <div key={title}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-neutral-400)', margin: '0 0 8px' }}>{title}</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {docs.map(doc => {
              const existing = byKey.get(doc.key);
              const uploaded = !!existing?.fileUrl || !!previews[doc.key];
              const preview = previews[doc.key];
              const previewUrl = preview?.url ?? existing?.fileUrl;
              const mime = preview?.mime ?? existing?.mimeType ?? '';
              const isImg = mime.startsWith('image/');
              const isUploading = uploading === doc.key;

              return (
                <div key={doc.key} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14,
                  border: `1.5px solid ${uploaded ? 'rgba(34,197,94,0.35)' : errors[doc.key] ? '#ef4444' : 'var(--color-base-200)'}`,
                  background: uploaded ? 'rgba(34,197,94,0.04)' : 'white',
                }}>
                  {/* Status icon */}
                  <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: uploaded ? 'rgba(34,197,94,0.12)' : 'var(--color-base-100)' }}>
                    {uploaded
                      ? <Check size={18} style={{ color: '#22c55e' }} />
                      : <FileText size={18} style={{ color: 'var(--color-neutral-400)' }} />}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-900)', margin: 0 }}>{doc.label}</p>
                    {doc.hint && <p style={{ fontSize: 11, color: 'var(--color-neutral-500)', margin: '2px 0 0' }}>{doc.hint}</p>}
                    {errors[doc.key] && <p style={{ fontSize: 11, color: '#ef4444', margin: '4px 0 0' }}>{errors[doc.key]}</p>}
                    {previewUrl && (
                      <div style={{ marginTop: 8 }}>
                        {isImg
                          ? <button type="button" onClick={() => openDocViewer({ fileUrl: previewUrl, caption: doc.label, mimeType: mime })} style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><img src={previewUrl} alt={doc.label} style={{ width: 100, height: 68, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} /></button>
                          : <button type="button" onClick={() => openDocViewer({ fileUrl: previewUrl, caption: doc.label, mimeType: mime })} style={{ fontSize: 12, color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}><FileText size={13} /> View PDF</button>}
                      </div>
                    )}
                  </div>

                  {/* Upload button */}
                  <button type="button" onClick={() => handleUpload(doc.key)} disabled={isUploading}
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', cursor: isUploading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: isUploading ? 0.6 : 1, background: uploaded ? 'var(--color-base-100)' : 'var(--color-primary)', color: uploaded ? 'var(--color-neutral-600)' : '#fff' }}>
                    {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                    {uploaded ? 'Replace' : 'Upload'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
            style={{ marginRight: 6, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'var(--color-primary, #047246)', color: '#fff', border: 'none', cursor: 'pointer' }}>
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
        {info && <div className={s.fieldHint} style={{ color: '#047246' }}>{info}</div>}
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
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#047246', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Sending code…' : 'Save & send verification code'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setErr(null); }} disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, background: '#eef1ef', color: '#46534c', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {err && <div className={s.fieldHint} style={{ color: '#dc2626' }}>{err}</div>}
        {info && <div className={s.fieldHint} style={{ color: '#047246' }}>{info}</div>}
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
      <div className={s.fieldHint} style={{ color: '#047246' }}>{info ?? `Code sent to ${next}`}</div>

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
            <p style={{ fontSize: 18, color: '#14201a', fontWeight: 700, margin: '2px 0 0', letterSpacing: '4px', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
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
          style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#047246', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy || otp.length !== 6 ? 0.5 : 1 }}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" onClick={resendOtp} disabled={busy}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#5f6b63', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Resend code
        </button>
        <button type="button" onClick={() => { setStep('idle'); setOtp(''); setErr(null); setInfo(null); }}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#5f6b63', border: 'none', cursor: 'pointer' }}>
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
            style={{ marginRight: 6, padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#047246', color: '#fff', border: 'none', cursor: 'pointer' }}>
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
        {info && <div className={s.fieldHint} style={{ color: '#047246' }}>{info}</div>}
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
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#047246', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Sending code…' : 'Save & send verification code'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setErr(null); }} disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, background: '#eef1ef', color: '#46534c', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {err && <div className={s.fieldHint} style={{ color: '#dc2626' }}>{err}</div>}
        {info && <div className={s.fieldHint} style={{ color: '#047246' }}>{info}</div>}
      </>
    );
  }

  return (
    <>
      <div className={s.input}>
        <span className={s.inputPrefix}><Phone size={14} /></span>
        <input value={next} readOnly />
      </div>
      <div className={s.fieldHint} style={{ color: '#047246' }}>
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
            <p style={{ fontSize: 18, color: '#14201a', fontWeight: 700, margin: '2px 0 0', letterSpacing: '4px', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
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
          style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: '#047246', color: '#fff', border: 'none', cursor: 'pointer', opacity: busy || otp.length !== 6 ? 0.5 : 1 }}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" onClick={resendOtp} disabled={busy}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#5f6b63', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Resend code
        </button>
        <button type="button" onClick={() => { setStep('idle'); setOtp(''); setErr(null); setInfo(null); setDevOtp(null); }}
          style={{ padding: '6px 10px', fontSize: 12, background: 'transparent', color: '#5f6b63', border: 'none', cursor: 'pointer' }}>
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

/**
 * "Renting as" card — lets a customer declare individual vs company and, for a
 * company, capture the company name + trade licence used as the tenant party on
 * the Ejari tenancy contract. Self-contained: reads/writes /profiles/customer/me.
 */
function CompanyTenantCard() {
  const [loading, setLoading] = useState(true);
  const [isCompany, setIsCompany] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [licenseAuth, setLicenseAuth] = useState('');
  const [licenseAuthOther, setLicenseAuthOther] = useState(false);
  const [trn, setTrn] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<{ profile: { entityType?: string; companyName?: string | null; tradeLicenseNumber?: string | null; tradeLicenseAuthority?: string | null; vatTrn?: string | null } }>('/profiles/customer/me')
      .then(({ profile }) => {
        if (!alive) return;
        setIsCompany(profile?.entityType === 'company');
        setCompanyName(profile?.companyName ?? '');
        setLicenseNo(profile?.tradeLicenseNumber ?? '');
        setLicenseAuth(profile?.tradeLicenseAuthority ?? '');
        setTrn(profile?.vatTrn ?? '');
        setLicenseAuthOther(!!profile?.tradeLicenseAuthority && !isKnownAuthority(profile.tradeLicenseAuthority));
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function save() {
    setSaving(true); setErr(null);
    try {
      await apiPatch('/profiles/customer/me', {
        entityType: isCompany ? 'company' : 'individual',
        companyName: isCompany ? companyName.trim() : '',
        tradeLicenseNumber: isCompany ? licenseNo.trim() : '',
        tradeLicenseAuthority: isCompany ? licenseAuth.trim() : '',
        vatTrn: isCompany ? trn.trim() : '',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 9,
    border: '1px solid #e4e9e5', fontSize: 13, color: '#14201a', outline: 'none',
  };
  const seg = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#047246' : '#e4e9e5'}`,
    background: active ? 'rgba(4,114,70,0.08)' : '#fff',
    color: active ? '#1a6b57' : '#5f6b63',
  });

  return (
    <div className={s.card}>
      <div className={s.cardH}>
        <span className={s.cardHIc}><FileText size={15} /></span>
        <h2>Renting as</h2>
      </div>
      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setIsCompany(false)} style={seg(!isCompany)}>Individual</button>
          <button type="button" onClick={() => setIsCompany(true)} style={seg(isCompany)}>Company</button>
        </div>
        {isCompany && (
          <>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5f6b63', marginBottom: 4 }}>Company Name</label>
              <input style={inputStyle} placeholder="As on the trade licence" value={companyName} onChange={e => setCompanyName(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5f6b63', marginBottom: 4 }}>Trade License No.</label>
                <input style={inputStyle} placeholder="e.g. CN-1234567" value={licenseNo} onChange={e => setLicenseNo(e.target.value)} />
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5f6b63', marginBottom: 4 }}>Licensing Authority</label>
                {/* Same picker as the tenancy journey — stored as the licence's
                    short code, with "Other" for anything not listed. */}
                {/* Short codes only — a native select is as wide as its longest
                    option, and the full names overflowed the column. */}
                <select
                  style={{ ...inputStyle, width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}
                  value={licenseAuthOther ? '__other__' : licenseAuth}
                  onChange={e => {
                    if (e.target.value === '__other__') { setLicenseAuthOther(true); setLicenseAuth(''); }
                    else { setLicenseAuthOther(false); setLicenseAuth(e.target.value); }
                  }}
                >
                  <option value="">Select…</option>
                  {licenseAuthorityGroups().map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map(a => <option key={a.code} value={a.code} title={a.name}>{a.code}</option>)}
                    </optgroup>
                  ))}
                  <option value="__other__">Other…</option>
                </select>
                {licenseAuthOther ? (
                  <input style={{ ...inputStyle, marginTop: 6 }} placeholder="Name of the issuing authority" value={licenseAuth} onChange={e => setLicenseAuth(e.target.value)} />
                ) : authorityName(licenseAuth) ? (
                  <p style={{ fontSize: 10.5, color: '#8a948d', margin: '4px 0 0', lineHeight: 1.35 }}>{authorityName(licenseAuth)}</p>
                ) : null}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#5f6b63', marginBottom: 4 }}>TRN (Tax Registration No.)</label>
              <input style={inputStyle} placeholder="e.g. 100123456700003 — if VAT-registered" value={trn} onChange={e => setTrn(e.target.value)} />
            </div>
            <p style={{ fontSize: 11, color: '#8a948d', margin: 0 }}>
              Used as the tenant on your tenancy contract. For commercial / industrial leases your Trade License & MOA become required documents.
            </p>
          </>
        )}
        {err && <p style={{ fontSize: 12, color: '#c0392b', margin: 0 }}>{err}</p>}
        <div>
          <button onClick={save} disabled={saving}
            style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: '#047246', color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
