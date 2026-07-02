'use client';

import type { CSSProperties } from 'react';

/**
 * A small right-aligned "⬇ Download PDF" row for the embeddable generated-document
 * previews in the contract documents binder (Payment plan · Receipts · Agreement).
 * These are the customer's own generated documents — clean, watermark-free blobs
 * (the anti-exfiltration watermark is only for uploaded KYC/ID docs). Reuses the
 * object-URL the inline component already produced, so no extra PDF generation.
 */
const LINK: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#1f6f54', textDecoration: 'none' };
const WRAP: CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #efece6', display: 'flex', justifyContent: 'flex-end', background: '#fbfaf8' };

export function InlineDownloadRow({ url, fileName }: { url: string | null; fileName: string }) {
  return (
    <div style={WRAP}>
      {url
        ? <a href={url} download={fileName} style={LINK}>⬇ Download PDF</a>
        : <span style={{ ...LINK, color: '#b8b5ae' }}>⏳ Preparing…</span>}
    </div>
  );
}
