'use client';

/**
 * The attach control that sits on a payment row / group heading of a
 * SegregatedPlanView — the SAME control on the customer's Payments step and on
 * the landlord's Collect-the-cheques step, so a cheque is attached, viewed,
 * replaced and removed in one place, the row it pays, on both sides.
 *
 * It is not just an upload button: whatever was attached has to be viewable and
 * removable from the same place, otherwise a reference tagged to a payment is
 * write-only for whoever did not upload it.
 */
import { ExternalLink, UploadCloud, Trash2 } from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';
import type { PlanAttachSlot } from '@/components/upnow/SegregatedPlanView';

export interface PlanAttachRef {
  id: number;
  imageUrl?: string | null;
}

export function PlanAttachCell({ slot, refs, uploading, onFiles, onRemove, readOnly = false }: {
  slot: PlanAttachSlot;
  refs: PlanAttachRef[];
  uploading: number;
  /** `replaceIds` are dropped only AFTER the new files are stored. */
  onFiles: (label: string, files: FileList | null, replaceIds?: number[]) => void;
  onRemove: (id: number) => void;
  /** View only — a manager without the collections authority still sees what is attached. */
  readOnly?: boolean;
}) {
  const viewable = refs.filter(r => !!r.imageUrl);
  // One line, one control each: open it · add to it · delete it. No thumbnail —
  // it opened the same viewer "View" does, so the row carried the same action
  // twice in the width of a table cell.
  const openAll = () => openDocViewer(
    viewable.map(r => ({ fileUrl: r.imageUrl as string, caption: slot.label })),
    slot.label,
  );
  return (
    // Wraps rather than overflows: in a narrow card the three controls don't fit
    // on one line, and clipping them is what made the row look like it had no
    // attach option at all.
    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 7 }}>
      {viewable.length > 0 && (
        <button type="button" onClick={openAll} title={`View what is attached to ${slot.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', padding: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--jade-deep)', cursor: 'pointer' }}>
          <ExternalLink size={11} /> View{viewable.length > 1 ? ` (${viewable.length})` : ''}
        </button>
      )}
      {readOnly && refs.length === 0 && (
        <span style={{ fontSize: 10.5, color: 'var(--mute)' }}>Not attached</span>
      )}
      {/* "Replace", not "Attached" — every control on this row is an action, and
          it genuinely replaces: the files picked here become the ONLY ones on
          this payment. The count moves onto View, which is what it describes. */}
      {!readOnly && (
        <label
          title={refs.length
            ? `Replace the ${refs.length > 1 ? `${refs.length} files` : 'file'} attached to this payment`
            : 'Attach a cheque photo, transfer screenshot, card slip or cash receipt'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
            border: `1px solid ${refs.length ? 'rgba(46,159,130,0.4)' : 'var(--mist-strong)'}`,
            background: refs.length ? 'rgba(46,159,130,0.07)' : 'var(--paper)',
            cursor: uploading ? 'progress' : 'pointer', fontSize: 11, fontWeight: 700,
            color: refs.length ? 'var(--jade-deep)' : 'var(--ink-2)', whiteSpace: 'nowrap',
          }}>
          <input type="file" accept="image/*,application/pdf" multiple disabled={uploading > 0}
            onChange={(e) => { onFiles(slot.label, e.target.files, refs.map(r => r.id)); e.target.value = ''; }}
            style={{ display: 'none' }} />
          <UploadCloud size={12} /> {refs.length ? 'Replace' : 'Attach'}
        </label>
      )}
      {!readOnly && refs.length > 0 && (
        <button type="button" onClick={() => refs.forEach(r => onRemove(r.id))}
          title={refs.length > 1 ? `Delete all ${refs.length} files for this payment` : 'Delete this file'}
          aria-label={refs.length > 1 ? `Delete all ${refs.length} files for ${slot.label}` : `Delete the file for ${slot.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
