'use client';

/**
 * One vendor form for Add and Edit (owner, 10 Sep 2026: "no option to edit the
 * vendor's details … no option to attach their trade licence … form is not
 * properly arranged"). Four sections, top to bottom:
 *   1. Vendor      — type, name, what they're for, payment frequency
 *   2. Company     — entity, relationship, contact person, address, trade licence (number · valid till · copy)
 *   3. Contact     — phone, email (locked once the vendor has accepted the invite)
 *   4. Trades      — service vendors only
 * A RECORD (utility, government, …) asks for less (owner, 30 Sep 2026: "we
 * don't need trade license or too many information, just to keep records and
 * payment frequency only"): contact person moves into Contact, and Company —
 * address, trade licence — stays folded away unless asked for or already filled.
 * The licence copy is filed against the vendor record after the save, then
 * linked to it; the number and validity are kept on the record either way.
 */
import { useEffect, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { openDocViewer } from '@/lib/docViewer';

const url = (base: string, rp: number | null | undefined, path: string) => rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;
/** 0279 adds landlord (head landlord / authority the rent goes to) and internal (employees). */
export type VendorKind = 'service' | 'utility' | 'government' | 'insurance' | 'supplier' | 'landlord' | 'internal';
export interface VendorFormValue {
  serviceProviderId: number; name: string; kind: VendorKind; category: string | null; expenseCategoryId?: number | null;
  relationship: 'internal_team' | 'contracted_vendor'; entityType: string | null;
  phone: string | null; email: string | null; inviteStatus: 'not_invited' | 'invited' | 'accepted';
  trades: { id: number; name: string }[];
  contactName?: string | null; address?: string | null;
  tradeLicence?: { number: string | null; expiry: string | null; doc: { id: number; fileUrl: string; displayName: string | null } | null } | null;
  paymentFrequency?: string | null;
}
interface Group { id: number; name: string }

export const KIND_LABEL: Record<VendorKind, string> = { service: 'Service', utility: 'Utility', government: 'Government', insurance: 'Insurance', supplier: 'Supplier', landlord: 'Head landlord', internal: 'Internal' };
/** 0345 — the same cadences as an AMC contract, which starts from the vendor's. */
export const PAY_FREQ_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually', one_time: 'One-time' };
const KIND_HINT: Record<VendorKind, string> = {
  service: 'e.g. Elevator Maintenance, Pest Control', utility: 'e.g. Utility – Power, Utility – Water',
  government: 'e.g. Land Renewal, Municipal Fees', insurance: 'e.g. Building Insurance', supplier: 'e.g. Cleaning Material',
  landlord: 'e.g. Land Renewal, Main Lease, Sub Lease Tax', internal: 'e.g. Employee Salary',
};

const field = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2.5 text-sm bg-white text-[#1a1916] placeholder:text-[#b8b5ad] focus:outline-none focus:border-[#2e9f82] focus:ring-2 focus:ring-[#2e9f82]/15 disabled:bg-[#f9f8f6] disabled:text-[#9b9890]';
const label = 'block text-[12px] font-semibold text-[#4a4842] mb-1';
const hint = 'text-[11.5px] text-[#9b9890] mt-1';
const chipCls = (on: boolean, disabled = false) => `px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${on ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e8e6e0] hover:border-[#c9c6be]'} ${disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'}`;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline gap-2 border-b border-[#f0eee8] pb-1.5">
        <h3 className="text-[11px] font-bold tracking-[.08em] uppercase text-[#8a8f8c]">{title}</h3>
        {sub && <span className="text-[11.5px] text-[#9b9890]">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

export function VendorForm({ mode, initial, groups, onClose, onDone, base = '/maintenance', rp = null }: {
  mode: 'add' | 'edit'; initial?: VendorFormValue | null; groups: Group[]; onClose: () => void; onDone: () => void;
  /** '/maintenance' for the landlord, '/manager/maintenance' (+ rp) for a manager. */
  base?: string; rp?: number | null;
}) {
  const v = initial ?? null;
  const [name, setName] = useState(v?.name ?? '');
  const [kind, setKind] = useState<VendorKind>(v?.kind ?? 'service');
  const [category, setCategory] = useState(v?.category ?? '');
  // 0284 — what they're for is a sub-category of the contracts book (owner, 13 Sep: the vendor is primary; AMCs inherit it).
  const [categoryId, setCategoryId] = useState<number | null>(v?.expenseCategoryId ?? null);
  const [cats, setCats] = useState<{ id: number; name: string; defaultKind: string; isActive: boolean }[]>([]);
  const [newCat, setNewCat] = useState(false);
  useEffect(() => { apiGet<typeof cats>(rp != null ? `/manager/amc/categories?rp=${rp}` : '/amc/categories').then(setCats).catch(() => setCats([])); }, [rp]);
  const [relationship, setRelationship] = useState<'contracted_vendor' | 'internal_team'>(v?.relationship ?? 'contracted_vendor');
  const [entityType, setEntityType] = useState<'company' | 'individual'>(v?.entityType === 'individual' ? 'individual' : 'company');
  const [contactName, setContactName] = useState(v?.contactName ?? '');
  const [address, setAddress] = useState(v?.address ?? '');
  const [licNo, setLicNo] = useState(v?.tradeLicence?.number ?? '');
  const [licExpiry, setLicExpiry] = useState(v?.tradeLicence?.expiry ?? '');
  const [licFile, setLicFile] = useState<File | null>(null);
  const [phone, setPhone] = useState(v?.phone ?? '');
  const [email, setEmail] = useState(v?.email ?? '');
  const [trades, setTrades] = useState<number[]>(v?.trades.map(t => t.id) ?? []);
  const [payFreq, setPayFreq] = useState(v?.paymentFrequency ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // A record's Company block opens on request — or at once when something is already in it.
  const [showCompany, setShowCompany] = useState(!!(v?.address || v?.entityType === 'individual' || v?.tradeLicence?.number || v?.tradeLicence?.expiry || v?.tradeLicence?.doc));

  const service = kind === 'service';
  const company = entityType === 'company';
  const kindLocked = mode === 'edit' && v?.inviteStatus !== 'not_invited';
  const contactLocked = mode === 'edit' && v?.inviteStatus === 'accepted';
  const existingDoc = v?.tradeLicence?.doc ?? null;
  const today = new Date().toISOString().slice(0, 10);

  const submit = async () => {
    if (!name.trim()) { setErr('The vendor needs a name.'); return; }
    if (licExpiry && licExpiry < today && !confirm('The trade licence date is in the past — save it as expired?')) return;
    setErr(null); setBusy('Saving…');
    try {
      const details = {
        contactName: contactName.trim() || null, address: address.trim() || null,
        tradeLicenceNumber: licNo.trim() || null, tradeLicenceExpiry: licExpiry || null,
        paymentFrequency: payFreq || null,
      };
      let spId = v?.serviceProviderId ?? null;
      if (mode === 'add') {
        const created = await apiPost<{ serviceProviderId: number }>(url(base, rp, '/vendors'), {
          name: name.trim(), kind, ...(category.trim() ? { category: category.trim() } : {}), expenseCategoryId: newCat ? null : categoryId,
          relationship: service ? relationship : 'contracted_vendor', entityType,
          ...(phone.trim() ? { phone: phone.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}),
          ...(service && trades.length ? { trades } : {}), ...details,
        });
        spId = created?.serviceProviderId ?? null;
      } else {
        await apiPatch(url(base, rp, `/vendors/${spId}`), {
          name: name.trim(), kind, category: category.trim() || null, expenseCategoryId: newCat ? null : categoryId,
          relationship: service ? relationship : 'contracted_vendor', entityType,
          ...(contactLocked ? {} : { phone: phone.trim(), email: email.trim() }),
          ...(service ? { trades } : {}), ...details,
        });
      }
      if (licFile && spId != null) {
        setBusy('Filing the trade licence…');
        const { id } = await uploadOwnedDocument({
          ownerType: 'service_provider', ownerId: spId, documentKey: 'trade_license', category: 'license',
          displayName: `Trade licence${licNo.trim() ? ` · ${licNo.trim()}` : ''}`, file: licFile,
          documentNumber: licNo.trim() || null, expiryDate: licExpiry || null,
        });
        if (id != null) await apiPatch(url(base, rp, `/vendors/${spId}`), { tradeLicenceDocId: id });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the vendor.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(26,25,22,0.45)' }} onClick={onClose}>
      <form className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (!busy) void submit(); }}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#f0eee8] sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-[#1a1916]">{mode === 'add' ? 'Add a vendor' : 'Edit vendor'}</h2>
            <p className="text-[12.5px] text-[#9b9890] mt-0.5">{mode === 'add' ? 'Your roster — service companies, your own crew, and the records behind your expenses.' : `Your record of ${v?.name ?? 'this vendor'}.`}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer mt-1" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 grid gap-6">
          {/* 1 · Vendor */}
          <Section title="Vendor">
            <div>
              <span className={label}>Type</span>
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(KIND_LABEL) as VendorKind[]).map(k => {
                  const disabled = kindLocked && k !== 'service';
                  return <button key={k} type="button" disabled={disabled} onClick={() => setKind(k)} className={chipCls(kind === k, disabled)}>{KIND_LABEL[k]}</button>;
                })}
              </div>
              <p className={hint}>{kindLocked ? 'Already invited — an invited vendor stays a service vendor.' : service ? 'Does maintenance work — you can invite them onto UpNow and assign jobs.' : 'A record for contracts and payments — never invited, never assigned work. Only the name is needed; no trade licence.'}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="vf-name">Name <span className="text-[#d4553f]">*</span></label>
                <input id="vf-name" className={field} placeholder="Company or person" value={name} onChange={e => setName(e.target.value)} autoFocus={mode === 'add'} />
              </div>
              <div>
                <label className={label} htmlFor="vf-category">What they&rsquo;re for</label>
                {newCat ? (
                  <div className="flex items-center gap-2">
                    <input id="vf-category" autoFocus className={field} placeholder={KIND_HINT[kind]} value={category} onChange={e => setCategory(e.target.value)} />
                    <button type="button" onClick={() => { setNewCat(false); setCategory(''); }} className="text-[11px] text-[#9b9890] hover:text-[#1a1916] cursor-pointer whitespace-nowrap">Pick existing</button>
                  </div>
                ) : (
                  <select id="vf-category" className={field} value={categoryId ?? ''} onChange={e => {
                    if (e.target.value === '__new') { setNewCat(true); setCategoryId(null); setCategory(''); return; }
                    const id = e.target.value ? Number(e.target.value) : null; setCategoryId(id); setCategory(cats.find(c => c.id === id)?.name ?? '');
                  }}>
                    <option value="">— none —</option>
                    {cats.filter(c => c.isActive || c.id === categoryId).map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (retired)'}</option>)}
                    <option value="__new">+ New sub-category…</option>
                  </select>
                )}
                <p className={hint}>A sub-category from Settings → AMC categories. A contract added for this vendor starts with it.</p>
              </div>
              <div>
                <label className={label} htmlFor="vf-payfreq">Payment frequency</label>
                <select id="vf-payfreq" className={field} value={payFreq} onChange={e => setPayFreq(e.target.value)}>
                  <option value="">— not set —</option>
                  {Object.entries(PAY_FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <p className={hint}>How often you pay them. A contract added for this vendor starts with it.</p>
              </div>
            </div>
          </Section>

          {/* 2 · Company — a service vendor's always; a record's only when asked for */}
          {(service || showCompany) && (
          <Section title={company ? 'Company' : 'Person'} sub={service ? "the vendor's own details, on your record" : 'optional'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="vf-entity">Entity</label>
                <select id="vf-entity" className={field} value={entityType} onChange={e => setEntityType(e.target.value as typeof entityType)}>
                  <option value="company">Company</option><option value="individual">Individual / solo</option>
                </select>
              </div>
              {service && (
                <div>
                  <label className={label} htmlFor="vf-relationship">Relationship</label>
                  <select id="vf-relationship" className={field} value={relationship} onChange={e => setRelationship(e.target.value as typeof relationship)}>
                    <option value="contracted_vendor">Contracted vendor</option><option value="internal_team">Our own team</option>
                  </select>
                </div>
              )}
              {service && (
                <div>
                  <label className={label} htmlFor="vf-contact2">Contact person</label>
                  <input id="vf-contact2" className={field} placeholder="Who you deal with" value={contactName} onChange={e => setContactName(e.target.value)} />
                </div>
              )}
              <div>
                <label className={label} htmlFor="vf-address">Address</label>
                <input id="vf-address" className={field} placeholder="Office / yard address" value={address} onChange={e => setAddress(e.target.value)} />
              </div>
            </div>
            <div className="rounded-xl border border-[#f0eee8] bg-[#fafaf8] p-3 grid gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-[#4a4842]">Trade licence</span>
                {existingDoc && !licFile && (
                  <button type="button" onClick={() => openDocViewer({ fileUrl: existingDoc.fileUrl, caption: existingDoc.displayName ?? 'Trade licence', documentKey: 'trade_license' })}
                    className="text-[11.5px] font-semibold text-[#1a7a5a] hover:underline cursor-pointer">View the copy on file</button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="vf-licno">Licence number</label>
                  <input id="vf-licno" className={field} placeholder="e.g. 123456" value={licNo} onChange={e => setLicNo(e.target.value)} />
                </div>
                <div>
                  <label className={label} htmlFor="vf-licexp">Valid until</label>
                  <input id="vf-licexp" type="date" className={field} value={licExpiry} onChange={e => setLicExpiry(e.target.value)} />
                  {licExpiry && licExpiry < today && <p className="text-[11.5px] text-[#b91c1c] mt-1 font-semibold">Expired</p>}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[#6b6860] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-white">
                <UploadCloud size={14} className="text-[#2e9f82]" />
                <span className="flex-1 truncate">{licFile ? licFile.name : existingDoc ? 'Replace the copy on file' : 'Attach a copy — PDF or photo'}</span>
                {licFile && <button type="button" onClick={e => { e.preventDefault(); setLicFile(null); }} className="text-[#9b9890] hover:text-[#b91c1c] cursor-pointer" aria-label="Remove file"><X size={13} /></button>}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" onChange={e => setLicFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </Section>
          )}

          {/* 3 · Contact */}
          <Section title="Contact" sub={service ? 'for the invite and job alerts' : 'optional'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!service && (
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="vf-contact">Contact person</label>
                  <input id="vf-contact" className={field} placeholder="Who you deal with" value={contactName} onChange={e => setContactName(e.target.value)} />
                </div>
              )}
              <div>
                <label className={label} htmlFor="vf-phone">Phone</label>
                <input id="vf-phone" type="tel" className={field} placeholder="+971 50 000 0000" disabled={contactLocked} value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="vf-email">Email</label>
                <input id="vf-email" type="email" className={field} placeholder="name@company.com" disabled={contactLocked} value={email} onChange={e => setEmail(e.target.value)} />
                {service && !contactLocked && <p className={hint}>They&rsquo;ll sign in with it.</p>}
                {contactLocked && <p className={hint}>They&rsquo;ve accepted — sign-in details are theirs to change.</p>}
              </div>
            </div>
            {!service && !showCompany && (
              <button type="button" onClick={() => setShowCompany(true)} className="justify-self-start text-[12px] font-semibold text-[#1a7a5a] hover:underline cursor-pointer">
                + Add company details — address, trade licence
              </button>
            )}
          </Section>

          {/* 4 · Trades */}
          {service && (
            <Section title="Trades" sub="what kinds of work they can be assigned">
              <div className="flex gap-1.5 flex-wrap">
                {groups.map(g => { const on = trades.includes(g.id); return <button key={g.id} type="button" onClick={() => setTrades(t => on ? t.filter(x => x !== g.id) : [...t, g.id])} className={chipCls(on)}>{g.name}</button>; })}
              </div>
              <p className={hint}>Leave empty if unsure — you can set it later.</p>
            </Section>
          )}

          {err && <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#f0eee8] flex items-center justify-between gap-3 sticky bottom-0 bg-white">
          <p className="text-[11.5px] text-[#9b9890] flex-1">{mode === 'add' && service ? 'Adding only records them — send the invitation from their page when ready.' : ''}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-semibold text-[#6b6860] border border-[#e8e6e0] bg-white hover:border-[#c9c6be] cursor-pointer">Cancel</button>
            <button type="submit" disabled={!!busy} className="h-10 px-5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
              {busy ?? (mode === 'add' ? 'Add vendor' : 'Save changes')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
