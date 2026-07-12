/**
 * Landlord detail — full owner profile, the managed properties they're linked
 * to, and their statement (rent collected − management fee = net payable).
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Landmark, Building2, Mail, Phone, CreditCard, Pencil, Trash2, Star, MapPin, ScrollText, Upload, FileText, Eye } from 'lucide-react';
import { apiGet, apiDelete } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';

interface LinkedProperty { propertyId: number; buildingName: string; leasingType: string; ownershipPct: number; isPrimary: boolean }
interface OwnerDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string | null }
interface LandlordDetail {
  id: number; name: string; ownerType: 'individual' | 'company';
  email: string | null; phone: string | null; contactAddress: string | null;
  emiratesId: string | null; passportNumber: string | null; nationality: string | null; dateOfBirth: string | null; gender: string | null;
  tradeLicence: string | null; tradeLicenceAuthority: string | null; authorizedSignatoryName: string | null;
  hasPoa: boolean; poaPersonName: string | null; poaPersonPhone: string | null; poaPersonEmail: string | null;
  iban: string | null; bankName: string | null; accountName: string | null; notes: string | null;
  properties: LinkedProperty[];
}

/** Document slots for a landlord — filtered by owner type + POA. */
function docSlots(d: LandlordDetail): { key: string; label: string; category: string }[] {
  const slots: { key: string; label: string; category: string }[] = [];
  if (d.ownerType === 'individual') {
    slots.push({ key: 'emirates_id', label: 'Emirates ID', category: 'identity' });
    slots.push({ key: 'passport', label: 'Passport', category: 'identity' });
  } else {
    slots.push({ key: 'trade_license', label: 'Trade Licence', category: 'license' });
  }
  if (d.hasPoa) {
    slots.push({ key: 'poa_document', label: 'Power of Attorney', category: 'legal' });
    slots.push({ key: 'poa_holder_emirates_id', label: 'POA holder ID', category: 'identity' });
  }
  slots.push({ key: 'management_agreement', label: 'Management Agreement', category: 'legal' });
  slots.push({ key: 'bank_letter', label: 'Bank Letter / IBAN Certificate', category: 'banking' });
  return slots;
}
interface Statement {
  totals: { rentCollectedNet: number; rentVat: number; managementFee: number; netPayableToOwner: number };
  lines: Array<{ contractId: number; building: string | null; unitNumber: string | null; ownershipPct: number; netPayableToOwner: number; status: string }>;
}

const fmt = (n: number) => `AED ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function LandlordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const rp = params.get('rp');
  const rpQ = rp ? `?rp=${rp}` : '';
  const base = rp ? '/dashboard/manager/landlords' : '/rental-provider/dashboard/landlords';
  const propBase = rp ? '/dashboard/manager/properties' : '/rental-provider/dashboard/portfolio';

  const [d, setD] = useState<LandlordDetail | null>(null);
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [docs, setDocs] = useState<OwnerDoc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const loadDocs = useCallback(() => {
    apiGet<OwnerDoc[]>(`/documents?ownerType=property_owner&ownerId=${id}`).then((ds) => setDocs(Array.isArray(ds) ? ds : [])).catch(() => setDocs([]));
  }, [id]);
  const load = useCallback(() => {
    apiGet<LandlordDetail>(`/owners/${id}${rpQ}`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Not found'));
    apiGet<Statement>(`/owners/${id}/statement${rpQ}`).then(setStmt).catch(() => setStmt(null));
    loadDocs();
  }, [id, rpQ, loadDocs]);
  useEffect(() => { load(); }, [load]);

  const uploadDoc = async (slot: { key: string; label: string; category: string }, file: File) => {
    setUploading(slot.key);
    try {
      await uploadOwnedDocument({ ownerType: 'property_owner', ownerId: Number(id), documentKey: slot.key, category: slot.category, displayName: slot.label, file });
      loadDocs();
    } catch (e) { alert(`Upload failed: ${e instanceof Error ? e.message : 'error'}`); }
    finally { setUploading(null); }
  };
  const removeDoc = async (docId: number) => {
    if (!confirm('Remove this document?')) return;
    try { await apiDelete(`/documents/${docId}`); loadDocs(); } catch (e) { alert(e instanceof Error ? e.message : 'Could not remove'); }
  };

  const remove = async () => {
    if (!d || !confirm(`Delete landlord "${d.name}"? This is only allowed if they aren't linked to any property.`)) return;
    try { await apiDelete(`/owners/${id}${rpQ}`); router.push(`${base}${rpQ}`); }
    catch (e) { alert(e instanceof Error ? e.message : 'Could not delete'); }
  };

  if (err) return <div className="p-8 max-w-4xl mx-auto text-[#9b9890]">Landlord not found. <Link href={`${base}${rpQ}`} className="text-[#2e9f82] underline">Back to Landlords</Link></div>;
  if (!d) return <div className="p-8 max-w-4xl mx-auto text-[#9b9890]">Loading…</div>;

  const t = stmt?.totals;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <button onClick={() => router.push(`${base}${rpQ}`)} className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4"><ArrowLeft size={16} /> Landlords</button>

      {/* Header */}
      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-6 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl grid place-items-center shrink-0" style={{ background: '#f6f0e0', color: '#8a6d2e' }}><Landmark size={24} /></div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#1a1916]">{d.name}</h1>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#f4f3ef] text-[#9b9890]">{d.ownerType}</span>
              </div>
              <p className="text-xs text-[#6b6860] mt-0.5">{d.properties.length} managed propert{d.properties.length === 1 ? 'y' : 'ies'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`${base}${rpQ}`)} title="Edit from the directory" className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-[#e8e6e0] text-[#3f3d39] hover:bg-[#f4f3ef]"><Pencil size={14} /> Edit</button>
            <button onClick={remove} className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-[#f0d8d4] text-[#b91c1c] hover:bg-[#fdf0ef]"><Trash2 size={14} /> Delete</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-[#f0ede8] text-sm">
          <Detail icon={<Mail size={13} />} label="Email" value={d.email} />
          <Detail icon={<Phone size={13} />} label="Phone" value={d.phone} />
          <Detail icon={<CreditCard size={13} />} label={d.ownerType === 'company' ? 'Trade licence' : 'Emirates ID'} value={d.tradeLicence || d.emiratesId} />
          {d.ownerType === 'company'
            ? <Detail icon={<ScrollText size={13} />} label="Licensing authority" value={d.tradeLicenceAuthority} />
            : <Detail icon={<CreditCard size={13} />} label="Passport / Nationality" value={[d.passportNumber, d.nationality].filter(Boolean).join(' · ') || null} />}
          <Detail icon={<Building2 size={13} />} label="Payout" value={d.iban ? `${d.bankName ?? ''} ${d.iban}`.trim() : (d.accountName || null)} />
          {d.ownerType === 'company' && <Detail icon={<CreditCard size={13} />} label="Authorised signatory" value={d.authorizedSignatoryName} />}
          <Detail icon={<MapPin size={13} />} label="Address" value={d.contactAddress} />
          {d.hasPoa && <Detail icon={<ScrollText size={13} />} label="POA holder" value={[d.poaPersonName, d.poaPersonPhone].filter(Boolean).join(' · ') || null} />}
        </div>
        {d.notes && <p className="mt-4 text-sm text-[#6b6860] bg-[#faf9f6] rounded-lg p-3">{d.notes}</p>}
      </div>

      {/* Documents */}
      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-5 mb-5">
        <h2 className="text-sm font-bold text-[#1a1916] mb-1">Documents</h2>
        <p className="text-xs text-[#9b9890] mb-3">Identity, POA, management agreement and bank letter for this landlord.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {docSlots(d).map((slot) => {
            const existing = docs.find((x) => x.documentKey === slot.key || x.documentKey.startsWith(`${slot.key}_`));
            const busy = uploading === slot.key;
            return (
              <div key={slot.key} className="rounded-lg border px-3 py-2.5" style={{ borderColor: existing ? '#22c55e' : '#e8e6e0', background: existing ? 'color-mix(in srgb, #22c55e 5%, white)' : 'white' }}>
                <div className="flex items-center gap-2.5">
                  <FileText size={15} className={existing ? 'text-[#16a34a]' : 'text-[#c8c6c0]'} />
                  <span className="text-sm font-medium text-[#1a1916] flex-1 truncate">{slot.label}</span>
                  {existing ? (
                    <>
                      {existing.fileUrl && <a href={existing.fileUrl} target="_blank" rel="noreferrer" className="text-[#2e9f82] text-xs font-semibold inline-flex items-center gap-1"><Eye size={12} /> View</a>}
                      <button type="button" onClick={() => removeDoc(existing.id)} className="text-[#9b9890] hover:text-[#b91c1c]"><Trash2 size={13} /></button>
                    </>
                  ) : (
                    <label className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer bg-[#2e9f82] text-white">
                      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" disabled={busy}
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadDoc(slot, file); e.target.value = ''; }} />
                      <Upload size={12} /> {busy ? 'Uploading…' : 'Upload'}
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Linked properties */}
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-5">
          <h2 className="text-sm font-bold text-[#1a1916] mb-3">Managed properties</h2>
          {d.properties.length === 0 ? (
            <p className="text-sm text-[#9b9890]">Not linked to any property yet. Link this landlord from a managed property&apos;s form.</p>
          ) : (
            <div className="divide-y divide-[#f0ede8]">
              {d.properties.map((p) => (
                <Link key={p.propertyId} href={`${propBase}${rpQ}`} className="flex items-center gap-3 py-2.5 hover:bg-[#faf9f7] -mx-2 px-2 rounded-lg">
                  <Building2 size={16} className="text-[#8a6d2e] shrink-0" />
                  <span className="flex-1 text-sm font-medium text-[#1a1916] truncate">{p.buildingName}</span>
                  {p.isPrimary && <Star size={12} className="text-[#8a6d2e] fill-[#8a6d2e]" />}
                  <span className="text-xs font-semibold text-[#6b6860]">{p.ownershipPct}%</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Statement */}
        <div className="rounded-2xl border border-[#e8e6e0] bg-white p-5">
          <h2 className="text-sm font-bold text-[#1a1916] mb-1">Owner statement</h2>
          <p className="text-xs text-[#9b9890] mb-3">Cleared rent (net of VAT) − management fee = net payable</p>
          {!t ? (
            <p className="text-sm text-[#9b9890]">No statement data.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <Row label="Rent collected (net)" value={fmt(t.rentCollectedNet)} />
              <Row label="Management fee" value={`− ${fmt(t.managementFee)}`} muted />
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-[#f0ede8]">
                <span className="font-semibold text-[#1a1916]">Net payable to owner</span>
                <span className="font-bold text-[#1a7a5a] tabular-nums">{fmt(t.netPayableToOwner)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">{icon} {label}</div>
      <div className="text-sm text-[#3f3d39] mt-0.5 truncate">{value || '—'}</div>
    </div>
  );
}
function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#6b6860]">{label}</span>
      <span className={`tabular-nums ${muted ? 'text-[#9b9890]' : 'text-[#3f3d39] font-medium'}`}>{value}</span>
    </div>
  );
}
