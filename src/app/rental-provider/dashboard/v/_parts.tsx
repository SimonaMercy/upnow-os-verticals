'use client';

/**
 * Shared pieces for the vertical-scoped preview pages under /rental-provider/dashboard/v/*.
 * Everything here reads from the preview store (@/lib/os/preview) — no API calls. Pages using
 * these parts must render <PreviewBanner/>.
 */
import { useState } from 'react';
import { notFound, useParams } from 'next/navigation';
import { Award, Building2, Compass, GraduationCap, Shield, Stethoscope, Wrench, type LucideIcon } from 'lucide-react';
import {
  Btn, Callout, Card, Drawer, Evid, Field, Flow, KV, Locked, Modal, Pill,
} from '@/components/os/kit';
import { offerOf, verticalOf, type MsOffer, type MsVertical, type MsVerticalId } from '@/lib/catalog';
import { MODEL_INFO, licenceNeeded, usePreview, type BoardItem, type ModelId } from '@/lib/os/preview';
import { RP_BASE } from '@/lib/os/scope';

export const VICON: Record<MsVerticalId, LucideIcon> = {
  spaces: Building2, services: Wrench, experiences: Compass, memberships: Award,
  programs: GraduationCap, health: Stethoscope, insurance: Shield,
};

/** The `[vertical]` route segment, validated against the catalog (404 when unknown). */
export function useVerticalParam(): MsVertical {
  const params = useParams<{ vertical: string }>();
  const v = verticalOf(String(params?.vertical ?? ''));
  if (!v) notFound();
  return v;
}

/** Gate 2: Spaces is always operable for a verified rental provider; other verticals need a grant. */
export function useGate2(v: MsVerticalId): { locked: boolean } {
  const { authOf } = usePreview();
  return { locked: v !== 'spaces' && authOf(v).state !== 'granted' };
}

/** The Gate 2 locked screen for a vertical the business is not authorised to operate. */
export function Gate2Lock({ vertical }: { vertical: MsVertical }) {
  const { authOf, requestVertical } = usePreview();
  const a = authOf(vertical.id);
  const statusHref = `${RP_BASE}/authorisations`;
  const copy =
    a.state === 'pending'
      ? { title: 'Vertical authorisation pending', text: <>Your request to operate {vertical.label} is with the UpNow admin team{a.requested ? ` (requested ${a.requested})` : ''}. {a.note}</> }
      : a.state === 'refused'
        ? { title: 'Vertical authorisation refused', text: <>Your request to operate {vertical.label} was refused. {a.reason}</> }
        : { title: 'Not authorised for this vertical', text: <>Your business is verified, but it has not been authorised to operate {vertical.label}. Each vertical is authorised separately against the licence that covers it.</> };
  return (
    <>
      <Locked
        title={copy.title}
        text={copy.text}
        reqK="Licence needed"
        reqV={licenceNeeded(vertical.id)}
        actions={<>
          {a.state === 'none' && <Btn variant="primary" onClick={() => requestVertical(vertical.id)}>Request {vertical.label} access</Btn>}
          {a.state === 'refused' && <Btn variant="primary" onClick={() => requestVertical(vertical.id)}>Request {vertical.label} access again</Btn>}
          <Btn href={statusHref}>View authorisation status</Btn>
        </>}
      />
      <div style={{ maxWidth: 580, margin: '0 auto' }}>
        <Evid>Overview, Demand, Finance, Business, Insights and Settings stay available — only {vertical.label} Operations and Catalogue are locked until this vertical is authorised.</Evid>
      </div>
    </>
  );
}

/** Declared lifecycle Flow for a subcategory, or the specification-gap warning. */
export function LifecycleFlow({ offer }: { offer: MsOffer | undefined }) {
  if (!offer || offer.flow.length === 0) return <Evid tone="warn">No lifecycle declared — specification gap.</Evid>;
  return <Flow steps={offer.flow} />;
}

export const modelOffer = (m: ModelId) => offerOf(MODEL_INFO[m].vertical, MODEL_INFO[m].offer);

/** "AED 5,600" / "AED 260 / hr" → 5600 (whole AED, for preview KPI sums only). */
export function amtValue(amt: string): number {
  const m = amt.replace(/,/g, '').match(/AED\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function TagPill({ tag }: { tag?: 'hot' | 'warm' }) {
  if (!tag) return null;
  return <Pill tone={tag === 'hot' ? 'danger' : 'amber'}>{tag === 'hot' ? 'Hot' : 'Warm'}</Pill>;
}

/** Drawer for one preview board item: record, declared lifecycle, move actions. */
export function ItemDrawer({ item, onClose }: { item: BoardItem | null; onClose: () => void }) {
  const { moveItem } = usePreview();
  if (!item) return null;
  const info = MODEL_INFO[item.model];
  const idx = info.cols.indexOf(item.col);
  const next = idx >= 0 && idx < info.cols.length - 1 ? info.cols[idx + 1] : null;
  const prev = idx > 0 ? info.cols[idx - 1] : null;
  return (
    <Drawer
      open
      onClose={onClose}
      title={item.t}
      sub={<>{info.name} · {item.id}</>}
      footer={<>
        {next && <Btn variant="primary" onClick={() => moveItem(item.id, next)}>Move to {next}</Btn>}
        {prev && <Btn onClick={() => moveItem(item.id, prev)}>Move back</Btn>}
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </>}
    >
      <KV items={[
        { k: 'Stage', v: <Pill tone="info">{item.col}</Pill> },
        { k: 'Value', v: item.amt },
        { k: 'Contact', v: item.contact },
        { k: 'Detail', v: item.m },
      ]} />
      {item.note && <div style={{ marginTop: 12 }}><Evid>{item.note}</Evid></div>}
      <h4 style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', margin: '16px 0 8px' }}>Declared lifecycle</h4>
      <LifecycleFlow offer={modelOffer(item.model)} />
    </Drawer>
  );
}

/** "New" record form for a model board (preview store addItem). */
export function NewItemModal({ model, open, onClose }: { model: ModelId; open: boolean; onClose: () => void }) {
  const { addItem } = usePreview();
  const info = MODEL_INFO[model];
  const [t, setT] = useState('');
  const [col, setCol] = useState(info.cols[0]);
  const [m, setM] = useState('');
  const [amt, setAmt] = useState('');
  const [contact, setContact] = useState('');
  const [err, setErr] = useState('');
  const close = () => { setT(''); setCol(info.cols[0]); setM(''); setAmt(''); setContact(''); setErr(''); onClose(); };
  const save = () => {
    if (!t.trim()) { setErr('Give the record a title.'); return; }
    addItem({ model, col, t: t.trim(), m: m.trim(), amt: amt.trim() || '—', contact: contact.trim() || '—', note: '' });
    close();
  };
  return (
    <Modal open={open} onClose={close} title={`New — ${info.name}`}
      footer={<><Btn onClick={close}>Cancel</Btn><Btn variant="primary" onClick={save}>Add to board</Btn></>}>
      <Field label="Title" htmlFor="ni-t" error={err || undefined}>
        <input id="ni-t" className="gx-inp" value={t} onChange={(e) => setT(e.target.value)} placeholder="e.g. Rooftop terrace" />
      </Field>
      <Field label="Stage" htmlFor="ni-c">
        <select id="ni-c" className="gx-sel" value={col} onChange={(e) => setCol(e.target.value)}>
          {info.cols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Detail" htmlFor="ni-m">
        <input id="ni-m" className="gx-inp" value={m} onChange={(e) => setM(e.target.value)} placeholder="Dates, guests, notes" />
      </Field>
      <div className="gx-two">
        <Field label="Value" htmlFor="ni-a">
          <input id="ni-a" className="gx-inp" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="AED 1,200" />
        </Field>
        <Field label="Contact" htmlFor="ni-p">
          <input id="ni-p" className="gx-inp" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Customer name" />
        </Field>
      </div>
    </Modal>
  );
}

/** Declared lifecycle card (basis, primary action, permit, lead-form fields) for a subcategory. */
export function DeclaredLifecycleCard({ offer }: { offer: MsOffer | undefined }) {
  if (!offer) return <Callout tone="warn" title="Subcategory not declared.">This board has no catalog declaration.</Callout>;
  return (
    <Card title="Declared lifecycle" sub={`${offer.label} — from the catalog declaration`} pad>
      <LifecycleFlow offer={offer} />
      <div style={{ marginTop: 12 }}>
        <KV items={[
          { k: 'Price basis', v: offer.basis ?? '—' },
          { k: 'Primary action', v: offer.action ?? '—' },
          { k: 'Permit', v: offer.permit ?? 'None declared' },
          { k: 'Lead form', v: offer.leadForm.length
            ? <span className="gx-chips">{offer.leadForm.map((f) => <Pill key={f.key} dot={false}>{f.label}</Pill>)}</span>
            : 'None declared' },
        ]} />
      </div>
    </Card>
  );
}
