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
      await apiPatch('/auth/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
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
                      <div className={cn(s.input, s.locked)}>
                        <span className={s.inputPrefix}><Mail size={14} /></span>
                        <input value={user?.email ?? ''} readOnly />
                      </div>
                      <div className={s.fieldHint}>Email cannot be changed here. Contact support if needed.</div>
                    </div>

                    <div className={cn(s.field, s.fieldFull)}>
                      <label className={s.fieldLabel}>Phone number</label>
                      <div className={s.input}>
                        <span className={s.inputPrefix}><Phone size={14} /></span>
                        <input ref={fieldRefs.phone} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" />
                      </div>
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
