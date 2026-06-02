/**
 * AddendumsPanel — reusable card for both RP and customer contract pages.
 *
 * RP side (role='landlord'):
 *  - List addendums attached to the contract
 *  - Add addendum (from template OR one-off file upload) — only while status='pending'
 *  - Remove an addendum — only while status='pending'
 *  - Sign as landlord
 *
 * Customer side (role='tenant'):
 *  - List addendums
 *  - Sign as tenant
 *
 * Endpoints used:
 *   GET    /api/contracts/:id/addendums
 *   POST   /api/contracts/:id/addendums                       (RP, body: { templateId? | name+file })
 *   DELETE /api/contracts/:id/addendums/:addendumId           (RP)
 *   POST   /api/contracts/:id/addendums/:addendumId/sign      (RP)
 *   POST   /api/contracts/tenant/:id/addendums/:addendumId/sign (Tenant)
 */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { FileText, UploadCloud, Trash2, Loader2, AlertCircle, Plus, X, ExternalLink, CheckCircle2, FileSignature, RotateCcw, Lock } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';

interface Addendum {
  id: number;
  tenancyContractId: number;
  templateId: number | null;
  name: string;
  fileUrl: string;
  fileKey: string;
  mimeType: string;
  tenantSig: string | null;
  tenantSignedAt: string | null;
  landlordSig: string | null;
  landlordSignedAt: string | null;
  createdAt: string;
}

interface AddendumTemplate {
  id: number;
  name: string;
  description: string | null;
  fileUrl: string;
  fileKey: string;
  mimeType: string;
  originalFilename: string | null;
}

const ALLOWED_MIME = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export function AddendumsPanel({
  contractId,
  role,
  contractStatus,
}: {
  contractId: number;
  role: 'landlord' | 'tenant';
  contractStatus: string;
}) {
  const [addendums, setAddendums] = useState<Addendum[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const canAttach = role === 'landlord' && contractStatus === 'pending';

  const fetchAll = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setErr(null);
    try {
      const list = await apiGet<Addendum[]>(`/contracts/${contractId}/addendums`, { signal });
      setAddendums(list);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      setErr(e instanceof Error ? e.message : 'Failed to load addendums');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [contractId]);

  // AbortController guard so StrictMode's double-mount doesn't double-fetch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const ctrl = new AbortController();
    void fetchAll(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchAll]);

  async function handleDelete(id: number) {
    if (!confirm('Remove this addendum from the contract?')) return;
    try {
      await apiDelete(`/contracts/${contractId}/addendums/${id}`);
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
        <div className="flex items-center gap-2.5">
          <FileSignature size={16} className="text-[#2e9f82]" />
          <div>
            <p className="text-sm font-bold text-[#1a1916]">Addendums</p>
            <p className="text-[11px] text-[#9b9890] mt-0.5">
              {role === 'landlord'
                ? canAttach
                  ? 'Attach additional terms — locked once contract is issued.'
                  : 'Read-only — contract has been issued.'
                : 'Additional terms attached to your tenancy contract.'}
            </p>
          </div>
        </div>
        {canAttach && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white text-xs font-semibold hover:bg-[#27896f]"
          >
            <Plus size={13} /> Attach
          </button>
        )}
      </div>

      {err && (
        <div className="mx-5 mt-3 rounded-lg px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200 flex items-start gap-2">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-[#6b6860]">
          <Loader2 size={16} className="animate-spin" /> <span className="text-xs">Loading…</span>
        </div>
      ) : addendums.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <FileText size={28} className="mx-auto text-[#c9c7c1] mb-2" />
          <p className="text-xs text-[#9b9890]">
            {canAttach ? 'No addendums attached yet — click Attach to add one.' : 'No addendums attached.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#f4f3ef]">
          {addendums.map(a => (
            <AddendumRow
              key={a.id}
              addendum={a}
              role={role}
              canDelete={canAttach}
              contractId={contractId}
              onChanged={fetchAll}
              onDelete={() => handleDelete(a.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <AttachAddendumModal
          contractId={contractId}
          onClose={() => setShowForm(false)}
          onAttached={() => { setShowForm(false); void fetchAll(); }}
        />
      )}
    </div>
  );
}

/* ─── One addendum row ────────────────────────────────────────────── */

function AddendumRow({
  addendum: a,
  role,
  canDelete,
  contractId,
  onChanged,
  onDelete,
}: {
  addendum: Addendum;
  role: 'landlord' | 'tenant';
  canDelete: boolean;
  contractId: number;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [showSig, setShowSig] = useState(false);
  const mySig = role === 'tenant' ? a.tenantSig : a.landlordSig;
  const theirSig = role === 'tenant' ? a.landlordSig : a.tenantSig;
  const fileTypeLabel = a.mimeType === 'application/pdf' ? 'PDF' : a.mimeType.includes('word') ? 'DOCX' : 'File';

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <FileText size={18} className="text-[#2e9f82] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1a1916]">{a.name}</p>
            <p className="text-[11px] text-[#9b9890] mt-0.5">
              {fileTypeLabel} · Attached {new Date(a.createdAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={a.fileUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#2e9f82] hover:bg-[#f0faf6] border border-[#c5e8df]">
            <ExternalLink size={11} /> View
          </a>
          {canDelete && (
            <button onClick={onDelete}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#dc2626] hover:bg-red-50 border border-red-200">
              <Trash2 size={11} /> Remove
            </button>
          )}
        </div>
      </div>

      {/* Signature status row */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SigStatusCell
          label={role === 'tenant' ? 'You (Tenant)' : 'You (Landlord)'}
          sig={mySig}
          signedAt={role === 'tenant' ? a.tenantSignedAt : a.landlordSignedAt}
          onSign={() => setShowSig(true)}
        />
        <SigStatusCell
          label={role === 'tenant' ? 'Landlord' : 'Tenant'}
          sig={theirSig}
          signedAt={role === 'tenant' ? a.landlordSignedAt : a.tenantSignedAt}
        />
      </div>

      {showSig && (
        <SignAddendumModal
          addendum={a}
          role={role}
          contractId={contractId}
          onClose={() => setShowSig(false)}
          onSigned={() => { setShowSig(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function SigStatusCell({
  label,
  sig,
  signedAt,
  onSign,
}: {
  label: string;
  sig: string | null;
  signedAt: string | null;
  onSign?: () => void;
}) {
  if (sig) {
    return (
      <div className="rounded-lg border border-[#c5e8df] bg-[#f0faf6] px-3 py-2">
        <p className="text-[9px] font-bold text-[#1a7a5a] uppercase tracking-wide mb-1">{label}</p>
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sig} alt="signature" className="h-7 max-w-[80px] object-contain bg-white rounded" />
          <div>
            <p className="text-[10px] font-semibold text-[#1a7a5a] flex items-center gap-1">
              <CheckCircle2 size={10} /> Signed
            </p>
            {signedAt && <p className="text-[9px] text-[#6b6860]">{new Date(signedAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}</p>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-[#e8e6e0] px-3 py-2">
      <p className="text-[9px] font-bold text-[#9b9890] uppercase tracking-wide mb-1">{label}</p>
      {onSign ? (
        <button onClick={onSign}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:underline">
          <FileSignature size={12} /> Sign now
        </button>
      ) : (
        <p className="text-[11px] text-[#9b9890] flex items-center gap-1">
          <Lock size={10} /> Awaiting
        </p>
      )}
    </div>
  );
}

/* ─── Attach addendum modal (RP only) ─────────────────────────────── */

function AttachAddendumModal({
  contractId,
  onClose,
  onAttached,
}: {
  contractId: number;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [mode, setMode] = useState<'template' | 'upload'>('template');
  const [templates, setTemplates] = useState<AddendumTemplate[]>([]);
  const [loadingTpls, setLoadingTpls] = useState(true);
  const [selectedTpl, setSelectedTpl] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    apiGet<AddendumTemplate[]>('/addendum-templates')
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTpls(false));
  }, []);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      if (mode === 'template') {
        const t = templates.find(x => x.id === selectedTpl);
        if (!t) { setErr('Pick a template'); setBusy(false); return; }
        await apiPost(`/contracts/${contractId}/addendums`, {
          templateId: t.id,
          name: t.name,
          fileUrl: t.fileUrl,
          fileKey: t.fileKey,
          mimeType: t.mimeType,
        });
      } else {
        if (!name.trim()) { setErr('Name is required'); setBusy(false); return; }
        if (!file) { setErr('Choose a file'); setBusy(false); return; }
        if (!ALLOWED_MIME.includes(file.type)) { setErr('Only PDF or DOCX allowed'); setBusy(false); return; }
        // 3-step upload via addendum-templates upload URL (reuses RP-scoped S3 path)
        const presigned = await apiPost<{ uploadUrl: string; fileUrl: string; fileKey: string }>(
          '/addendum-templates/upload-url',
          { mimeType: file.type, originalName: file.name },
        );
        const target = (() => {
          try { const p = new URL(presigned.uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : presigned.uploadUrl; }
          catch { return presigned.uploadUrl; }
        })();
        const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
        await apiPost(`/contracts/${contractId}/addendums`, {
          templateId: null,
          name: name.trim(),
          fileUrl: presigned.fileUrl,
          fileKey: presigned.fileKey,
          mimeType: file.type,
        });
      }
      onAttached();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to attach');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e6e0]">
          <h3 className="text-base font-bold text-[#1a1916]">Attach addendum</h3>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] p-1"><X size={18} /></button>
        </div>

        {/* Mode tabs */}
        <div className="px-5 pt-4">
          <div className="flex gap-1 bg-[#f4f3ef] rounded-xl p-1">
            <button onClick={() => setMode('template')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${mode === 'template' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860]'}`}>
              From template
            </button>
            <button onClick={() => setMode('upload')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${mode === 'upload' ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860]'}`}>
              One-off upload
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {mode === 'template' ? (
            loadingTpls ? (
              <div className="flex items-center gap-2 py-6 justify-center text-[#6b6860]">
                <Loader2 size={14} className="animate-spin" /> <span className="text-xs">Loading templates…</span>
              </div>
            ) : templates.length === 0 ? (
              <div className="bg-[#fff7ed] border border-[#fed7aa] rounded-xl p-3">
                <p className="text-xs text-[#9a3412]">
                  No templates saved yet. Create one in <a href="/rental-provider/dashboard/templates" className="font-bold underline">Templates</a> first, or use One-off upload.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {templates.map(t => (
                  <label key={t.id}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${selectedTpl === t.id ? 'border-[#2e9f82] bg-[#f0faf6]' : 'border-[#e8e6e0] hover:bg-[#fafaf8]'}`}>
                    <input type="radio" name="tpl" checked={selectedTpl === t.id}
                      onChange={() => setSelectedTpl(t.id)}
                      className="mt-0.5 accent-[#2e9f82]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#1a1916]">{t.name}</p>
                      {t.description && <p className="text-xs text-[#9b9890] mt-0.5">{t.description}</p>}
                    </div>
                  </label>
                ))}
              </div>
            )
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-[#6b6860] block mb-1.5">Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Parking spot allocation"
                  className="w-full px-3 py-2 rounded-xl border border-[#e8e6e0] text-sm focus:outline-none focus:border-[#2e9f82]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#6b6860] block mb-1.5">File (PDF or DOCX)</label>
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <button onClick={() => fileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-[#e8e6e0] text-sm text-[#6b6860] hover:border-[#2e9f82] hover:bg-[#f0faf6]">
                  <UploadCloud size={16} />
                  {file ? file.name : 'Click to choose file'}
                </button>
              </div>
            </>
          )}

          {err && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-2"><AlertCircle size={12} /> {err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e8e6e0] bg-[#fafaf8]">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-[#6b6860] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {busy ? 'Attaching…' : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Sign addendum modal (both parties) ──────────────────────────── */

function SignAddendumModal({
  addendum: a,
  role,
  contractId,
  onClose,
  onSigned,
}: {
  addendum: Addendum;
  role: 'landlord' | 'tenant';
  contractId: number;
  onClose: () => void;
  onSigned: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ratio = window.devicePixelRatio || 1;
    const r = cvs.getBoundingClientRect();
    cvs.width = r.width * ratio; cvs.height = r.height * ratio;
    const ctx = cvs.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1916';
  }, []);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  async function submit() {
    if (!sig) { setErr('Please draw your signature'); return; }
    setBusy(true); setErr(null);
    try {
      const url = role === 'tenant'
        ? `/contracts/tenant/${contractId}/addendums/${a.id}/sign`
        : `/contracts/${contractId}/addendums/${a.id}/sign`;
      await apiPost(url, { signatureImage: sig });
      onSigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
    } finally {
      setBusy(false);
    }
  }

  function clearSig() {
    const cvs = canvasRef.current; const ctx = cvs?.getContext('2d');
    if (!cvs || !ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    setSig(null);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e6e0]">
          <h3 className="text-base font-bold text-[#1a1916]">Sign — {a.name}</h3>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <a href={a.fileUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-[#c5e8df] bg-[#f0faf6] text-xs font-semibold text-[#2e9f82] hover:bg-[#e0f4ec]">
            <ExternalLink size={12} /> Open addendum to review
          </a>
          <p className="text-xs text-[#6b6860]">Draw your signature in the box below.</p>
          <canvas ref={canvasRef}
            className="w-full h-32 rounded-xl border-2 border-dashed border-[#d8d6d0] bg-[#fafaf8] touch-none cursor-crosshair"
            onPointerDown={e => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }}
            onPointerMove={e => { if (!drawing.current) return; const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }}
            onPointerUp={() => { if (!drawing.current) return; drawing.current = false; setSig(canvasRef.current?.toDataURL('image/png') ?? null); }}
            onPointerLeave={() => { if (!drawing.current) return; drawing.current = false; setSig(canvasRef.current?.toDataURL('image/png') ?? null); }}
          />
          <div className="flex justify-between items-center">
            <button onClick={clearSig} className="flex items-center gap-1 text-xs text-[#6b6860] hover:text-[#1a1916]"><RotateCcw size={11} /> Clear</button>
            {sig && <span className="text-[10px] text-[#16a34a] font-semibold">✓ Captured</span>}
          </div>
          {err && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-2"><AlertCircle size={12} /> {err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e8e6e0] bg-[#fafaf8]">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-[#6b6860] hover:bg-white">Cancel</button>
          <button onClick={submit} disabled={busy || !sig}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
            {busy ? 'Signing…' : 'Sign addendum'}
          </button>
        </div>
      </div>
    </div>
  );
}
