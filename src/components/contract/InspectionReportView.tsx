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

import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Home, Calendar, ClipboardCheck, User, Users, Layers, Wrench, Banknote, AlertTriangle,
  Plus, FileText, DoorClosed, Shirt, AppWindow, Grid3x3, Zap, Utensils,
  Bath, Trees, Wind, KeyRound, Sparkles, Paintbrush, Package, Camera, X, Loader2,
} from 'lucide-react';
import {
  InspectionDoc, InspectionItem, Condition,
  computeInspectionTotals, quantityOf, canonicalKey,
} from '@/lib/inspectionCatalog';
import { displayInspectionPhotoUrl } from '@/lib/inspectionPhotos';
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
          <span className={`${s.homeIcon} ${s.ico}`}><Home strokeWidth={2} /></span>
          <div>
            <h1>{isMoveIn ? 'MOVE-IN' : 'MOVE-OUT'} INSPECTION REPORT</h1>
            <p>Detailed inspection of property components and fixtures</p>
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
          ['Property Name', meta.property], ['Unit No.', meta.unitNo], ['Property Type', meta.propertyType], ['Floor', meta.floor],
        ]} />
        <DetailCard icon={<User />} title="Tenant Details" rows={[
          ['Tenant Name', meta.tenantName], ['Phone', meta.tenantPhone], ['Email', meta.tenantEmail],
        ]} />
        <DetailCard icon={<Users />} title="Inspection Team" rows={[
          ['Inspected By', editable && onInspectorName
            ? <input value={meta.inspectorName} placeholder="Inspector name"
                onChange={(e) => onInspectorName(e.target.value)} aria-label="Inspected by"
                style={{ font: 'inherit', fontWeight: 600, color: '#1a1916', border: '1px solid #e8e6e0', borderRadius: 6, padding: '2px 6px', width: '100%', minWidth: 0, background: '#fff' }} />
            : (meta.inspectorName || '—')],
          ['Role', meta.inspectorRole || 'Property Representative'],
        ]} />
      </div>

      {/* Tiles */}
      <div className={`${s.tiles} ${showMoney ? '' : s.three}`}>
        <div className={`${s.tile} ${s.cat}`}><span className={`${s.tIc} ${s.ico}`}><Layers /></span><div className={s.body}><span className={s.l}>Total Categories</span><span className={s.num}>{totals.categories}</span></div></div>
        <div className={`${s.tile} ${s.items}`}><span className={`${s.tIc} ${s.ico}`}><ClipboardCheck /></span><div className={s.body}><span className={s.l}>Total Items</span><span className={s.num}>{totals.items}</span></div></div>
        <div className={`${s.tile} ${s.replace}`}><span className={`${s.tIc} ${s.ico}`}><Wrench /></span><div className={s.body}><span className={s.l}><span className={s.warn}><AlertTriangle /></span>{isMoveIn ? 'Items Flagged' : 'Items to be Replaced'}</span><span className={s.num}>{isMoveIn ? totals.defective : totals.itemsToReplace}</span></div></div>
        {showMoney && <div className={`${s.tile} ${s.cost}`}><span className={`${s.tIc} ${s.ico}`}><Banknote /></span><div className={s.body}><span className={s.l}><span className={s.warn}><AlertTriangle /></span>Estimated Total Cost (AED)</span><span className={`${s.num} ${s.tabnum}`}>{AED(totals.estCostAed)}</span></div></div>}
      </div>

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
                  <div style={{ padding: '22px 8px', textAlign: 'center', color: '#9b9890', fontSize: 13 }}>
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
                        <div><div className={s.catname}>{cat.label || 'Untitled category'}</div><div className={s.catmeta}>{cat.unitLabel}</div></div>
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
                            <div><div className={s.catname}>{cat.label}</div><div className={s.catmeta}>{cat.unitLabel} · {cat.count}</div></div>
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

      {/* Signatures — bordered two-party block. Hidden when the caller supplies its
          own sign box (e.g. the magic-link portal). */}
      {!hideSignatures && (
      <div className={s.sigSection}>
        <div className={s.sigBar}>Signatures</div>
        <div className={s.sigBox}>
          <div className={`${s.sigCell} ${s.sigCellDivider}`}>
            <div className={s.sigRole}>Inspected By — Property Representative</div>
            <div className={s.sigName}>{meta.inspectorName || '—'}</div>
            <div className={s.sigCompany}>{meta.inspectorCompany || meta.inspectorRole || 'Property Representative'}</div>
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
  const photos = item.itemAttachments ?? [];
  if (!photos.length && !editable) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {photos.map((p) => (
        <span key={p.id} style={{ position: 'relative', width: 40, height: 40, borderRadius: 6, overflow: 'hidden', border: '1px solid #e8e6e0', background: '#f4f3ef', flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={displayInspectionPhotoUrl(p.url)} alt={p.caption || 'attachment'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {editable && onRemove && (
            <button type="button" aria-label="Remove photo" onClick={() => onRemove(p.id)}
              style={{ position: 'absolute', top: 1, right: 1, width: 16, height: 16, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', padding: 0 }}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {editable && onAdd && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onAdd(fs); if (inputRef.current) inputRef.current.value = ''; }} />
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}
            title="Attach photos to this item"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', fontSize: 11, fontWeight: 600, color: '#6b6860', background: '#fff', border: '1px dashed #c8c6be', borderRadius: 6, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={13} />}
            <span>{uploading ? 'Uploading…' : (photos.length ? 'Add' : 'Add photo')}</span>
          </button>
        </>
      )}
    </div>
  );
}

/** Subtle "add a component to this category" affordance — the restoration-list
 *  entry point on the editable move-out surface. The picker itself lives in the
 *  RP workspace page (which holds the resolved price book). */
function AddComponentButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', fontSize: 11.5, fontWeight: 600, color: '#2e9f82', background: '#f0faf6', border: '1px dashed #cfe8df', borderRadius: 7, cursor: 'pointer' }}>
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
          style={{ font: 'inherit', fontWeight: 700, color: '#1a1916', border: 'none', background: 'transparent', padding: 0, width: '100%', cursor: 'pointer' }} />
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
