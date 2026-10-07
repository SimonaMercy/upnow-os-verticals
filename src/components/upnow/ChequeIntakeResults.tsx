'use client';

import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import type { ChequeIntake, IntakeCheque, IntakeFile } from '@/lib/planAttach';

/**
 * What the reader made of the cheques on file — one line per cheque: where it
 * was placed, or why it was not. Shared by the customer's renewal Payments step
 * and the landlord's Collect-the-cheques step, so both read the same words.
 */

const fmtAed = (n: number | null) => (n == null ? '' : `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 2 })}`);
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'undated');

function whereInFile(file: IntakeFile, q: IntakeCheque): string {
  if (file.cheques.length < 2) return '';
  const pages = new Set(file.cheques.map(c => c.page)).size;
  if (pages > 1 && q.page != null) return ` · page ${q.page}`;
  return q.position ? ` · ${q.position}` : ` · cheque ${q.index + 1} of ${file.cheques.length}`;
}

export function ChequeIntakeResults({ intake, onRemove, onRetry }: {
  intake: ChequeIntake;
  /** Remove a file so a better one can be attached. */
  onRemove?: (documentId: number) => void;
  /** Read a file again (landlord side). */
  onRetry?: (documentId: number) => void;
}) {
  if (intake.files.length === 0) return null;
  const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, background: 'var(--surface, #fff)', border: '1px solid var(--mist-strong, #e5e2da)' };
  const good = 'var(--jade-deep, #1a7a52)';
  const bad = 'var(--saffron-deep, #c2410c)';
  const mini: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: 0, color: 'var(--mute, #777)', flexShrink: 0 };

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="cheque-intake-results">
      {intake.files.flatMap(file => {
        if (file.status !== 'done') {
          return [(
            <div key={file.documentId} style={row}>
              <AlertTriangle size={15} style={{ color: bad, flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                <div style={{ fontWeight: 600, color: bad }}>This file could not be read</div>
                <div style={{ color: 'var(--ink-2, #555)' }}>{file.name} — attach a clearer photo or scan of the cheque.</div>
              </div>
              {onRetry && <button type="button" style={mini} onClick={() => onRetry(file.documentId)}>Read again</button>}
              {onRemove && <button type="button" style={mini} onClick={() => onRemove(file.documentId)}>Remove</button>}
            </div>
          )];
        }
        if (file.cheques.length === 0) {
          return [(
            <div key={file.documentId} style={row}>
              <FileText size={15} style={{ color: 'var(--mute, #777)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-2, #555)' }}>
                <span style={{ fontWeight: 600 }}>{file.documentType === 'transfer' ? 'Transfer or receipt' : 'Not a cheque'}</span> · {file.name} — kept as attached.
              </div>
            </div>
          )];
        }
        return file.cheques.map(q => {
          const ok = q.outcome === 'matched';
          return (
            <div key={`${file.documentId}-${q.index}`} style={row}>
              {ok
                ? <CheckCircle2 size={15} style={{ color: good, flexShrink: 0, marginTop: 2 }} />
                : <AlertTriangle size={15} style={{ color: bad, flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink, #222)' }}>
                  {q.chequeNumber ? `Cheque ${q.chequeNumber}` : 'Cheque'}
                  {q.bankName ? ` · ${q.bankName}` : ''}
                  {q.amount != null ? ` · ${fmtAed(q.amount)}` : ''}
                  {` · ${q.date ? `dated ${fmtDate(q.date)}` : 'undated'}`}
                </div>
                {ok ? (
                  <div style={{ color: good }}>
                    Placed on {q.paysFor.join(' + ')}
                    {q.byOrder ? ' — by its cheque number, as it has no date. Please check.' : ''}
                  </div>
                ) : (
                  <div style={{ color: bad }}>{q.reason}</div>
                )}
                <div style={{ color: 'var(--mute, #777)', fontSize: 11.5 }}>{file.name}{whereInFile(file, q)}</div>
              </div>
              {!ok && onRemove && file.cheques.length === 1 && <button type="button" style={mini} onClick={() => onRemove(file.documentId)}>Remove</button>}
            </div>
          );
        });
      })}
      {intake.open.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-2, #555)' }}>
          Still without a cheque: {intake.open.map(p => `${p.description} (${fmtAed(p.amount)})`).join(', ')}.
        </div>
      )}
    </div>
  );
}
