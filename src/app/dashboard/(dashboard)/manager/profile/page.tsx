'use client';

/**
 * Manager — My Profile (in-account).
 * The manager edits their professional profile: photo, display name, contact,
 * job title, bio, languages, areas served, and experience/specialization.
 * Identity (name/phone/photo) is saved on the user row; the rest on the
 * asset_managers row. GET/PATCH /api/manager/profile.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Loader2, Save, CheckCircle, AlertCircle, UploadCloud, X, UserCircle,
  ExternalLink, Clock, ShieldCheck, CheckCircle2,
} from 'lucide-react';

interface MyDoc { id: number; documentKey: string; fileUrl?: string; status?: string; displayName?: string | null }

// Optional identity documents — back up the manager's POA / on-behalf authority.
const ID_DOCS: { key: string; label: string; hint: string }[] = [
  { key: 'emirates_id', label: 'Emirates ID', hint: 'Both sides, clear scan (PDF or image).' },
  { key: 'passport', label: 'Passport', hint: 'Bio-data page of a valid passport.' },
  { key: 'visa', label: 'UAE Residency Visa', hint: 'Residency visa page.' },
];

interface Profile {
  name: string | null;
  email: string | null;
  phone: string | null;
  profilePictureUrl: string | null;
  assetManagerId: number | null;
  jobTitle: string | null;
  bio: string | null;
  languages: string[];
  areasServed: string[];
  yearsExperience: number | null;
  specialization: string | null;
}

const INPUT = 'w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] transition-colors';
const LABEL = 'block text-xs font-semibold text-[#6b6860] mb-1';

// Add/remove "chip" list editor (languages, areas served).
function ChipInput({ label, placeholder, values, onChange }: {
  label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !values.some(v => v.toLowerCase() === t.toLowerCase())) onChange([...values, t]);
    setDraft('');
  };
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-[#f0faf6] text-[#1a7a5a] border border-[#c5e8df]">
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-[#b91c1c]"><X size={11} /></button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-[#9b9890]">None added yet.</span>}
      </div>
      <div className="flex gap-2">
        <input className={INPUT} value={draft} placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="shrink-0 text-sm font-semibold px-4 rounded-xl border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">Add</button>
      </div>
    </div>
  );
}

export default function ManagerProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Identity documents (folded in from the old "My Documents" page).
  const [docs, setDocs] = useState<MyDoc[]>([]);
  const [docBusyKey, setDocBusyKey] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      const r = await fetch('/api/manager/my-documents', { credentials: 'include' });
      if (r.ok) { const d = await r.json() as { documents: MyDoc[] }; setDocs(d.documents ?? []); }
    } catch { /* non-blocking */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/manager/profile', { credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setP(await res.json() as Profile);
      void loadDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally { setLoading(false); }
  }, [loadDocs]);
  useEffect(() => { void load(); }, [load]);

  async function uploadIdDoc(key: string, label: string, file: File, existingId?: number) {
    if (!p?.assetManagerId) { setError('Profile still being set up — please retry shortly.'); return; }
    setDocBusyKey(key); setError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'asset_manager', ownerId: p.assetManagerId, documentKey: key, originalName: file.name, mimeType: file.type }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => { try { const u = new URL(uploadUrl); return u.pathname.startsWith('/api/') ? u.pathname + u.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('File upload failed');
      const docRes = existingId
        ? await fetch(`/api/documents/${existingId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey }) })
        : await fetch('/api/documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerType: 'asset_manager', ownerId: p.assetManagerId, documentKey: key, category: 'identity', displayName: label, fileUrl, mimeType: file.type, s3Key: fileKey }) });
      if (!docRes.ok) { const b = await docRes.json().catch(() => ({})) as { message?: string | string[] }; throw new Error(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save document')); }
      await loadDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setDocBusyKey(null); }
  }

  const upd = (patch: Partial<Profile>) => setP(prev => prev ? { ...prev, ...patch } : prev);

  async function save() {
    if (!p) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/manager/profile', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: p.name ?? undefined,
          phone: p.phone,
          jobTitle: p.jobTitle,
          bio: p.bio,
          languages: p.languages,
          areasServed: p.areasServed,
          yearsExperience: p.yearsExperience,
          specialization: p.specialization,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      setP(await res.json() as Profile);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function uploadAvatar(file: File) {
    if (!p?.assetManagerId) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    setUploading(true); setError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'asset_manager', ownerId: p.assetManagerId,
          documentKey: `manager_avatar_${Date.now()}`, mimeType: file.type, originalName: file.name,
        }),
      });
      if (!urlRes.ok) throw new Error('Upload URL failed');
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const target = (() => { try { const u = new URL(uploadUrl); return u.pathname.startsWith('/api/') ? u.pathname + u.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Upload failed');
      // Persist the new photo immediately.
      await fetch('/api/manager/profile', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePictureUrl: fileUrl }),
      });
      upd({ profilePictureUrl: fileUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Avatar upload failed');
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-[#2e9f82]" size={28} /></div>;
  if (!p) return <div className="max-w-2xl mx-auto px-4 py-8 text-sm text-[#b91c1c]">{error ?? 'Profile unavailable.'}</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1a1916]">My Profile</h1>
        <p className="text-sm text-[#9b9890] mt-0.5">Your professional details. Visible to the landlords you manage and on your account.</p>
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-[#dc2626] bg-[#fef2f2] rounded-xl px-4 py-3"><AlertCircle size={15} /> {error}</div>}
      {saved && <div className="flex items-center gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3"><CheckCircle size={15} className="text-[#2e9f82]" /> <span className="font-semibold text-[#1a7a5a]">Profile saved.</span></div>}

      {/* Avatar */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 flex items-center gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-[#f4f3ef] flex items-center justify-center shrink-0 border border-[#e8e6e0]">
          {p.profilePictureUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
            : <UserCircle size={44} className="text-[#c8c6be]" />}
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] disabled:opacity-60">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} {uploading ? 'Uploading…' : 'Change photo'}
          </button>
          <p className="text-[11px] text-[#9b9890] mt-1.5">JPG or PNG. Square images look best.</p>
        </div>
      </div>

      {/* Identity + professional details */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL}>Display name</label>
            <input className={INPUT} value={p.name ?? ''} onChange={e => upd({ name: e.target.value })} />
          </div>
          <div><label className={LABEL}>Email</label>
            <input className={`${INPUT} bg-[#f9f8f6] text-[#6b6860]`} value={p.email ?? ''} disabled />
          </div>
          <div><label className={LABEL}>Phone</label>
            <input className={INPUT} value={p.phone ?? ''} placeholder="+9715…" onChange={e => upd({ phone: e.target.value })} />
          </div>
          <div><label className={LABEL}>Job title</label>
            <input className={INPUT} value={p.jobTitle ?? ''} placeholder="e.g. Property Manager" onChange={e => upd({ jobTitle: e.target.value })} />
          </div>
          <div><label className={LABEL}>Specialization</label>
            <input className={INPUT} value={p.specialization ?? ''} placeholder="e.g. Residential leasing" onChange={e => upd({ specialization: e.target.value })} />
          </div>
          <div><label className={LABEL}>Years of experience</label>
            <input type="number" min="0" className={INPUT} value={p.yearsExperience ?? ''}
              onChange={e => upd({ yearsExperience: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
        </div>

        <div><label className={LABEL}>About / Bio</label>
          <textarea rows={4} maxLength={600} className={`${INPUT} resize-none`} value={p.bio ?? ''}
            placeholder="A short introduction — your background, what you manage, how you help landlords and tenants."
            onChange={e => upd({ bio: e.target.value })} />
          <p className="text-[10px] text-[#9b9890] mt-0.5 text-right">{(p.bio ?? '').length} / 600</p>
        </div>

        <ChipInput label="Languages spoken" placeholder="e.g. English, Arabic" values={p.languages ?? []} onChange={v => upd({ languages: v })} />
        <ChipInput label="Areas served" placeholder="e.g. Dubai Marina, JLT" values={p.areasServed ?? []} onChange={v => upd({ areasServed: v })} />
      </div>

      {/* Identity documents — optional; back up POA / on-behalf authority. */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[#f4f3ef] bg-[#fafaf8]">
          <div className="w-8 h-8 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0"><ShieldCheck size={16} className="text-[#2e9f82]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1a1916]">Identity documents</p>
            <p className="text-xs text-[#9b9890] mt-0.5">All optional — upload what applies to you</p>
          </div>
          <span className="text-xs text-[#6b6860]">{ID_DOCS.filter(d => docs.some(x => x.documentKey === d.key)).length}/{ID_DOCS.length} uploaded</span>
        </div>
        <div className="px-5 py-4 space-y-3">
          {ID_DOCS.map(({ key, label, hint }) => {
            const doc = docs.find(x => x.documentKey === key);
            const uploaded = !!doc;
            const isApproved = doc?.status === 'complete' || doc?.status === 'processed';
            const busy = docBusyKey === key;
            return (
              <div key={key} className={['rounded-xl px-4 py-3 flex items-start gap-3',
                isApproved ? 'bg-[#f0faf6] border border-[#bbf7d0]' : uploaded ? 'bg-[#eff6ff] border border-[#bfdbfe]' : 'bg-[#f9f8f6] border border-[#e8e6e0]'].join(' ')}>
                <div className="mt-0.5 shrink-0">
                  {isApproved ? <div className="w-6 h-6 rounded-full bg-[#dcfce7] flex items-center justify-center"><CheckCircle2 size={13} className="text-[#16a34a]" /></div>
                    : uploaded ? <div className="w-6 h-6 rounded-full bg-[#dbeafe] flex items-center justify-center"><Clock size={12} className="text-[#2563eb]" /></div>
                    : <div className="w-6 h-6 rounded-full bg-[#f4f3ef] flex items-center justify-center"><UploadCloud size={12} className="text-[#c5c3bc]" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${isApproved ? 'text-[#166534]' : 'text-[#1a1916]'}`}>{label}</p>
                    <span className="text-[10px] text-[#9b9890]">Optional</span>
                  </div>
                  {isApproved ? <p className="text-xs text-[#16a34a] font-medium mt-0.5">Approved ✓</p>
                    : uploaded ? <p className="text-xs text-[#6b6860] mt-0.5">Uploaded · awaiting review</p>
                    : <p className="text-xs text-[#9b9890] mt-0.5">{hint}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  {uploaded && doc?.fileUrl && (
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline"><ExternalLink size={12} /> View</a>
                  )}
                  <label className={['flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white transition-opacity bg-[#9b9890] hover:bg-[#6b6860]', busy ? 'opacity-50 pointer-events-none' : ''].join(' ')}>
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                    {uploaded ? 'Replace' : 'Upload'}
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void uploadIdDoc(key, label, f, doc?.id); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end pb-10">
        <button onClick={() => void save()} disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
