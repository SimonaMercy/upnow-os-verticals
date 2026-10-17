'use client';

/**
 * Admin › Legal › Platform agreement (SP-252) — Genspark OS rebuild. The versioned agreement per
 * audience: draft a version (text and/or PDF), publish it (previous current → superseded,
 * everyone in the audience re-prompted), and read the append-only acceptance evidence.
 *
 * Parity with previous page (same endpoints and payloads):
 *  - GET /api/admin/agreements — every version; loading / error / empty states.
 *  - Audience tabs (Service providers / Customers / Rental providers) with "· vN / no current / none"
 *    and the per-audience hint — now a kit Seg + Callout. Raw 'landlord' key never shown.
 *  - "Draft a new version" → DraftForm (now in a kit Modal): Version, Title (provider default title),
 *    Summary, markdown body, optional PDF via POST /api/admin/agreements/upload-url → PUT presigned
 *    → { fileUrl, fileName, mimeType } in the payload. Create = POST /api/admin/agreements
 *    { audience, version, title, summary|null, bodyMd|null, [file*] }; Edit draft =
 *    PATCH /api/admin/agreements/:id (same payload minus audience). Save disabled without version+title.
 *  - Publish (drafts only): same window.confirm copy → POST /api/admin/agreements/:id/publish {}.
 *  - Acceptances: lazy GET /api/admin/agreements/:id/acceptances (cached per id) — who (name, email,
 *    #id), accepted, where (context), IP, device.
 *  - Read text (AgreementText REUSED), PDF link (fileViewUrl, new tab), created/published/effective/
 *    superseded dates, sha256 prefix.
 *  - Version cards → kit table rows with a labelled "Open" button that opens a Drawer holding the
 *    KV record, agreement text, acceptance record and the Edit / Publish / PDF actions.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { AgreementText, type AgreementAudience } from '@/components/upnow/PlatformAgreementPanel';
import {
  Btn, Callout, Card, Drawer, EmptyRow, ErrorRow, Evid, Field, KV, Modal, OsPage, PageHead, Pill, ScopeStrip, Seg,
  SkeletonRows, TableWrap, type Tone,
} from '@/components/os/kit';

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
const audienceLabel = (k: AgreementAudience) => AUDIENCES.find((a) => a.key === k)?.label ?? k;
const audienceNoun = (k: AgreementAudience) => audienceLabel(k).toLowerCase().replace(/s$/, '');
const STATUS_UI: Record<AdminAgreement['status'], { tone: Tone; label: string }> = {
  current: { tone: 'primary', label: 'Current' },
  draft: { tone: 'amber', label: 'Draft' },
  superseded: { tone: 'neutral', label: 'Superseded' },
};
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' }) : '—';

export default function AdminAgreementsPage() {
  const [audience, setAudience] = useState<AgreementAudience>('provider');
  const [rows, setRows] = useState<AdminAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [acceptances, setAcceptances] = useState<Record<number, AcceptanceRow[]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [editing, setEditing] = useState<AdminAgreement | null>(null);

  const load = useCallback(
    () =>
      apiGet<AdminAgreement[]>('/admin/agreements')
        .then((list) => { setRows(list); setError(null); setLoadFailed(false); })
        .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Could not load agreements'); setLoadFailed(true); })
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => { void load(); }, [load]);

  const mine = rows.filter((r) => r.audience === audience);
  const current = mine.find((r) => r.status === 'current') ?? null;
  const opened = openId != null ? rows.find((r) => r.id === openId) ?? null : null;

  const publish = async (a: AdminAgreement) => {
    const cur = rows.find((r) => r.audience === a.audience && r.status === 'current') ?? null;
    const ok = window.confirm(
      `Publish v${a.version} for ${audienceLabel(a.audience)}?\n\n` +
        (cur ? `v${cur.version} becomes superseded and every ${audienceNoun(a.audience)} is asked to accept v${a.version} on their next visit. Earlier acceptances stay on record.` : `Every ${audienceNoun(a.audience)} will be asked to accept it on their next visit.`) +
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

  const openVersion = async (id: number) => {
    setOpenId(id);
    if (acceptances[id]) return;
    try {
      const list = await apiGet<AcceptanceRow[]>(`/admin/agreements/${id}/acceptances`);
      setAcceptances((prev) => ({ ...prev, [id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load acceptances');
    }
  };
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const closeForm = useCallback(() => { setDrafting(false); setEditing(null); }, []);
  const hint = AUDIENCES.find((a) => a.key === audience)?.hint;

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Legal"
        title="Platform agreement"
        lede="One current version per audience. Publishing a new version re-prompts everyone; every acceptance is an append-only record — who, which version and document hash, when, from where."
        actions={<Btn size="sm" variant="primary" onClick={() => { setDrafting(true); setEditing(null); }}>Draft a new version</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Legal' },
        { label: 'Audience', value: audienceLabel(audience) },
        { label: 'Current', value: current ? `v${current.version}` : 'None' },
      ]} />

      {error && <div style={{ marginBottom: 14 }}><Callout tone="bad" title="Something went wrong.">{error}</Callout></div>}

      <div style={{ marginBottom: 10 }}>
        <Seg
          label="Audience"
          value={audience}
          onChange={setAudience}
          options={AUDIENCES.map((t) => {
            const n = rows.filter((r) => r.audience === t.key).length;
            const cur = rows.find((r) => r.audience === t.key && r.status === 'current');
            return { v: t.key, l: <>{t.label} · {cur ? `v${cur.version}` : n ? 'no current' : 'none'}</> };
          })}
        />
      </div>
      <div style={{ marginBottom: 14 }}>
        <Callout tone="info">{hint} Published versions cannot be edited: draft the next one.</Callout>
      </div>

      <TableWrap>
        <table className="gx-tbl">
          <thead><tr><th>Version</th><th>Title</th><th>Status</th><th>Created</th><th>Published</th><th className="num">Accepted</th><th className="act" /></tr></thead>
          {loading ? <SkeletonRows rows={3} cols={7} /> : loadFailed ? <ErrorRow cols={7} onRetry={() => { setLoading(true); void load(); }} /> : mine.length === 0 ? (
            <EmptyRow cols={7} title="No agreement versions for this audience yet." text="Use “Draft a new version” to write the first one." />
          ) : (
            <tbody>
              {mine.map((a) => (
                <tr key={a.id} className="click" onClick={() => void openVersion(a.id)}>
                  <td className="mono strong">v{a.version}</td>
                  <td className="strong">{a.title}{a.summary && <div className="sub">{a.summary}</div>}</td>
                  <td><Pill tone={STATUS_UI[a.status].tone}>{STATUS_UI[a.status].label}</Pill></td>
                  <td className="nowrap">{fmt(a.createdAt)}</td>
                  <td className="nowrap">{fmt(a.publishedAt)}</td>
                  <td className="num">{a.acceptances}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Btn size="xs" onClick={() => void openVersion(a.id)}>Open</Btn>
                      {a.status === 'draft' && (
                        <Btn size="xs" variant="primary" disabled={busy === a.id} onClick={() => void publish(a)}>{busy === a.id ? 'Publishing…' : 'Publish'}</Btn>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </TableWrap>

      <Drawer
        open={opened != null}
        onClose={closeDrawer}
        title={opened ? opened.title : ''}
        sub={opened ? <>v{opened.version} · {audienceLabel(opened.audience)}</> : undefined}
        footer={opened && <>
          {opened.fileViewUrl && <Btn href={opened.fileViewUrl} target="_blank">Open PDF</Btn>}
          {opened.status === 'draft' && <>
            <Btn onClick={() => { setEditing(opened); setDrafting(false); setOpenId(null); }}>Edit draft</Btn>
            <Btn variant="primary" disabled={busy === opened.id} onClick={() => void publish(opened)}>{busy === opened.id ? 'Publishing…' : 'Publish'}</Btn>
          </>}
          <Btn onClick={closeDrawer}>Close</Btn>
        </>}
      >
        {opened && (
          <>
            <div style={{ marginBottom: 12 }}><Pill tone={STATUS_UI[opened.status].tone}>{STATUS_UI[opened.status].label}</Pill></div>
            {opened.summary && <p className="sub" style={{ marginBottom: 12 }}>{opened.summary}</p>}
            <KV items={[
              { k: 'Created', v: fmt(opened.createdAt) },
              { k: 'Published', v: fmt(opened.publishedAt) },
              { k: 'Effective', v: fmt(opened.effectiveFrom) },
              { k: 'Superseded', v: fmt(opened.supersededAt) },
              { k: 'PDF', v: opened.fileName ?? '—' },
              { k: 'Document sha256', v: opened.documentSha256 ? <span className="mono" title={opened.documentSha256}>{opened.documentSha256.slice(0, 12)}…</span> : '—' },
            ]} />
            {opened.bodyMd && (
              <div style={{ marginTop: 14 }}>
                <Card title="Agreement text" pad>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}><AgreementText md={opened.bodyMd} /></div>
                </Card>
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <Card title="Acceptance record" sub={`Append-only · ${opened.acceptances} accepted`}>
                <div className="gx-tbl-scroll">
                  <table className="gx-tbl">
                    <thead><tr><th>Who</th><th>Accepted</th><th>Where</th><th>IP</th><th>Device</th></tr></thead>
                    {!acceptances[opened.id] ? <SkeletonRows rows={2} cols={5} /> : acceptances[opened.id].length === 0 ? (
                      <EmptyRow cols={5} title="Nobody has accepted this version yet." />
                    ) : (
                      <tbody>
                        {acceptances[opened.id].map((x) => (
                          <tr key={x.id}>
                            <td className="strong">{x.userName || '—'}<div className="sub">{x.userEmail} · #{x.userId}</div></td>
                            <td className="nowrap">{fmt(x.acceptedAt)}</td>
                            <td>{x.context}</td>
                            <td className="mono">{x.ipAddress ?? '—'}</td>
                            <td title={x.userAgent ?? ''} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.userAgent ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    )}
                  </table>
                </div>
              </Card>
            </div>
          </>
        )}
      </Drawer>

      {(drafting || editing) && (
        <DraftForm
          key={editing ? `edit-${editing.id}` : `new-${audience}`}
          audience={editing?.audience ?? audience}
          existing={editing}
          onCancel={closeForm}
          onSaved={async () => { closeForm(); await load(); }}
        />
      )}
    </OsPage>
  );
}

/* ── Draft / edit form (kit Modal) ─────────────────────────────────────── */
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

  return (
    <Modal
      open
      onClose={onCancel}
      width={640}
      title={existing ? `Edit draft v${existing.version}` : `New ${audienceNoun(audience)} agreement version`}
      footer={<>
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || uploading || !version.trim() || !title.trim()} onClick={() => void save()}>
          {saving ? 'Saving…' : existing ? 'Save draft' : 'Create draft'}
        </Btn>
      </>}
    >
      <div className="gx-two">
        <Field label="Version" htmlFor="ag-version">
          <input id="ag-version" className="gx-inp" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" />
        </Field>
        <Field label="Title" htmlFor="ag-title">
          <input id="ag-title" className="gx-inp" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <Field label="Summary" hint="One paragraph shown above the checkbox." htmlFor="ag-summary">
        <textarea id="ag-summary" className="gx-ta" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
      </Field>
      <Field label="Agreement text" hint="Markdown: ## headings, paragraphs, - lists, **bold**, > note." htmlFor="ag-body">
        <textarea id="ag-body" className="gx-ta" value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} rows={12} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
      </Field>
      <Field label={file ? 'Replace PDF' : 'Attach PDF (optional)'} hint="Text and/or PDF — at least one is needed to publish." htmlFor="ag-pdf">
        <input id="ag-pdf" type="file" accept="application/pdf" className="gx-inp" disabled={uploading} onChange={(e) => void uploadPdf(e.target.files?.[0])} />
      </Field>
      {uploading && <Evid>Uploading PDF…</Evid>}
      {file && !uploading && <Evid tone="ok">Attached: {file.fileName}</Evid>}
      {error && <div style={{ marginTop: 10 }}><Callout tone="bad">{error}</Callout></div>}
    </Modal>
  );
}
