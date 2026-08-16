/**
 * Admin · Platform agreement (SP-252) — the versioned agreement per audience.
 * Draft a version (text and/or PDF), publish it (previous current → superseded,
 * everyone in the audience re-prompted), and read the append-only acceptance
 * evidence: who accepted which version, when, from where.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Loader2, Plus, Upload, Users } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { AgreementText, type AgreementAudience } from '@/components/upnow/PlatformAgreementPanel';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });

interface AdminAgreement {
  id: number;
  audience: AgreementAudience;
  version: string;
  title: string;
  summary: string | null;
  bodyMd: string | null;
  fileName: string | null;
  fileViewUrl: string | null;
  documentSha256: string | null;
  status: 'draft' | 'current' | 'superseded';
  effectiveFrom: string | null;
  publishedAt: string | null;
  createdAt: string;
  supersededAt: string | null;
  acceptances: number;
}
interface AcceptanceRow {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  agreementVersion: string;
  acceptedAt: string;
  context: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const AUDIENCES: { key: AgreementAudience; label: string; hint: string }[] = [
  { key: 'provider', label: 'Service providers', hint: 'Gated: onboarding cannot finish and admin cannot approve until the current version is accepted.' },
  { key: 'customer', label: 'Customers', hint: 'Schema-ready; not presented anywhere yet.' },
  // Audience key stays `landlord` (schema); the platform's user-facing term is Rental Provider.
  { key: 'landlord', label: 'Rental providers', hint: 'Schema-ready; not presented anywhere yet.' },
];
/** Human label for an audience key — the raw key ('landlord') must never surface in copy. */
const audienceLabel = (k: AgreementAudience) => AUDIENCES.find((a) => a.key === k)?.label ?? k;
const STATUS_STYLE: Record<AdminAgreement['status'], { bg: string; fg: string; label: string }> = {
  current: { bg: '#e8f6f1', fg: '#1d7a5f', label: 'Current' },
  draft: { bg: '#fef6e7', fg: '#92400e', label: 'Draft' },
  superseded: { bg: '#f3f4f6', fg: '#6b7280', label: 'Superseded' },
};
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }) : '—';

export default function AdminAgreementsPage() {
  const [audience, setAudience] = useState<AgreementAudience>('provider');
  const [rows, setRows] = useState<AdminAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [acceptances, setAcceptances] = useState<Record<number, AcceptanceRow[]>>({});
  const [showAcceptances, setShowAcceptances] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState<AdminAgreement | null>(null);

  // All setState calls happen inside promise callbacks (never synchronously in
  // the effect body) — the react-hooks rule flags the latter.
  const load = useCallback(
    () =>
      apiGet<AdminAgreement[]>('/admin/agreements')
        .then((list) => { setRows(list); setError(null); })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load agreements'))
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => { void load(); }, [load]);

  const mine = rows.filter((r) => r.audience === audience);
  const current = mine.find((r) => r.status === 'current') ?? null;

  const publish = async (a: AdminAgreement) => {
    const ok = window.confirm(
      `Publish v${a.version} for ${audienceLabel(a.audience)}?\n\n` +
        (current ? `v${current.version} becomes superseded and every ${audienceLabel(a.audience).toLowerCase().replace(/s$/, '')} is asked to accept v${a.version} on their next visit. Earlier acceptances stay on record.` : `Every ${audienceLabel(a.audience).toLowerCase().replace(/s$/, '')} will be asked to accept it on their next visit.`) +
        `\n\nA published version is immutable.`,
    );
    if (!ok) return;
    setBusy(a.id);
    setError(null);
    try {
      await apiPost(`/admin/agreements/${a.id}/publish`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setBusy(null);
    }
  };

  const loadAcceptances = async (id: number) => {
    if (showAcceptances === id) { setShowAcceptances(null); return; }
    setShowAcceptances(id);
    if (acceptances[id]) return;
    try {
      const list = await apiGet<AcceptanceRow[]>(`/admin/agreements/${id}/acceptances`);
      setAcceptances((prev) => ({ ...prev, [id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load acceptances');
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Legal</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Platform agreement</h1>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4, maxWidth: 720 }}>
        One current version per audience. Publishing a new version re-prompts everyone; every acceptance is an append-only record —
        who, which version and document hash, when, from where. Published versions cannot be edited: draft the next one.
      </p>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        {AUDIENCES.map((t) => {
          const n = rows.filter((r) => r.audience === t.key).length;
          const cur = rows.find((r) => r.audience === t.key && r.status === 'current');
          return (
            <button key={t.key} onClick={() => setAudience(t.key)}
              style={{ padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, border: BORDER, background: audience === t.key ? INK : '#fff', color: audience === t.key ? '#fff' : MUTE, cursor: 'pointer' }}>
              {t.label} <span style={{ opacity: .7 }}>· {cur ? `v${cur.version}` : n ? 'no current' : 'none'}</span>
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12.5, color: FAINT, marginTop: 8 }}>{AUDIENCES.find((a) => a.key === audience)?.hint}</p>

      <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK }}>Versions</h2>
        <button type="button" onClick={() => { setDrafting(true); setEditing(null); }}
          className="flex items-center gap-1.5"
          style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: PRIMARY, border: 'none', borderRadius: 10, padding: '8px 12px', cursor: 'pointer' }}>
          <Plus size={14} /> Draft a new version
        </button>
      </div>

      {(drafting || editing) && (
        <DraftForm
          audience={audience}
          existing={editing}
          onCancel={() => { setDrafting(false); setEditing(null); }}
          onSaved={async () => { setDrafting(false); setEditing(null); await load(); }}
        />
      )}

      {loading ? (
        <div style={{ ...card({ padding: 32, marginTop: 12 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>Loading…</div>
      ) : mine.length === 0 ? (
        <div style={{ ...card({ padding: 32, marginTop: 12 }), textAlign: 'center', color: FAINT, fontSize: 13 }}>
          <FileText size={26} style={{ margin: '0 auto 8px', color: '#c9c6bd' }} />
          No agreement versions for this audience yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {mine.map((a) => {
            const st = STATUS_STYLE[a.status];
            const open = openId === a.id;
            return (
              <div key={a.id} style={card({ overflow: 'hidden' })}>
                <div className="flex items-start gap-3 flex-wrap" style={{ padding: '14px 16px' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{a.title}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#f5f5f3', color: MUTE }}>v{a.version}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
                    </div>
                    {a.summary && <p style={{ fontSize: 12.5, color: MUTE, marginTop: 4, lineHeight: 1.5 }}>{a.summary}</p>}
                    <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>
                      <span>Created {fmt(a.createdAt)}</span>
                      {a.publishedAt && <span>· Published {fmt(a.publishedAt)}</span>}
                      {a.effectiveFrom && <span>· Effective {fmt(a.effectiveFrom)}</span>}
                      {a.supersededAt && <span>· Superseded {fmt(a.supersededAt)}</span>}
                      {a.documentSha256 && <span title={a.documentSha256}>· sha256 {a.documentSha256.slice(0, 12)}…</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={() => void loadAcceptances(a.id)} className="flex items-center gap-1.5"
                      style={{ fontSize: 12, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                      <Users size={13} /> {a.acceptances} accepted
                    </button>
                    {a.bodyMd && (
                      <button type="button" onClick={() => setOpenId(open ? null : a.id)}
                        style={{ fontSize: 12, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                        {open ? 'Hide text' : 'Read text'}
                      </button>
                    )}
                    {a.fileViewUrl && (
                      <a href={a.fileViewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1"
                        style={{ fontSize: 12, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 8, padding: '6px 10px' }}>
                        <ExternalLink size={12} /> PDF
                      </a>
                    )}
                    {a.status === 'draft' && (
                      <>
                        <button type="button" onClick={() => { setEditing(a); setDrafting(false); }}
                          style={{ fontSize: 12, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                          Edit
                        </button>
                        <button type="button" disabled={busy === a.id} onClick={() => void publish(a)} className="flex items-center gap-1.5"
                          style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: PRIMARY, border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', opacity: busy === a.id ? .6 : 1 }}>
                          {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />} Publish
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {open && a.bodyMd && (
                  <div style={{ borderTop: BORDER, padding: '12px 16px', background: '#fbfbfa', maxHeight: 420, overflowY: 'auto' }}>
                    <AgreementText md={a.bodyMd} />
                  </div>
                )}
                {showAcceptances === a.id && (
                  <div style={{ borderTop: BORDER, padding: '12px 16px', background: '#fbfbfa' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: FAINT, marginBottom: 8 }}>
                      Acceptance record — append-only
                    </p>
                    {!acceptances[a.id] ? (
                      <p style={{ fontSize: 12.5, color: FAINT }}>Loading…</p>
                    ) : acceptances[a.id].length === 0 ? (
                      <p style={{ fontSize: 12.5, color: FAINT }}>Nobody has accepted this version yet.</p>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: FAINT, textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Who</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Accepted</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Where</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>IP</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>Device</th>
                            </tr>
                          </thead>
                          <tbody>
                            {acceptances[a.id].map((x) => (
                              <tr key={x.id} style={{ borderTop: BORDER, color: INK }}>
                                <td style={{ padding: '6px' }}>{x.userName || '—'}<span style={{ display: 'block', color: FAINT, fontSize: 11 }}>{x.userEmail} · #{x.userId}</span></td>
                                <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{fmt(x.acceptedAt)}</td>
                                <td style={{ padding: '6px' }}>{x.context}</td>
                                <td style={{ padding: '6px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{x.ipAddress ?? '—'}</td>
                                <td style={{ padding: '6px', color: MUTE, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.userAgent ?? ''}>{x.userAgent ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Draft / edit form ─────────────────────────────────────────────────── */
function DraftForm({ audience, existing, onCancel, onSaved }: {
  audience: AgreementAudience;
  existing: AdminAgreement | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [version, setVersion] = useState(existing?.version ?? '');
  const [title, setTitle] = useState(existing?.title ?? (audience === 'provider' ? 'UpNow Service Provider Platform Agreement' : ''));
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [bodyMd, setBodyMd] = useState(existing?.bodyMd ?? '');
  const [file, setFile] = useState<{ fileUrl: string; fileName: string; mimeType: string } | null>(existing?.fileName ? { fileUrl: '', fileName: existing.fileName, mimeType: 'application/pdf' } : null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadPdf = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    setError(null);
    try {
      const pre = await apiPost<{ uploadUrl: string; fileUrl: string }>('/admin/agreements/upload-url', { mimeType: f.type || 'application/pdf', originalName: f.name });
      const put = await fetch(pre.uploadUrl, { method: 'PUT', body: f, headers: { 'Content-Type': f.type || 'application/pdf' } });
      if (!put.ok) throw new Error('Upload failed — please try again.');
      setFile({ fileUrl: pre.fileUrl, fileName: f.name, mimeType: f.type || 'application/pdf' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { version: version.trim(), title: title.trim(), summary: summary.trim() || null, bodyMd: bodyMd.trim() || null };
      if (file?.fileUrl) { payload.fileUrl = file.fileUrl; payload.fileName = file.fileName; payload.mimeType = file.mimeType; }
      if (existing) await apiPatch(`/admin/agreements/${existing.id}`, payload);
      else await apiPost('/admin/agreements', { audience, ...payload });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const input: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px', border: BORDER, borderRadius: 8, color: INK, background: '#fff' };
  return (
    <div style={card({ padding: 16, marginTop: 12, background: '#fbfbfa' })}>
      <p style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 10 }}>{existing ? `Edit draft v${existing.version}` : `New ${audienceLabel(audience).toLowerCase().replace(/s$/, '')} agreement version`}</p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 160px) minmax(0, 1fr)' }}>
        <label style={{ fontSize: 12, color: MUTE }}>Version<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" style={{ ...input, marginTop: 4 }} /></label>
        <label style={{ fontSize: 12, color: MUTE }}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...input, marginTop: 4 }} /></label>
      </div>
      <label style={{ display: 'block', fontSize: 12, color: MUTE, marginTop: 10 }}>Summary (one paragraph shown above the checkbox)
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} style={{ ...input, marginTop: 4, resize: 'vertical' }} />
      </label>
      <label style={{ display: 'block', fontSize: 12, color: MUTE, marginTop: 10 }}>Agreement text (markdown: ## headings, paragraphs, - lists, **bold**, &gt; note)
        <textarea value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} rows={12} style={{ ...input, marginTop: 4, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
      </label>
      <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 10 }}>
        <label className="flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: MUTE, border: BORDER, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', background: '#fff' }}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {file ? 'Replace PDF' : 'Attach PDF (optional)'}
          <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => void uploadPdf(e.target.files?.[0])} />
        </label>
        {file && <span style={{ fontSize: 12, color: MUTE }}>{file.fileName}</span>}
        <span style={{ fontSize: 11.5, color: FAINT }}>Text and/or PDF — at least one is needed to publish.</span>
      </div>
      {error && <p style={{ fontSize: 12.5, color: '#b42318', marginTop: 8 }}>{error}</p>}
      <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
        <button type="button" disabled={saving || !version.trim() || !title.trim()} onClick={() => void save()}
          style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: PRIMARY, border: 'none', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', opacity: saving ? .6 : 1 }}>
          {saving ? 'Saving…' : existing ? 'Save draft' : 'Create draft'}
        </button>
        <button type="button" onClick={onCancel} style={{ fontSize: 13, fontWeight: 600, color: MUTE, background: '#fff', border: BORDER, borderRadius: 10, padding: '8px 14px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
