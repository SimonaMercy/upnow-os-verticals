'use client';

/**
 * Shared inspection report — the single layout used by the RP workspace (editable)
 * and the tenant-facing viewer (read-only), for both move-in and move-out.
 * Matches Mockups/customer-rental-journey/inspection-report-template.html.
 *
 * Variants are driven by props:
 *   - editable (RP): 3-option Good/Fair/Poor condition picker, Qty + Notes inputs.
 *   - audience='customer': read-only, and NO money (Cost column / cost tile / cost total hidden).
 *   - phase: move_in has no amounts and no Move-Out-Date box; move_out adds the auto-calc Cost.
 */

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Home, Calendar, ClipboardCheck, User, Users, Layers, Wrench, Banknote, AlertTriangle,
  Plus, FileText, DoorClosed, Shirt, AppWindow, Grid3x3, Zap, Utensils,
  Bath, Trees, Wind, KeyRound, Sparkles, Paintbrush, Package, Camera, X, Loader2,
  ZoomIn, ImageOff,
} from 'lucide-react';
import {
  InspectionDoc, InspectionItem, InspectionPhoto, Condition,
  computeInspectionTotals, quantityOf, canonicalKey,
} from '@/lib/inspectionCatalog';
import { displayInspectionPhotoUrl } from '@/lib/inspectionPhotos';
import { PhotoLightbox, type GalleryPhoto } from '@/components/upnow/PhotoGallery';
import s from './InspectionReportView.module.css';

type Phase = 'move_in' | 'move_out';
type Audience = 'rp' | 'customer';

export interface ReportMeta {
  property: string; unitNo: string; propertyType: string; floor: string;
  tenantName: string; tenantPhone: string; tenantEmail: string;
  inspectorName: string; inspectorCompany: string; inspectorRole: string;
}
export interface ReportDates { inspectionDate?: string | null; moveInDate?: string | null; moveOutDate?: string | null; }
export interface ReportSignatures {
  tenantSig?: string | null; tenantSignedAt?: string | null;
  rpSig?: string | null; rpSignedAt?: string | null;
}

interface Props {
  doc: InspectionDoc;
  meta: ReportMeta;
  phase: Phase;
  audience: Audience;
  dates?: ReportDates;
  editable?: boolean;
  onPatch?: (sectionId: string, itemId: string, patch: Partial<InspectionItem>) => void;
  onAddCategory?: () => void;
  /** Editable move-out: add a sub-category/component to a category (opens the
   *  restoration-list picker in the workspace). Also enables per-row remove. */
  onAddComponent?: (sectionId: string) => void;
  onRemoveComponent?: (sectionId: string, itemId: string) => void;
  onRemoveCategory?: (sectionId: string) => void;
  generalNotes?: string;
  onGeneralNotes?: (v: string) => void;
  /** When provided (and editable), the "Inspected By" field becomes an editable
   *  input. It defaults to whoever saved/submitted the report (stamped server-side),
   *  and can be overridden here with the actual inspector's name. */
  onInspectorName?: (v: string) => void;
  /** Move-out only: when provided (and editable), the Move-Out Date box becomes an
   *  editable date input. The move-out date can shift while the inspection is out
   *  for signature, so this stays available until the inspection is approved. */
  onMoveOutDate?: (v: string) => void;
  signatures?: ReportSignatures;
  signSlot?: ReactNode;
  /** Move-out only: override whether the Cost column / totals show. Defaults to
   *  `audience === 'rp'` (RP sees amounts, customer doesn't). */
  showPrices?: boolean;
  /** Per-item photo attachments. When onAddItemPhotos is provided AND editable,
   *  each row shows an "Add photo" control; thumbnails render read-only otherwise. */
  onAddItemPhotos?: (sectionId: string, itemId: string, files: File[]) => void;
  onRemoveItemPhoto?: (sectionId: string, itemId: string, photoId: string) => void;
  /** Item id currently uploading — shows a spinner on that row's add button. */
  uploadingItemId?: string | null;
  /** Report-level photo gallery. Per-item attachments answer "what is wrong with
   *  THIS component"; these answer "here is the whole walk-through" — the manager
   *  / landlord / inspector selects the images in bulk rather than one row at a
   *  time. Read-only (thumbnails only) when onAddPhotos is omitted. */
  photos?: InspectionPhoto[];
  onAddPhotos?: (files: File[]) => void;
  onRemovePhoto?: (photoId: string) => void;
  photosUploading?: boolean;
  photosProgress?: { done: number; total: number } | null;
  /** Hide the built-in two-party signature block (e.g. the portal supplies its own). */
  hideSignatures?: boolean;
}

const AED = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
const cap = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : '');
/** Unit types are stored as snake_case enums (`staff_accommodation`) — print them
 *  as words: "Staff Accommodation". */
const titleCase = (v: string) =>
  (v ?? '').split(/[_\-\s]+/).filter(Boolean).map(cap).join(' ');
/** A bare YYYY-MM-DD for a native date <input> (Dubai-local), or '' if unparseable. */
function toDateInput(d?: string | null): string {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
}

const CAT_ICON: Record<string, typeof Home> = {
  doors: DoorClosed, closet: Shirt, wardrobe: Shirt, windows: AppWindow, walls_ceiling: Layers,
  flooring: Grid3x3, electrical: Zap, kitchen: Utensils, bathroom: Bath, balcony_outdoor: Trees,
  ac_system: Wind, keys_access: KeyRound, deep_cleaning: Sparkles, painting: Paintbrush,
};
function catIconFor(key: string) { return CAT_ICON[canonicalKey(key)] ?? Package; }

const COND_OPTS: Exclude<Condition, ''>[] = ['good', 'fair', 'poor'];

export function InspectionReportView({
  doc, meta, phase, audience, dates, editable = false,
  onPatch, onAddCategory, onAddComponent, onRemoveComponent, onRemoveCategory,
  generalNotes, onGeneralNotes, onInspectorName, onMoveOutDate, signatures, signSlot, showPrices,
  onAddItemPhotos, onRemoveItemPhoto, uploadingItemId, hideSignatures,
  photos, onAddPhotos, onRemovePhoto, photosUploading, photosProgress,
}: Props) {
  const isMoveIn = phase === 'move_in';
  const showMoney = phase === 'move_out' && (showPrices ?? audience === 'rp');
  const totalCols = 6 + (showMoney ? 1 : 0);
  const canAddComponent = editable && !!onAddComponent;
  const totals = useMemo(() => computeInspectionTotals(doc, phase), [doc, phase]);
  const categories = doc.categories ?? [];

  const patch = (sectionId: string, itemId: string, p: Partial<InspectionItem>) => onPatch?.(sectionId, itemId, p);

  return (
    <div className={s.report}>
      {/* Title + date boxes */}
      <div className={s.titlerow}>
        <div className={s.title}>
          <div>
            {/* Phase lives in the "Inspection Type" box beside the title, so the
                heading itself stays the neutral document name. */}
            <h1>INSPECTION REPORT</h1>
          </div>
        </div>
        <div className={s.dates}>
          <DateBox icon={<Calendar />} k="Move-In Date" v={fmtDate(dates?.moveInDate)} />
          {!isMoveIn && (
            /* The move-out date can shift while the inspection is out for signature,
               so it stays editable (caller passes onMoveOutDate) even when the rest
               of the report is locked from editing. */
            onMoveOutDate
              ? <EditableDateBox icon={<Calendar />} k="Move-Out Date" value={toDateInput(dates?.moveOutDate)} onChange={onMoveOutDate} />
              : <DateBox icon={<Calendar />} k="Move-Out Date" v={fmtDate(dates?.moveOutDate)} />
          )}
          <DateBox icon={<ClipboardCheck />} k="Inspection Type" v={isMoveIn ? 'Move-In' : 'Move-Out'} />
        </div>
      </div>

      {/* Detail cards */}
      <div className={s.cards}>
        <DetailCard icon={<Home />} title="Property Details" rows={[
          ['Property Name', meta.property], ['Unit No.', meta.unitNo], ['Property Type', titleCase(meta.propertyType)], ['Floor', meta.floor],
        ]} />
        <DetailCard icon={<User />} title="Tenant Details" rows={[
          ['Tenant Name', meta.tenantName], ['Phone', meta.tenantPhone], ['Email', meta.tenantEmail],
        ]} />
        <DetailCard icon={<Users />} title="Inspection Team" rows={[
          ['Inspected By', editable && onInspectorName
            ? <input value={meta.inspectorName} placeholder="Inspector name"
                onChange={(e) => onInspectorName(e.target.value)} aria-label="Inspected by"
                style={{ font: 'inherit', fontWeight: 600, color: '#14201a', border: '1px solid #e4e9e5', borderRadius: 6, padding: '2px 6px', width: '100%', minWidth: 0, background: '#fff' }} />
            : (meta.inspectorName || '—')],
          ['Role', meta.inspectorRole || 'Property Representative'],
        ]} />
      </div>

      {/* Tiles — hidden on move-in (Total Categories / Total Items / Items Flagged
          removed per request); move-out keeps its replacement + cost summary. */}
      {!isMoveIn && (
        <div className={`${s.tiles} ${showMoney ? '' : s.three}`}>
          <div className={`${s.tile} ${s.cat}`}><span className={`${s.tIc} ${s.ico}`}><Layers /></span><div className={s.body}><span className={s.l}>Total Categories</span><span className={s.num}>{totals.categories}</span></div></div>
          <div className={`${s.tile} ${s.items}`}><span className={`${s.tIc} ${s.ico}`}><ClipboardCheck /></span><div className={s.body}><span className={s.l}>Total Items</span><span className={s.num}>{totals.items}</span></div></div>
          <div className={`${s.tile} ${s.replace}`}><span className={`${s.tIc} ${s.ico}`}><Wrench /></span><div className={s.body}><span className={s.l}><span className={s.warn}><AlertTriangle /></span>{isMoveIn ? 'Items Flagged' : 'Items to be Replaced'}</span><span className={s.num}>{isMoveIn ? totals.defective : totals.itemsToReplace}</span></div></div>
          {showMoney && <div className={`${s.tile} ${s.cost}`}><span className={`${s.tIc} ${s.ico}`}><Banknote /></span><div className={s.body}><span className={s.l}><span className={s.warn}><AlertTriangle /></span>Estimated Total Cost (AED)</span><span className={`${s.num} ${s.tabnum}`}>{AED(totals.estCostAed)}</span></div></div>}
        </div>
      )}

      {/* Component table */}
      <div className={s.secH}>
        <h2>Component Inspection Details</h2>
        {editable && <button type="button" className={s.addbtn} onClick={onAddCategory}><span className={s.ico}><Plus /></span>Add Additional Category</button>}
      </div>
      <div className={s.tblWrap}>
        <table className={s.comp}>
          <thead>
            <tr>
              <th className={s.center} style={{ width: 42 }}>No.</th>
              <th style={{ width: 158 }}>Main Category<span className={s.thSub}>(No. of Items in Property)</span></th>
              <th style={{ minWidth: 190 }}>Sub Category / Component</th>
              <th className={s.center} style={{ width: editable ? 152 : 118 }}>Condition<span className={s.thSub}>(Good / Fair / Poor)</span></th>
              <th className={s.center} style={{ width: 104 }}>{isMoveIn ? 'Quantity' : 'No. of Items to be Replaced'}</th>
              {showMoney && <th className={s.right} style={{ width: 94 }}>Cost (AED)</th>}
              <th style={{ minWidth: 170 }}>Remarks / Notes</th>
            </tr>
          </thead>
          <tbody>
            {editable && categories.length === 0 && (
              <tr>
                <td colSpan={totalCols}>
                  <div style={{ padding: '22px 8px', textAlign: 'center', color: '#8a948d', fontSize: 13 }}>
                    No components yet. Use <b>Add Additional Category</b> above to build this {isMoveIn ? 'move-in' : 'move-out'} inspection from the restoration list.
                  </div>
                </td>
              </tr>
            )}
            {categories.map((cat, ci) => {
              const CatIcon = catIconFor(cat.key);
              // A freshly-added (or emptied) category still shows its header row plus
              // the add / remove affordances so it can be built up or discarded.
              if (cat.items.length === 0) {
                if (!editable) return null;
                return (
                  <tr key={`${cat.sectionId}:empty`} className={s.catLast}>
                    <td className={s.catnumCell}><span className={s.catnumBig}>{ci + 1}</span></td>
                    <td className={s.catnameCell}>
                      <div className={s.catcell}>
                        <span className={s.caticon}><CatIcon size={18} /></span>
                        <div><div className={s.catname}>{cat.label || 'Untitled category'}</div></div>
                      </div>
                    </td>
                    <td colSpan={totalCols - 2}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                        {canAddComponent && <AddComponentButton onClick={() => onAddComponent!(cat.sectionId)} />}
                        {onRemoveCategory && (
                          <button type="button" onClick={() => onRemoveCategory(cat.sectionId)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            <X size={12} /> Remove category
                          </button>
                        )}
                        <span style={{ fontSize: 11, color: '#c0bdb8' }}>No components yet — add from the restoration list.</span>
                      </div>
                    </td>
                  </tr>
                );
              }
              const n = cat.items.length;
              const rows: ReactNode[] = cat.items.map((it, ri) => {
                const cond = (isMoveIn ? it.inCondition : it.outCondition) ?? '';
                const qty = quantityOf(it);
                const rmk = it.remarks ?? '';
                const isLast = ri === n - 1 && !canAddComponent;
                return (
                  <tr key={it.id} className={isLast ? s.catLast : undefined}>
                    {ri === 0 && (
                      <>
                        <td className={s.catnumCell} rowSpan={n}><span className={s.catnumBig}>{ci + 1}</span></td>
                        <td className={s.catnameCell} rowSpan={n}>
                          <div className={s.catcell}>
                            <span className={s.caticon}><CatIcon size={18} /></span>
                            <div><div className={s.catname}>{cat.label}</div></div>
                          </div>
                        </td>
                      </>
                    )}
                    <td className={s.compCell}>
                      <span className={s.rn}>{ci + 1}.{ri + 1}</span>{it.componentName}
                      {editable && onRemoveComponent && (
                        <button type="button" aria-label="Remove component" title="Remove this component"
                          onClick={() => onRemoveComponent(cat.sectionId, it.id)}
                          style={{ marginLeft: 6, verticalAlign: 'middle', color: '#c8c6be', background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                          <X size={12} />
                        </button>
                      )}
                    </td>
                    <td className={s.center}>
                      {editable ? (
                        <span className={s.condPick}>
                          {COND_OPTS.map((c) => (
                            <button key={c} type="button"
                              className={`${s.cp} ${s[c]} ${cond === c ? s.on : ''}`}
                              onClick={() => patch(cat.sectionId, it.id, isMoveIn ? { inCondition: c } : { outCondition: c })}
                            >{cap(c)}</button>
                          ))}
                        </span>
                      ) : (
                        cond
                          ? <span className={`${s.cond} ${s[cond]}`}><span className={s.dot} />{cap(cond)}</span>
                          : <span className={`${s.cond} ${s.condEmpty}`}>—</span>
                      )}
                    </td>
                    <td className={s.center}>
                      {editable
                        ? <input className={s.qtyIn} type="number" min={0} value={qty || ''} placeholder="0"
                            onChange={(e) => patch(cat.sectionId, it.id, { quantity: Number(e.target.value) || 0 })} aria-label="Quantity" />
                        : <span className={s.qtyRo}>{qty || '—'}</span>}
                    </td>
                    {showMoney && <td className={s.right}><span className={s.costV}>{(it.totalCostAed ?? 0) ? AED(it.totalCostAed as number) : '—'}</span></td>}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {editable
                          ? <input className={s.rmkIn} value={rmk} placeholder="Add a note…"
                              onChange={(e) => patch(cat.sectionId, it.id, { remarks: e.target.value })} aria-label="Remarks" />
                          : <span className={s.rmkRo}>{rmk}</span>}
                        <ItemPhotos
                          item={it}
                          editable={editable && audience === 'rp' && !!onAddItemPhotos}
                          uploading={uploadingItemId === it.id}
                          onAdd={onAddItemPhotos ? (files) => onAddItemPhotos(cat.sectionId, it.id, files) : undefined}
                          onRemove={onRemoveItemPhoto ? (pid) => onRemoveItemPhoto(cat.sectionId, it.id, pid) : undefined}
                        />
                      </div>
                    </td>
                  </tr>
                );
              });
              if (canAddComponent) {
                rows.push(
                  <tr key={`${cat.sectionId}:add`} className={s.catLast}>
                    <td colSpan={totalCols}>
                      <AddComponentButton onClick={() => onAddComponent!(cat.sectionId)} />
                    </td>
                  </tr>,
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>

      {/* The estimated-cost + item-count totals already live in the summary tiles
          above — no duplicated footer totals here. */}

      {/* General Notes */}
      <div className={s.notesWrap}>
        <div className={s.panel}>
          <h4><span className={s.ico}><FileText /></span>General Notes</h4>
          {editable
            ? <textarea className={s.notesIn} rows={4} value={generalNotes ?? ''} placeholder="Overall notes about the property condition…" onChange={(e) => onGeneralNotes?.(e.target.value)} />
            : <div className={s.notesRo}>{generalNotes || '—'}</div>}
        </div>
      </div>

      {/* Walk-through photos — bulk upload for the whole report. */}
      <ReportPhotos
        photos={photos ?? []}
        onAdd={onAddPhotos}
        onRemove={onRemovePhoto}
        uploading={!!photosUploading}
        progress={photosProgress ?? null}
      />

      {/* Signatures — bordered two-party block. Hidden when the caller supplies its
          own sign box (e.g. the magic-link portal). */}
      {!hideSignatures && (
      <div className={s.sigSection}>
        <div className={s.sigBar}>Signatures</div>
        <div className={s.sigBox}>
          <div className={`${s.sigCell} ${s.sigCellDivider}`}>
            {/* Inspector cell names the PERSON who inspected and their role — the
                landlord's own name/company is not repeated here. */}
            <div className={s.sigRole}>Inspected By — Property Representative</div>
            <div className={s.sigName}>{meta.inspectorName || '—'}</div>
            <div className={s.sigCompany}>{meta.inspectorRole || 'Property Representative'}</div>
            <div className={s.sigPad}>
              {signatures?.rpSig
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={signatures.rpSig} alt="Inspector signature" />
                : <span className={s.sigPlaceholder}>Not yet signed</span>}
            </div>
            <div className={s.sigFoot}><span>Signature</span><span className={s.sigDate}>Date: {fmtDate(signatures?.rpSignedAt ?? dates?.inspectionDate)}</span></div>
          </div>
          <div className={s.sigCell}>
            <div className={s.sigRole}>Confirmed By — Customer</div>
            <div className={s.sigName}>{meta.tenantName || '—'}</div>
            <div className={s.sigCompany}>{meta.tenantPhone || meta.tenantEmail || '—'}</div>
            {signatures?.tenantSig ? (
              <div className={s.sigPad}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signatures.tenantSig} alt="Customer signature" />
              </div>
            ) : signSlot ? (
              // Interactive signing pad brings its own box — render it directly so it
              // isn't clipped inside the fixed-height signature-image container.
              <div className={s.sigSlot}>{signSlot}</div>
            ) : (
              <div className={s.sigPad}><span className={s.sigPlaceholder}>Not yet signed</span></div>
            )}
            <div className={s.sigFoot}><span>Signature</span><span className={s.sigDate}>Date: {signatures?.tenantSignedAt ? fmtDate(signatures.tenantSignedAt) : '—'}</span></div>
          </div>
        </div>
        <div className={s.ack}>
          <b>Customer acknowledgement.</b>{' '}
          {isMoveIn
            ? `I, ${meta.tenantName || 'the customer'}, confirm I have inspected the unit and that the recorded condition reflects its state at move-in / handover.`
            : `I, ${meta.tenantName || 'the customer'}, confirm I have reviewed this inspection report and acknowledge the condition of the property and items listed above at the time of move-out.`}
        </div>
      </div>
      )}
    </div>
  );
}

/** Per-checklist-item photo attachments: thumbnails (with remove when editable)
 *  + an "Add photo" control on the RP editable surface. */
function ItemPhotos({ item, editable, uploading, onAdd, onRemove }: {
  item: InspectionItem;
  editable: boolean;
  uploading: boolean;
  onAdd?: (files: File[]) => void;
  onRemove?: (photoId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [galleryStart, setGalleryStart] = useState<number | null>(null);
  const photos = item.itemAttachments ?? [];
  if (!photos.length && !editable) return null;
  const label = [item.location, item.componentName].filter(Boolean).join(' — ');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {photos.map((p, k) => (
        <PhotoThumb key={p.id} photo={p} onOpen={() => setGalleryStart(k)} removable={editable && !!onRemove} onRemove={onRemove ? () => onRemove(p.id) : undefined} />
      ))}
      {galleryStart !== null && (
        <PhotoLightbox photos={toGallery(photos, label)} start={galleryStart} onClose={() => setGalleryStart(null)} />
      )}
      {editable && onAdd && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onAdd(fs); if (inputRef.current) inputRef.current.value = ''; }} />
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}
            title="Attach photos to this item"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', fontSize: 11, fontWeight: 600, color: '#5f6b63', background: '#fff', border: '1px dashed #c8c6be', borderRadius: 6, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={13} />}
            <span>{uploading ? 'Uploading…' : (photos.length ? 'Add' : 'Add photo')}</span>
          </button>
        </>
      )}
    </div>
  );
}

/** Report-level photo gallery: pick MANY images at once (or drop a folder on the
 *  box) instead of attaching them row by row. Renders nothing for a reader when
 *  the report carries no photos, so the customer copy stays clean. */
function ReportPhotos({ photos, onAdd, onRemove, uploading, progress }: {
  photos: InspectionPhoto[];
  onAdd?: (files: File[]) => void;
  onRemove?: (photoId: string) => void;
  uploading: boolean;
  progress: { done: number; total: number } | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [galleryStart, setGalleryStart] = useState<number | null>(null);
  if (!photos.length && !onAdd) return null;
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length && onAdd) onAdd(files);
  };
  return (
    <div className={s.notesWrap}>
      <div className={s.panel}>
        <h4><span className={s.ico}><Camera /></span>Photos{photos.length ? ` (${photos.length})` : ''}</h4>
        {!!photos.length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: onAdd ? 10 : 0 }}>
            {photos.map((p, k) => (
              <PhotoThumb key={p.id} photo={p} onOpen={() => setGalleryStart(k)} removable={!!onRemove} onRemove={onRemove ? () => onRemove(p.id) : undefined} />
            ))}
          </div>
        )}
        {galleryStart !== null && (
          <PhotoLightbox photos={toGallery(photos, 'Walk-through photo')} start={galleryStart} onClose={() => setGalleryStart(null)} />
        )}
        {onAdd && (
          <>
            <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={(e) => { take(e.target.files); if (inputRef.current) inputRef.current.value = ''; }} />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); take(e.dataTransfer.files); }}
              onClick={() => { if (!uploading) inputRef.current?.click(); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (!uploading && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click(); }}
              aria-label="Add photos"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 12px', borderRadius: 10, cursor: uploading ? 'default' : 'pointer',
                border: `1px dashed ${dragOver ? '#047246' : '#c8c6be'}`,
                background: dragOver ? '#eef7f2' : '#fbfcfb',
                color: '#5f6b63', fontSize: 12.5, fontWeight: 600, opacity: uploading ? 0.7 : 1,
              }}>
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              <span>
                {uploading
                  ? (progress ? `Uploading ${progress.done} of ${progress.total}…` : 'Uploading…')
                  : 'Add photos — select several at once, or drop them here'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The lightbox list for a group of inspection photos: fresh (re-signed) view
 *  URLs, and the photo's own caption or the group label ("Kitchen — Sink"). */
function toGallery(photos: InspectionPhoto[], fallbackCaption: string): GalleryPhoto[] {
  return photos.map((p) => ({ id: p.id, url: displayInspectionPhotoUrl(p.url), caption: p.caption || fallbackCaption }));
}

/** One inspection-photo thumbnail. Always a button that opens the gallery
 *  preview (full-screen lightbox with previous / next over the whole group).
 *  When the image fails to load — e.g. a private-bucket URL that couldn't be
 *  re-signed — it degrades to a labelled, still-clickable placeholder instead
 *  of a broken-image glyph. */
function PhotoThumb({ photo, onOpen, removable, onRemove }: {
  photo: { id: string; url: string; caption?: string };
  onOpen: () => void;
  removable: boolean;
  onRemove?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = displayInspectionPhotoUrl(photo.url);
  const caption = photo.caption || 'Inspection photo';
  return (
    <span style={{ position: 'relative', width: 76, height: 76, borderRadius: 8, overflow: 'hidden', border: '1px solid #e4e9e5', background: '#eef1ef', flexShrink: 0 }}>
      {/* Click the thumbnail to open the gallery preview on this photo. */}
      <button type="button" onClick={onOpen}
        title="Click to view full photo" aria-label={`View full photo — ${caption}`}
        style={{ display: 'block', width: '100%', height: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', lineHeight: 0 }}>
        {broken ? (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, width: '100%', height: '100%', color: '#9a978f', fontSize: 9, fontWeight: 600, textAlign: 'center', padding: 4 }}>
            <ImageOff size={18} />
            <span style={{ lineHeight: 1.1 }}>View photo</span>
          </span>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={caption} onError={() => setBroken(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* Zoom affordance so it reads as clickable. */}
            <span style={{ position: 'absolute', bottom: 3, right: 3, width: 18, height: 18, borderRadius: 999, background: 'rgba(0,0,0,.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <ZoomIn size={11} />
            </span>
          </>
        )}
      </button>
      {removable && onRemove && (
        <button type="button" aria-label="Remove photo" onClick={onRemove}
          style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', padding: 0 }}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

/** Subtle "add a component to this category" affordance — the restoration-list
 *  entry point on the editable move-out surface. The picker itself lives in the
 *  RP workspace page (which holds the resolved price book). */
function AddComponentButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', fontSize: 11.5, fontWeight: 600, color: '#047246', background: '#eef7f2', border: '1px dashed #cfe8df', borderRadius: 7, cursor: 'pointer' }}>
      <Plus size={13} /> Add sub-category / component
    </button>
  );
}

function DateBox({ icon, k, v }: { icon: ReactNode; k: string; v: string }) {
  return (
    <div className={s.datebox}>
      <span className={`${s.dbi} ${s.ico}`}>{icon}</span>
      <div><div className={s.k}>{k}</div><div className={s.v}>{v}</div></div>
    </div>
  );
}

/** Move-out date box that doubles as an editable native date input on the fillable
 *  surface — the move-out date can shift right up until the inspection is approved. */
function EditableDateBox({ icon, k, value, onChange }: { icon: ReactNode; k: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={s.datebox}>
      <span className={`${s.dbi} ${s.ico}`}>{icon}</span>
      <div>
        <div className={s.k}>{k}</div>
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ font: 'inherit', fontWeight: 700, color: '#14201a', border: 'none', background: 'transparent', padding: 0, width: '100%', cursor: 'pointer' }} />
      </div>
    </div>
  );
}

function DetailCard({ icon, title, rows }: { icon: ReactNode; title: string; rows: [string, ReactNode][] }) {
  return (
    <div className={s.card}>
      <h3><span className={s.ico}>{icon}</span>{title}</h3>
      {rows.map(([k, v]) => (
        <div key={k} className={s.kv}><span className={s.k}>{k}</span><span className={s.sep}>:</span><span className={s.v}>{(typeof v === 'string' ? v : null) || v || '—'}</span></div>
      ))}
    </div>
  );
}
