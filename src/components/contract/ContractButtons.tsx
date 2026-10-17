'use client';

/**
 * The tenancy contract as ACTIONS (no inline preview) — a "View contract" button
 * that opens a full-screen canvas viewer plus a "Download contract" link. For
 * surfaces where the contract is a document to take away rather than something to
 * read on the page (the customer magic-link portal once it has been signed).
 *
 * Same bytes feed both actions, and they are the SAME bytes EjariInline renders:
 * Dubai → the official DLD template filled with the contract data (pdf-lib),
 * elsewhere → the @react-pdf vector document. Display goes through EjariCanvas
 * (pdf.js) because a blob <iframe> renders blank on mobile browsers.
 * @react-pdf needs the browser, so load this via next/dynamic with ssr:false.
 */
import { useState } from 'react';
import { EjariContractDoc, ejariDocKey, type EjariContractData, type EjariAddendum } from './EjariContractPdf';
import { isDubaiContract } from '@/lib/ejariFill';
import { useFilledEjari } from './useFilledEjari';
import { useReactPdfDoc } from './useReactPdfDoc';
import { leaseDocFileName } from '@/lib/leaseDocName';
import EjariCanvas from './EjariCanvas';

const VIEW_BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 12, background: '#047246', color: '#fff', border: 'none' };
const DL_LINK: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 12, background: '#fff', color: '#047246', border: '1px solid #cfe9e0', textDecoration: 'none' };
const VIEWER_WRAP: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' };
const VIEWER_BAR: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd', gap: 12, flexWrap: 'wrap' };
const CLOSE_BTN: React.CSSProperties = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' };
const BAR_DL_BTN: React.CSSProperties = { padding: '6px 16px', background: '#1f3d5c', color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' };

export default function ContractButtons({ data, addendums = [], subtitle, trigger }: {
  data: EjariContractData; addendums?: EjariAddendum[];
  /** Caption under the title in the full-screen viewer bar. */
  subtitle?: string;
  /** Render your own single control instead of the default View + Download pair.
   *  `open()` shows the in-page viewer, `url` is the generated blob (open it in a
   *  new tab to hand the reader the browser's own PDF view, save included), and
   *  `ready` is false while the PDF is still generating. */
  trigger?: (open: () => void, ready: boolean, url: string | null) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dubai = isDubaiContract(data);
  // Both hooks run unconditionally (rules of hooks); each takes an `enabled` flag
  // so only the branch actually used does work — same split as EjariInline.
  const { bytes: dubaiBytes, url: dubaiUrl, error: dubaiErr } = useFilledEjari(data, addendums, dubai);
  const { bytes: vectorBytes, url: vectorUrl, error: vectorErr } = useReactPdfDoc(
    () => <EjariContractDoc data={data} addendums={addendums} />,
    ejariDocKey(data, addendums),
    !dubai,
  );
  const bytes = dubai ? dubaiBytes : vectorBytes;
  const url = dubai ? dubaiUrl : vectorUrl;
  const error = dubai ? dubaiErr : vectorErr;
  const ref = data.ref ?? 'contract';
  const fileName = leaseDocFileName('Tenancy-Contract', { unitNumber: data.unit?.number, ref });

  return (
    <>
      {trigger ? trigger(() => setOpen(true), !!bytes, url) : (
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(true)} disabled={!bytes}
          style={{ ...VIEW_BTN, opacity: bytes ? 1 : 0.6, cursor: bytes ? 'pointer' : 'default' }}>
          View contract
        </button>
        {url
          ? <a href={url} download={fileName} style={DL_LINK}>⬇ Download contract</a>
          : <span style={{ ...DL_LINK, opacity: 0.6 }}>⏳ Preparing…</span>}
      </div>
      )}
      {open && (
        <div style={VIEWER_WRAP} role="dialog" aria-modal="true">
          <div style={VIEWER_BAR}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Tenancy contract — {ref}</p>
              {subtitle && <p style={{ margin: 0, fontSize: 12, color: '#666' }}>{subtitle}</p>}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={() => setOpen(false)} style={CLOSE_BTN}>✕ Close</button>
              {url && <a href={url} download={fileName} style={BAR_DL_BTN}>⬇ Download PDF</a>}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {error
              ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 16, color: '#fff', fontSize: 13 }}>Preview unavailable — use “⬇ Download PDF” above.</div>
              : <EjariCanvas bytes={bytes} fill />}
          </div>
        </div>
      )}
    </>
  );
}
