'use client';

import { useState } from 'react';

export interface CustomerInitial {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  emiratesIdNumber?: string | null;
  nationality?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  entityType?: string | null;
  companyName?: string | null;
}

const field = 'w-full rounded-xl border border-[#e8e6e0] bg-white px-3 py-2 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]';
const label = 'block text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-1';

/**
 * Create or edit a customer. `create` posts name/email/phone (+ company);
 * `edit` patches the fuller profile (name parts, contact, EID, KYC fields).
 * Login for new customers is email OTP — no password.
 */
export function CustomerForm({ mode, initial, submitUrl, method, onDone, onCancel }: {
  mode: 'create' | 'edit';
  initial?: CustomerInitial;
  submitUrl: string;
  method: 'POST' | 'PATCH';
  onDone: (result: { tenantId?: number; name?: string | null }) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [emiratesIdNumber, setEid] = useState(initial?.emiratesIdNumber ?? '');
  const [nationality, setNationality] = useState(initial?.nationality ?? '');
  const [gender, setGender] = useState(initial?.gender ?? '');
  const [dateOfBirth, setDob] = useState((initial?.dateOfBirth ?? '').slice(0, 10));
  const [entityType, setEntityType] = useState<'individual' | 'company'>(initial?.entityType === 'company' ? 'company' : 'individual');
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const fullName = `${firstName} ${lastName}`.trim();
    if (!firstName.trim()) { setErr('First name is required'); return; }
    if (mode === 'create' && !email.trim()) { setErr('Email is required'); return; }
    setBusy(true); setErr(null);
    const body = mode === 'create'
      ? {
          name: fullName, email: email.trim(), phone: phone.trim() || undefined,
          entityType, companyName: entityType === 'company' ? (companyName.trim() || undefined) : undefined,
        }
      : {
          firstName: firstName.trim() || null, lastName: lastName.trim() || null,
          phone: phone.trim() || null, email: email.trim() || undefined,
          emiratesIdNumber: emiratesIdNumber.trim() || null, nationality: nationality.trim() || null,
          gender: gender.trim() || null, dateOfBirth: dateOfBirth || null,
          entityType, companyName: entityType === 'company' ? (companyName.trim() || null) : null,
        };
    try {
      const res = await fetch(submitUrl, {
        method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string })?.message ?? 'Save failed'); }
      const d = await res.json().catch(() => ({}));
      onDone(d as { tenantId?: number; name?: string | null });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={label}>First name</label><input className={field} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" /></div>
        <div><label className={label}>Last name</label><input className={field} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" /></div>
        <div><label className={label}>Email</label><input className={field} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" /></div>
        <div><label className={label}>Phone</label><input className={field} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+9715…" /></div>
        <div>
          <label className={label}>Type</label>
          <select className={field} value={entityType} onChange={e => setEntityType(e.target.value as 'individual' | 'company')}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </div>
        {entityType === 'company' && (
          <div><label className={label}>Company name</label><input className={field} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Company name" /></div>
        )}
        {mode === 'edit' && (
          <>
            <div><label className={label}>Emirates ID</label><input className={field} value={emiratesIdNumber} onChange={e => setEid(e.target.value)} placeholder="784-YYYY-NNNNNNN-D" /></div>
            <div><label className={label}>Nationality</label><input className={field} value={nationality} onChange={e => setNationality(e.target.value)} placeholder="e.g. Emirati" /></div>
            <div>
              <label className={label}>Gender</label>
              <select className={field} value={gender} onChange={e => setGender(e.target.value)}>
                <option value="">—</option><option value="male">Male</option><option value="female">Female</option>
              </select>
            </div>
            <div><label className={label}>Date of birth</label><input className={field} type="date" value={dateOfBirth} onChange={e => setDob(e.target.value)} /></div>
          </>
        )}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className="text-sm font-semibold px-4 py-2 rounded-xl bg-[#2e9f82] text-white disabled:opacity-60">
          {busy ? 'Saving…' : mode === 'create' ? 'Create customer' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-medium px-4 py-2 rounded-xl border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">Cancel</button>
      </div>
      {mode === 'create' && <p className="text-[11px] text-[#9b9890]">They&apos;ll sign in with this email via a one-time code — no password needed.</p>}
    </div>
  );
}
