'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, Check, ImagePlus, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../store';
import { MODEL_INFO, SUB, VERTICALS, subsOf } from '../registry';
import { BASE } from '../nav';
import { TODAY } from '../seed';
import { Badge, Button, Card, Field, PageHeader, ProtoNote, SelectInput, Stepper, StatusBadge, TextArea, TextInput, VerticalTag, fmtAed } from '../ui';
import { draftableSubs, listingTarget } from '../rules';
import type { ListingStatus } from '../types';

const STEPS = ['Subcategory', 'Details', 'Photos', 'Price & availability', 'Review'];

/** Create a listing, or edit one (`editId`) — editing starts at Details with the subcategory fixed. */
export function ListingWizard({ editId }: { editId?: string } = {}) {
  const { org, authStatus, add, patch, nextId, context, listings } = useProto();
  const router = useRouter();
  const editing = editId ? listings.find((l) => l.id === editId && l.orgId === context) ?? null : null;
  const [step, setStep] = useState(editing ? 1 : 0);
  const [subKey, setSubKey] = useState<string | null>(editing?.subKey ?? null);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [asset, setAsset] = useState(editing?.asset ?? '');
  const [desc, setDesc] = useState('');
  const [attrs, setAttrs] = useState<Record<string, string>>(editing?.attributes ?? {});
  const [photos, setPhotos] = useState(editing?.photos ?? 0);
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [avail, setAvail] = useState('Immediately');
  const [days, setDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

  if (!org) return <ProtoNote>Switch to a business context to create listings.</ProtoNote>;
  if (editId && !editing) return <ProtoNote>That listing does not belong to this business.</ProtoNote>;
  const s = subKey ? SUB[subKey] : null;
  const drafts = draftableSubs(org);
  const target = s ? listingTarget(org, s.key) : 'in_review';
  const minStep = editing ? 1 : 0;

  const canNext = [
    !!s,
    !!s && title.trim().length > 3 && (s.vertical === 'insurance' || asset.trim().length > 1) && s.fields.every((f) => (attrs[f.id] ?? '').trim()),
    !!s && photos >= s.minPhotos,
    Number(price) > 0,
    true,
  ][step];

  function finish(asDraft: boolean) {
    if (!s) return;
    const status: ListingStatus = asDraft ? 'draft' : target;
    const fields = {
      subKey: s.key, title, asset: asset || 'Insurer panel', price: Number(price), status, updated: TODAY, photos,
      attributes: attrs, reviewNote: status === 'awaiting_licence' ? `Waiting for ${s.licenceGate}.` : undefined,
    };
    const msg = asDraft ? 'Listing saved as draft'
      : status === 'in_review' ? (editing?.status === 'published' ? 'Changes sent for review — the listing is hidden until approved' : 'Listing submitted for review')
      : status === 'awaiting_licence' ? 'Listing waiting for licence'
      : 'Listing waiting for verification — it moves to review once UpNow approves your business and vertical';
    if (editing) patch('listings', editing.id, fields, msg);
    else add('listings', { id: nextId('L'), orgId: context, ...fields }, msg);
    router.push(`${BASE}/listings`);
  }

  const scheduled = s && ['appointment', 'field_job', 'clinical', 'session', 'slot'].includes(s.model);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={<Link href={`${BASE}/listings`} className="hover:underline">← Listings</Link>} title={editing ? `Edit listing · ${editing.id}` : 'Create listing'}
        subtitle="Fields, photo minimums, pricing basis and licence gates come from the vertical registry, so one wizard serves all 35 subcategories." />
      <div className="mb-5"><Stepper steps={STEPS} current={step} /></div>
      {editing?.status === 'published' && <div className="mb-4"><ProtoNote kind="info">This listing is live. Submitting your changes sends it back to review; it is hidden from the marketplace until UpNow approves the new version.</ProtoNote></div>}
      {org.status !== 'verified' && <div className="mb-4"><ProtoNote kind="info">Your business is not verified yet. You can prepare and submit listings now; they wait as “Waiting for verification” and move to review automatically once UpNow approves you.</ProtoNote></div>}

      {step === 0 && (
        <div className="flex flex-col gap-5">
          {VERTICALS.map((v) => {
            const status = authStatus(org, v.id);
            const ok = drafts.some((d) => SUB[d.key].vertical === v.id);
            const pending = ok && status !== 'approved';
            return (
              <Card key={v.id} className={cn(!ok && 'bg-[var(--bg)]')}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <VerticalTag v={v.id} size="md" />
                  {ok && !pending ? <Badge tone="green">Authorised</Badge> : <StatusBadge status={status} />}
                  {pending && <span className="text-[12.5px] text-[var(--ink3)]">Listings wait until UpNow approves this vertical</span>}
                  {!ok && <Link href={`${BASE}/settings/verticals`} className="ml-auto text-[13px] font-semibold text-[var(--g7)] hover:underline">{status === 'not_requested' ? 'Request access' : 'View request'}</Link>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {subsOf(v.id).map((x) => {
                    const allowed = drafts.some((d) => d.key === x.key);
                    const active = subKey === x.key;
                    return (
                      <button
                        key={x.key}
                        type="button"
                        disabled={!allowed}
                        onClick={() => { setSubKey(x.key); setAttrs({}); }}
                        className={cn(
                          'flex items-start gap-2 rounded-xl border p-3 text-left transition-colors',
                          active ? 'border-[var(--g7)] bg-[var(--g1)] ring-2 ring-[var(--g2)]' : 'border-[var(--line)] bg-white hover:border-[var(--g5)]',
                          !allowed && 'cursor-not-allowed opacity-55 hover:border-[var(--line)]',
                        )}
                      >
                        {allowed ? (active ? <Check className="mt-0.5 h-4 w-4 text-[var(--g7)]" aria-hidden /> : <span className="mt-0.5 h-4 w-4 rounded-full border border-[var(--line2)]" />) : <Lock className="mt-0.5 h-4 w-4 text-[#8a958e]" aria-hidden />}
                        <span>
                          <span className="block text-sm font-semibold text-[var(--ink)]">{x.label}</span>
                          <span className="block text-xs text-[var(--ink3)]">{MODEL_INFO[x.model].label} · {x.priceBasis}</span>
                          {!allowed && ok && <span className="block text-[11px] text-[var(--ink3)]">Subcategory not in your authorisation</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {step === 1 && s && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2"><VerticalTag v={s.vertical} size="md" /><span className="text-sm font-semibold">{s.label}</span><span className="text-sm text-[var(--ink3)]">· {MODEL_INFO[s.model].label}</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Listing title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. ${s.label} in Dubai Marina`} /></Field>
            {s.vertical !== 'insurance' && (
              <Field label={s.vertical === 'spaces' ? 'Asset (property, unit, court or vessel)' : 'Offering / resource'} hint="Assets and listings are separate: one asset can have several listings over time.">
                <TextInput value={asset} onChange={(e) => setAsset(e.target.value)} placeholder={s.vertical === 'spaces' ? 'e.g. Marina Gate 1 · Unit 1804' : 'e.g. Marina Barbers'} />
              </Field>
            )}
            {s.fields.map((f) => (
              <Field key={f.id} label={f.label}>
                {f.type === 'select'
                  ? <SelectInput value={attrs[f.id] ?? ''} onChange={(e) => setAttrs({ ...attrs, [f.id]: e.target.value })} options={[{ value: '', label: 'Select…' }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} />
                  : <TextInput type={f.type} value={attrs[f.id] ?? ''} onChange={(e) => setAttrs({ ...attrs, [f.id]: e.target.value })} />}
              </Field>
            ))}
          </div>
          <Field label="Description"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What a customer needs to know" /></Field>
          <p className="text-xs text-[var(--ink3)]">All {s.label.toLowerCase()} attributes are required — they become the marketplace filters.</p>
          {s.model === 'clinical' && <ProtoNote kind="info">Health listings describe the service and practitioner only. Never include patient information.</ProtoNote>}
        </Card>
      )}

      {step === 2 && s && (
        <Card>
          <p className="mb-3 text-sm text-[var(--ink3)]">{s.minPhotos === 0 ? 'Protection listings show the insurer logos instead of photos.' : `${s.label} needs at least ${s.minPhotos} photos (maximum 12). Click to add placeholder photos.`}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: photos }).map((_, i) => (
              <div key={i} className="relative grid aspect-square place-items-center rounded-xl bg-gradient-to-br from-[var(--g1)] to-[var(--g2)] text-xs font-semibold text-[var(--g7)]">
                Photo {i + 1}
                <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos - 1)} className="absolute right-1 top-1 rounded-full bg-white/80 p-0.5"><X className="h-3 w-3" /></button>
              </div>
            ))}
            {photos < 12 && s.minPhotos > 0 && (
              <button type="button" onClick={() => setPhotos(photos + 1)} className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-[var(--line2)] text-[#8a958e] hover:border-[var(--g6)] hover:text-[var(--g7)]">
                <ImagePlus className="h-6 w-6" aria-label="Add photo" />
              </button>
            )}
          </div>
          <div className="mt-3 text-sm font-semibold">{photos} / {s.minPhotos} minimum {photos >= s.minPhotos && <Check className="inline h-4 w-4 text-[var(--g6)]" aria-hidden />}</div>
        </Card>
      )}

      {step === 3 && s && (
        <Card className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Price (AED ${s.priceUnit})`} hint={s.priceBasis}><TextInput type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            {s.model === 'lease' && <Field label="Available from"><SelectInput value={avail} onChange={(e) => setAvail(e.target.value)} options={['Immediately', '1 Nov 2026', '1 Dec 2026', '1 Jan 2027']} /></Field>}
            {s.model === 'stay' && <Field label="Calendar" hint="Nightly availability is managed in Spaces › Holiday stays"><SelectInput value={avail} onChange={(e) => setAvail(e.target.value)} options={['Open all dates', 'Weekends only', 'Manual approval for every stay']} /></Field>}
            {s.model === 'insurance_quote' && <Field label="Quote handling"><SelectInput value={avail} onChange={(e) => setAvail(e.target.value)} options={['Route to all panel insurers', 'Route to preferred insurer first']} /></Field>}
          </div>
          {scheduled && (
            <div>
              <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--ink2)]">Operating days</div>
              <div className="flex flex-wrap gap-1.5">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
                    className={cn('h-9 w-12 rounded-lg text-sm font-semibold ring-1 ring-inset', days.includes(d) ? 'bg-[var(--g7)] text-white ring-[var(--g7)]' : 'bg-white text-[var(--ink2)] ring-[var(--line2)]')}>{d}</button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[var(--ink3)]">Slots, capacity and staff are configured in the {SUB[s.key].vertical === 'spaces' ? 'Spaces' : 'vertical'} pack; the listing only declares when it is offered.</p>
            </div>
          )}
          {s.licenceGate && (
            <div className="rounded-xl border border-[var(--line)] p-3 text-sm">
              <div className="font-semibold">Licence gate: {s.licenceGate}</div>
              {target !== 'awaiting_licence'
                ? <div className="mt-1 text-[var(--g7)]">On file — the listing goes straight to review.</div>
                : <div className="mt-1 flex items-center gap-1.5 text-[#8a5a14]"><AlertTriangle className="h-4 w-4" aria-hidden />Not on file — the listing will wait as “Awaiting licence” until it is uploaded in Settings › Verticals.</div>}
            </div>
          )}
        </Card>
      )}

      {step === 4 && s && (
        <Card className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><VerticalTag v={s.vertical} size="md" /><span className="font-semibold">{s.label}</span></div>
          <div className="text-lg font-bold">{title}</div>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5">
            <dt className="text-[var(--ink3)]">Asset / offering</dt><dd>{asset || '—'}</dd>
            <dt className="text-[var(--ink3)]">Price</dt><dd>{fmtAed(Number(price))} {s.priceUnit}</dd>
            <dt className="text-[var(--ink3)]">Photos</dt><dd>{photos}</dd>
            {s.fields.map((f) => <div key={f.id} className="contents"><dt className="text-[var(--ink3)]">{f.label}</dt><dd>{attrs[f.id] || '—'}</dd></div>)}
            <dt className="text-[var(--ink3)]">On submit</dt><dd><StatusBadge status={target} /></dd>
          </dl>
          <ProtoNote>Submitting adds the listing to the prototype store and to Admin → Listing review. Nothing is published to the marketplace.</ProtoNote>
        </Card>
      )}

      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={() => setStep(Math.max(minStep, step - 1))} disabled={step === minStep}>Back</Button>
        <div className="flex gap-2">
          {step === 4 && <Button variant="secondary" onClick={() => finish(true)}>Save as draft</Button>}
          {step < 4 ? <Button onClick={() => setStep(step + 1)} disabled={!canNext}>Continue</Button> : <Button onClick={() => finish(false)}>{editing ? 'Save and submit' : 'Submit for review'}</Button>}
        </div>
      </div>
    </div>
  );
}
