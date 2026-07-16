/**
 * Landlords directory — the property OWNERS an RP manages on behalf of
 * (leasing_type='management'). A landlord is created once with full details
 * here, then linked to one or more managed properties (with ownership % + POA)
 * from the property form. Reused by the manager (scoped via ?rp=<landlordId>).
 */
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Landmark, Plus, Search, Building2, Mail, Phone, CreditCard, X, Trash2 } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

export interface Landlord {
  id: number;
  name: string;
  ownerType: 'individual' | 'company';
  email: string | null;
  phone: string | null;
  contactAddress: string | null;
  emiratesId: string | null;
  passportNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  tradeLicence: string | null;
  tradeLicenceAuthority: string | null;
  authorizedSignatoryName: string | null;
  hasPoa: boolean;
  poaPersonName: string | null;
  poaPersonPhone: string | null;
  poaPersonEmail: string | null;
  iban: string | null;
  bankName: string | null;
  accountName: string | null;
  notes: string | null;
  propertyCount?: number;
}

const INPUT = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const emptyForm = {
  name: '', ownerType: 'individual' as 'individual' | 'company',
  email: '', phone: '', contactAddress: '',
  emiratesId: '', passportNumber: '', nationality: '', dateOfBirth: '', gender: '',
  tradeLicence: '', tradeLicenceAuthority: '', authorizedSignatoryName: '',
  hasPoa: false, poaPersonName: '', poaPersonPhone: '', poaPersonEmail: '',
  iban: '', bankName: '', accountName: '', notes: '',
};

export default function LandlordsDirectory() {
  const router = useRouter();
  const params = useSearchParams();
  const rp = params.get('rp');
  const rpQ = rp ? `?rp=${rp}` : '';
  const base = rp ? '/dashboard/manager/landlords' : '/rental-provider/dashboard/landlords';

  const [owners, setOwners] = useState<Landlord[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing?: Landlord }>({ open: false });

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Landlord[]>(`/owners${rpQ}`)
      .then((d) => setOwners(Array.isArray(d) ? d : []))
      .catch(() => setOwners([]))
      .finally(() => setLoading(false));
  }, [rpQ]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return owners;
    return owners.filter((o) => [o.name, o.email, o.phone, o.emiratesId, o.tradeLicence].filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [owners, q]);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-bold tracking-[0.12em] uppercase text-[#8a6d2e]">
            <Landmark size={14} /> Landlords
          </div>
          <h1 className="text-2xl font-bold text-[#1a1916] mt-1">Property owners you manage for</h1>
          <p className="text-sm text-[#6b6860] mt-1">Add a landlord once with full details, then link them to managed properties with ownership % and POA.</p>
        </div>
        <button type="button" onClick={() => setModal({ open: true })}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#268a70]">
          <Plus size={16} /> Add landlord
        </button>
      </div>

      <div className="relative max-w-md mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, ID…"
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] text-sm outline-none focus:border-[#2e9f82]" />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center text-[#9b9890]">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center">
          <Landmark size={28} className="mx-auto text-[#c8c6c0]" />
          <p className="text-[#6b6860] mt-3 font-medium">{owners.length === 0 ? 'No landlords yet' : 'No landlords match your search'}</p>
          {owners.length === 0 && <button onClick={() => setModal({ open: true })} className="mt-3 text-sm font-semibold text-[#2e9f82] hover:underline">Add your first landlord</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((o) => (
            <button key={o.id} type="button" onClick={() => router.push(`${base}/${o.id}${rpQ}`)}
              className="text-left rounded-2xl border border-[#e8e6e0] bg-white p-4 hover:shadow-md hover:border-[#c5c2bc] transition">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ background: '#f6f0e0', color: '#8a6d2e' }}>
                  <Landmark size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-[#1a1916] truncate">{o.name}</p>
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#f4f3ef] text-[#9b9890] shrink-0">{o.ownerType}</span>
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-xs text-[#6b6860]">
                    {o.email && <div className="flex items-center gap-1.5 truncate"><Mail size={12} className="shrink-0" /> {o.email}</div>}
                    {o.phone && <div className="flex items-center gap-1.5"><Phone size={12} className="shrink-0" /> {o.phone}</div>}
                    {(o.emiratesId || o.tradeLicence) && <div className="flex items-center gap-1.5 truncate"><CreditCard size={12} className="shrink-0" /> {o.emiratesId || o.tradeLicence}</div>}
                  </div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[#f0ede8] flex items-center gap-1.5 text-xs text-[#8a6d2e] font-medium">
                <Building2 size={13} /> {o.propertyCount ?? 0} propert{(o.propertyCount ?? 0) === 1 ? 'y' : 'ies'} managed
              </div>
            </button>
          ))}
        </div>
      )}

      {modal.open && (
        <LandlordFormModal
          rpQ={rpQ}
          editing={modal.editing}
          onClose={() => setModal({ open: false })}
          onSaved={() => { setModal({ open: false }); load(); }}
        />
      )}
    </div>
  );
}

function LandlordFormModal({ rpQ, editing, onClose, onSaved }: {
  rpQ: string; editing?: Landlord; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState(() => editing ? {
    name: editing.name, ownerType: editing.ownerType, email: editing.email ?? '', phone: editing.phone ?? '',
    contactAddress: editing.contactAddress ?? '',
    emiratesId: editing.emiratesId ?? '', passportNumber: editing.passportNumber ?? '',
    nationality: editing.nationality ?? '', dateOfBirth: editing.dateOfBirth ?? '', gender: editing.gender ?? '',
    tradeLicence: editing.tradeLicence ?? '', tradeLicenceAuthority: editing.tradeLicenceAuthority ?? '',
    authorizedSignatoryName: editing.authorizedSignatoryName ?? '',
    hasPoa: editing.hasPoa ?? false, poaPersonName: editing.poaPersonName ?? '',
    poaPersonPhone: editing.poaPersonPhone ?? '', poaPersonEmail: editing.poaPersonEmail ?? '',
    iban: editing.iban ?? '', bankName: editing.bankName ?? '', accountName: editing.accountName ?? '', notes: editing.notes ?? '',
  } : emptyForm);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim() || saving) return;
    setSaving(true);
    const ind = f.ownerType === 'individual';
    const body = {
      name: f.name.trim(), ownerType: f.ownerType,
      email: f.email || undefined, phone: f.phone || undefined, contactAddress: f.contactAddress || undefined,
      emiratesId: ind ? (f.emiratesId || undefined) : undefined,
      passportNumber: ind ? (f.passportNumber || undefined) : undefined,
      nationality: ind ? (f.nationality || undefined) : undefined,
      dateOfBirth: ind ? (f.dateOfBirth || undefined) : undefined,
      gender: ind ? (f.gender || undefined) : undefined,
      tradeLicence: !ind ? (f.tradeLicence || undefined) : undefined,
      tradeLicenceAuthority: !ind ? (f.tradeLicenceAuthority || undefined) : undefined,
      authorizedSignatoryName: !ind ? (f.authorizedSignatoryName || undefined) : undefined,
      hasPoa: f.hasPoa,
      poaPersonName: f.hasPoa ? (f.poaPersonName || undefined) : undefined,
      poaPersonPhone: f.hasPoa ? (f.poaPersonPhone || undefined) : undefined,
      poaPersonEmail: f.hasPoa ? (f.poaPersonEmail || undefined) : undefined,
      iban: f.iban || undefined, bankName: f.bankName || undefined, accountName: f.accountName || undefined,
      notes: f.notes || undefined,
    };
    try {
      if (editing) await apiPatch(`/owners/${editing.id}${rpQ}`, body);
      else await apiPost(`/owners${rpQ}`, body);
      onSaved();
    } catch (e) {
      alert(`Could not save landlord: ${e instanceof Error ? e.message : 'error'}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1a1916]">{editing ? 'Edit landlord' : 'Add landlord'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center text-[#9b9890] hover:bg-[#f4f3ef]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['individual', 'company'] as const).map((t) => (
              <button key={t} type="button" onClick={() => set('ownerType', t)}
                className={`flex-1 text-sm font-semibold px-3 py-2 rounded-lg border ${f.ownerType === t ? 'border-[#2e9f82] bg-[#e6f7f1] text-[#1f6655]' : 'border-[#e8e6e0] text-[#6b6860]'}`}>
                {t === 'individual' ? 'Individual' : 'Company'}
              </button>
            ))}
          </div>
          <Field label={f.ownerType === 'company' ? 'Company name' : 'Full name'} required>
            <input className={INPUT} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={f.ownerType === 'company' ? 'e.g. Ahmed Trading LLC' : 'e.g. Ahmed Al Mansoori'} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><input className={INPUT} value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Phone"><input className={INPUT} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          </div>
          <Field label="Contact / notices address"><input className={INPUT} value={f.contactAddress} onChange={(e) => set('contactAddress', e.target.value)} /></Field>

          {/* Identity */}
          {f.ownerType === 'individual' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Emirates ID"><input className={INPUT} value={f.emiratesId} onChange={(e) => set('emiratesId', e.target.value)} placeholder="784-XXXX-XXXXXXX-X" /></Field>
                <Field label="Passport no."><input className={INPUT} value={f.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Nationality"><input className={INPUT} value={f.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
                <Field label="Date of birth"><input type="date" className={INPUT} value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
                <Field label="Gender">
                  <select className={INPUT} value={f.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">—</option><option value="male">Male</option><option value="female">Female</option>
                  </select>
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trade licence no."><input className={INPUT} value={f.tradeLicence} onChange={(e) => set('tradeLicence', e.target.value)} /></Field>
                <Field label="Licensing authority"><input className={INPUT} value={f.tradeLicenceAuthority} onChange={(e) => set('tradeLicenceAuthority', e.target.value)} placeholder="e.g. Dubai DED" /></Field>
              </div>
              <Field label="Authorised signatory"><input className={INPUT} value={f.authorizedSignatoryName} onChange={(e) => set('authorizedSignatoryName', e.target.value)} placeholder="Person who signs for the company" /></Field>
            </>
          )}

          {/* Power of Attorney */}
          <div className="pt-1">
            <label className="flex items-center gap-2 text-sm text-[#3f3d39] cursor-pointer">
              <input type="checkbox" checked={f.hasPoa} onChange={(e) => set('hasPoa', e.target.checked)} className="accent-[#2e9f82]" />
              <span className="font-medium">A Power of Attorney authorises someone to act for this owner</span>
            </label>
            {f.hasPoa && (
              <div className="mt-2 space-y-2 rounded-lg bg-[#faf9f6] p-3">
                <Field label="POA holder / authorised signatory"><input className={INPUT} value={f.poaPersonName} onChange={(e) => set('poaPersonName', e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="POA holder phone"><input className={INPUT} value={f.poaPersonPhone} onChange={(e) => set('poaPersonPhone', e.target.value)} /></Field>
                  <Field label="POA holder email"><input className={INPUT} value={f.poaPersonEmail} onChange={(e) => set('poaPersonEmail', e.target.value)} /></Field>
                </div>
                <p className="text-[11px] text-[#9b9890]">Upload the POA deed &amp; ID in the landlord&apos;s Documents (after saving).</p>
              </div>
            )}
          </div>

          <div className="pt-1 text-[11px] font-bold uppercase tracking-wide text-[#9b9890]">Payout bank details</div>
          <Field label="Account name"><input className={INPUT} value={f.accountName} onChange={(e) => set('accountName', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="IBAN"><input className={INPUT} value={f.iban} onChange={(e) => set('iban', e.target.value)} placeholder="AE…" /></Field>
            <Field label="Bank"><input className={INPUT} value={f.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
          </div>
          <Field label="Notes"><textarea className={`${INPUT} min-h-[60px]`} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <p className="text-[11px] text-[#9b9890]">Once saved, link this landlord to a managed property (with ownership % and POA) from the property form.</p>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-semibold px-4 py-2 rounded-lg text-[#6b6860] hover:bg-[#f4f3ef]">Cancel</button>
          <button onClick={save} disabled={!f.name.trim() || saving} className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add landlord'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#6b6860] mb-1">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
    </label>
  );
}
