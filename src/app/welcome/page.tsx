/**
 * Post-registration welcome page — Phase 3c.
 *
 * Customer just verified their email/phone and lands here BEFORE the
 * marketplace. We recommend uploading the three KYC docs so the eventual
 * booking journey skips Step 2 (docs_required) and routes straight to
 * docs_under_review.
 *
 * Hard rules:
 *  - Everything on this page is OPTIONAL. The "Skip for now" link always
 *    works and lands the customer at `/` (marketplace).
 *  - We never block the user. No required-field guards, no validation.
 *  - We do NOT inspect docs against a list — admin reviews after upload.
 *
 * Why a separate page instead of inlining into the booking flow:
 *  - Customers register long before they book — collecting KYC at the
 *    "I'm warm" moment compresses the eventual booking timeline.
 *  - Step 2 of the booking journey stays as the safety net for anyone
 *    who skips here.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { KYC_DOCS, type DocReq } from '@/lib/docRequirements';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';

type DocSlot = { documentKey: string; fileUrl?: string | null; status?: string };

export default function WelcomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [tenantProfileId, setTenantProfileId] = useState<number | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, DocSlot>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();

  // Bounce non-customers away — this page is customer-only onboarding.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (user.role !== 'customer') { router.replace('/'); return; }
  }, [authLoading, user, router]);

  // Load (or lazy-create) the tenant profile + the docs already on file.
  useEffect(() => {
    if (!user || user.role !== 'customer') return;
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch('/api/profiles/customer/me', { credentials: 'include' });
        if (!meRes.ok) throw new Error('Profile load failed');
        const me = await meRes.json() as { profile: { id: number } };
        if (cancelled) return;
        setTenantProfileId(me.profile.id);

        const docsRes = await fetch(`/api/documents?ownerType=customer&ownerId=${me.profile.id}`, { credentials: 'include' });
        if (docsRes.ok) {
          const list = await docsRes.json() as DocSlot[];
          if (cancelled) return;
          const map: Record<string, DocSlot> = {};
          for (const d of list) map[d.documentKey] = d;
          setUploaded(map);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function handleUpload(req: DocReq, file: File) {
    if (!tenantProfileId) { setError('Profile not ready — please retry in a moment.'); return; }
    // Photos go through the scan modal first; PDFs pass straight through.
    // Null = the user closed the scanner — abort the upload.
    const scanned = await scan(file);
    if (!scanned) return;
    file = scanned;
    setUploadingKey(req.key); setError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: req.key, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) throw new Error('Failed to start upload');
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('File upload failed');
      const regRes = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: req.key, category: req.category ?? 'identity',
          displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey,
          isVisibleToTenant: true,
        }),
      });
      if (!regRes.ok) throw new Error('Document save failed');
      const saved = await regRes.json() as DocSlot;
      setUploaded(prev => ({ ...prev, [req.key]: saved }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingKey(null);
    }
  }

  const total = KYC_DOCS.length;
  const done = KYC_DOCS.filter(d => !!uploaded[d.key]).length;
  const allDone = done === total;

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--surface, #f7f5f0)',
      padding: '48px 24px',
      display: 'flex', justifyContent: 'center',
    }}>
      {scannerModal}
      <div style={{ maxWidth: 600, width: '100%', display: 'grid', gap: 24 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <p style={{
            fontSize: 11, fontWeight: 700, color: 'var(--jade-deep, #1f6655)',
            textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0,
          }}>Welcome to UpNow</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink, #14201a)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            Add your documents now — book in seconds later.
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink-2, #4a4944)', margin: 0, lineHeight: 1.5 }}>
            Upload your Emirates ID, Passport and UAE Visa once. Every future booking skips the paperwork step and goes straight to landlord review.
          </p>
        </header>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 10, background: 'var(--paper, #fff)',
          border: '1px solid var(--mist-strong, #d6d4ce)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
            {done} of {total} uploaded
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: allDone ? 'var(--jade-deep, #1f6655)' : 'var(--mute, #8a948d)' }}>
            {allDone ? 'All set — landlord will review on first booking' : 'Optional — you can skip and add later'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {KYC_DOCS.map(req => (
            <KycCard
              key={req.key}
              req={req}
              uploaded={uploaded[req.key]}
              busy={uploadingKey === req.key}
              onPick={(file) => handleUpload(req, file)}
            />
          ))}
        </div>

        {error && (
          <div role="alert" style={{
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--brick-soft, #fde2e2)', color: '#7f1d1d',
            fontSize: 12, fontWeight: 500,
          }}>{error}</div>
        )}

        <div style={{
          display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', marginTop: 4,
        }}>
          <Link
            href="/"
            data-testid="kyc-skip"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--mute, #8a948d)', textDecoration: 'none' }}
          >
            Skip for now
          </Link>
          <button
            type="button"
            data-testid="kyc-continue"
            onClick={() => router.push('/')}
            style={{
              padding: '12px 24px', borderRadius: 12, border: 'none',
              background: allDone ? 'var(--jade-deep, #1f6655)' : 'var(--ink, #14201a)',
              color: 'var(--paper, #fff)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {allDone ? 'Continue to marketplace' : done > 0 ? 'Continue — finish later' : 'Take me to listings'}
          </button>
        </div>
      </div>
    </main>
  );
}

function KycCard({ req, uploaded, busy, onPick }: {
  req: DocReq;
  uploaded: DocSlot | undefined;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const done = !!uploaded;

  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', borderRadius: 12,
      background: done ? 'rgba(4,114,70,0.08)' : 'var(--paper, #fff)',
      border: `1px solid ${done ? 'rgba(4,114,70,0.35)' : 'var(--mist-strong, #d6d4ce)'}`,
      cursor: busy ? 'progress' : 'pointer',
    }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
        style={{ display: 'none' }}
        data-testid={`kyc-input-${req.key}`}
      />
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        display: 'grid', placeItems: 'center',
        background: done ? 'var(--jade-deep, #1f6655)' : 'var(--mist, #ede9e3)',
        color: done ? 'var(--paper, #fff)' : 'var(--mute, #8a948d)',
        fontSize: 14, fontWeight: 700,
      }}>
        {done ? '✓' : '+'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink, #14201a)', margin: 0 }}>{req.label}</p>
        {req.hint && (
          <p style={{ fontSize: 11, color: 'var(--mute, #8a948d)', margin: '2px 0 0', lineHeight: 1.4 }}>
            {req.hint}
          </p>
        )}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: done ? 'var(--jade-deep)' : 'var(--mute)' }}>
        {busy ? 'Uploading…' : done ? 'Uploaded' : 'Choose file'}
      </span>
    </label>
  );
}
