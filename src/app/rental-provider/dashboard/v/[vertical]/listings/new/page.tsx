'use client';

/**
 * Catalogue › Create listing — the Genspark 10-step listing wizard, PREVIEW only (nothing is sent to
 * the API; non-Spaces verticals have no listings backend). New page — no previous page to keep parity with.
 * Step 4 renders exactly the subcategory's declared fields (offer.filters); step 6 uses the declared
 * price basis; step 8 validates; step 9 submits locally; step 10 explains the Gate 3 outcomes.
 * Accepts ?sub=<offerId>. Real Spaces listings are created from /rental-provider/dashboard/units/add.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Btn, Callout, Card, Checklist, Evid, Field, KV, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, Seg, fmtAed,
} from '@/components/os/kit';
import type { MsFilterDef, MsOffer } from '@/lib/catalog';
import { RP_BASE } from '@/lib/os/scope';
import { Gate2Lock, LifecycleFlow, useGate2, useVerticalParam } from '../../../_parts';

const STEPS: { t: string; d: string }[] = [
  { t: 'Vertical & subcategory', d: 'What you are listing' },
  { t: 'Link the asset', d: 'Where it is delivered' },
  { t: 'Listing details', d: 'Title and description' },
  { t: 'Subcategory fields', d: 'Declared attributes' },
  { t: 'Images & documents', d: 'Photos and permit' },
  { t: 'Price & availability', d: 'Declared price basis' },
  { t: 'Terms & policies', d: 'Cancellation and rules' },
  { t: 'Preview & validate', d: 'Checklist before review' },
  { t: 'Submit for review', d: 'Gate 3' },
  { t: 'Review status', d: 'Outcome' },
];

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ae|net|org|io|co)\b|@[a-z0-9-]+\.)/i;
const MIN_PHOTOS = 3;

type FieldVal = string | string[];
const filled = (v: FieldVal | undefined) => (Array.isArray(v) ? v.length > 0 : !!v && v.trim() !== '');

export default function NewListingPage() {
  const vertical = useVerticalParam();
  const { locked } = useGate2(vertical.id);
  const sp = useSearchParams();
  const initialSub = vertical.offers.find((o) => o.id === sp?.get('sub'))?.id ?? vertical.offers[0]?.id ?? '';

  const [subId, setSubId] = useState(initialSub);
  const offer: MsOffer | undefined = vertical.offers.find((o) => o.id === subId) ?? vertical.offers[0];
  const [step, setStep] = useState(0);
  const [assetName, setAssetName] = useState('');
  const [assetArea, setAssetArea] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [fields, setFields] = useState<Record<string, FieldVal>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [permitNo, setPermitNo] = useState('');
  const [price, setPrice] = useState('');
  const [availFrom, setAvailFrom] = useState('');
  const [cancel, setCancel] = useState<'flexible' | 'moderate' | 'strict'>('moderate');
  const [rules, setRules] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photos[0]) return;
    const u = URL.createObjectURL(photos[0]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL must be created and revoked with the file
    setPhotoUrl(u);
    return () => { URL.revokeObjectURL(u); setPhotoUrl(null); };
  }, [photos]);

  const pickSub = (id: string) => { if (id !== subId) { setSubId(id); setFields({}); setPermitNo(''); } };
  const setField = (id: string, v: FieldVal) => setFields((f) => ({ ...f, [id]: v }));

  const checks = useMemo(() => {
    if (!offer) return [];
    const missing = offer.filters.filter((f) => !filled(fields[f.id]));
    const contact = PHONE_RE.test(desc) || LINK_RE.test(desc);
    const priceOk = Number(price) > 0;
    const list: { l: string; sub?: string; state: 'pass' | 'fail' }[] = [
      { l: `At least ${MIN_PHOTOS} photos`, sub: `${photos.length} added`, state: photos.length >= MIN_PHOTOS ? 'pass' : 'fail' },
      { l: 'Title and details', sub: 'Title of 8+ characters, description of 40+ characters', state: title.trim().length >= 8 && desc.trim().length >= 40 ? 'pass' : 'fail' },
      { l: 'Price set', sub: offer.basis ?? undefined, state: priceOk ? 'pass' : 'fail' },
      { l: 'No phone numbers or links in the description', sub: contact ? 'Remove contact details — customers reach you through UpNow' : undefined, state: contact ? 'fail' : 'pass' },
    ];
    if (offer.permit) list.push({ l: `${offer.permit} provided`, sub: 'Permit number and permit document', state: permitNo.trim() && docs.length > 0 ? 'pass' : 'fail' });
    list.push({ l: 'All subcategory fields filled', sub: missing.length ? `Missing: ${missing.map((f) => f.label).join(', ')}` : `${offer.filters.length} of ${offer.filters.length}`, state: missing.length ? 'fail' : 'pass' });
    return list;
  }, [offer, fields, desc, price, photos.length, title, permitNo, docs.length]);
  const allPass = checks.length > 0 && checks.every((c) => c.state === 'pass');

  if (locked) {
    return (
      <OsPage>
        <PageHead eyebrow="Catalogue" title="Create listing" />
        <Gate2Lock vertical={vertical} />
      </OsPage>
    );
  }
  if (!offer) {
    return (
      <OsPage>
        <PageHead eyebrow="Catalogue" title="Create listing" />
        <Callout tone="warn" title="No subcategories declared.">{vertical.label} has no catalog declarations to build a listing from.</Callout>
      </OsPage>
    );
  }

  const go = (i: number) => { if (!submitted || i === 9) setStep(i); };
  const last = submitted ? 9 : 8;

  return (
    <OsPage>
      <PageHead
        eyebrow="Catalogue"
        title="Create listing"
        lede={`A ${vertical.label.toLowerCase()} listing built from the ${offer.label} declaration. Each step asks only for what this subcategory declares.`}
        actions={<Btn href={`${RP_BASE}/v/${vertical.id}/listings`}>Back to listings</Btn>}
      />
      <PreviewBanner>This wizard has no backend yet — nothing is uploaded or submitted to UpNow. Files stay in this browser tab.</PreviewBanner>

      <section className="gx-card">
        <div className="gx-wz">
          <nav className="gx-wz-steps" aria-label="Listing steps">
            {STEPS.map((s, i) => (
              <button key={s.t} type="button" className={`gx-wz-s${i < step || (submitted && i < 9) ? ' done' : ''}`}
                aria-current={i === step ? 'step' : undefined} onClick={() => go(i)} disabled={submitted && i !== 9}>
                <span className="n">{i < step || (submitted && i < 9) ? '✓' : i + 1}</span>
                <span><span className="t">{s.t}</span><span className="d">{s.d}</span></span>
              </button>
            ))}
          </nav>

          <div className="gx-wz-main">
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{step + 1}. {STEPS[step].t}</h2>
            <p style={{ fontSize: 12, color: 'var(--ms-ink-3)', marginBottom: 14 }}>{STEPS[step].d}</p>

            {step === 0 && (
              <>
                {vertical.id === 'spaces' && (
                  <div style={{ marginBottom: 14 }}>
                    <Callout tone="info" title="Real Spaces listings are created from units.">
                      Use <Link href={`${RP_BASE}/units/add`}>Catalogue › Add units</Link> to publish a real Spaces listing. This wizard previews the declared fields only.
                    </Callout>
                  </div>
                )}
                <KV items={[{ k: 'Vertical', v: vertical.label }, { k: 'Price basis', v: offer.basis ?? '—' }]} />
                <div className="gx-lb" style={{ margin: '14px 0 6px' }}>Subcategory</div>
                <div className="gx-chips" role="group" aria-label="Subcategory">
                  {vertical.offers.map((o) => (
                    <button key={o.id} type="button" className="gx-chip" aria-pressed={o.id === offer.id} onClick={() => pickSub(o.id)}>{o.label}</button>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}><Evid>{offer.sub ?? offer.h1}</Evid></div>
              </>
            )}

            {step === 1 && (
              <>
                <Field label="Asset or venue name" htmlFor="wz-asset" hint="The place, vehicle, facility or practice this listing is delivered from.">
                  <input id="wz-asset" className="gx-inp" value={assetName} onChange={(e) => setAssetName(e.target.value)} />
                </Field>
                <Field label="Area / location" htmlFor="wz-area">
                  <input id="wz-area" className="gx-inp" value={assetArea} onChange={(e) => setAssetArea(e.target.value)} placeholder="e.g. Dubai Marina" />
                </Field>
              </>
            )}

            {step === 2 && (
              <>
                <Field label="Listing title" htmlFor="wz-title" hint="8 characters or more.">
                  <input id="wz-title" className="gx-inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={offer.h1} />
                </Field>
                <Field label="Description" htmlFor="wz-desc" hint="40 characters or more. No phone numbers, emails or links — customers contact you through UpNow."
                  error={PHONE_RE.test(desc) || LINK_RE.test(desc) ? 'Remove phone numbers, emails and links from the description.' : undefined}>
                  <textarea id="wz-desc" className="gx-ta" value={desc} onChange={(e) => setDesc(e.target.value)} rows={6} />
                </Field>
              </>
            )}

            {step === 3 && (
              offer.filters.length === 0
                ? <Evid tone="warn">This subcategory declares no fields — specification gap.</Evid>
                : offer.filters.map((f) => <DeclaredField key={f.id} f={f} value={fields[f.id]} onChange={(v) => setField(f.id, v)} />)
            )}

            {step === 4 && (
              <>
                <Field label={`Photos (at least ${MIN_PHOTOS})`} htmlFor="wz-photos" hint={photos.length ? photos.map((p) => p.name).join(', ') : 'JPG or PNG.'}>
                  <input id="wz-photos" type="file" accept="image/*" multiple className="gx-inp" style={{ paddingTop: 6 }}
                    onChange={(e) => setPhotos(Array.from(e.target.files ?? []))} />
                </Field>
                {offer.permit && (
                  <Field label={`${offer.permit} number`} htmlFor="wz-permit">
                    <input id="wz-permit" className="gx-inp" value={permitNo} onChange={(e) => setPermitNo(e.target.value)} />
                  </Field>
                )}
                <Field label={offer.permit ? `${offer.permit} document` : 'Supporting documents (optional)'} htmlFor="wz-docs"
                  hint={docs.length ? docs.map((d) => d.name).join(', ') : 'PDF or image.'}>
                  <input id="wz-docs" type="file" accept="application/pdf,image/*" multiple className="gx-inp" style={{ paddingTop: 6 }}
                    onChange={(e) => setDocs(Array.from(e.target.files ?? []))} />
                </Field>
              </>
            )}

            {step === 5 && (
              <>
                <Field label="Price basis" hint="Fixed by the subcategory declaration.">
                  <div><Pill tone="outline" dot={false}>{offer.basis ?? 'Not declared'}</Pill></div>
                </Field>
                <Field label="Price (AED)" htmlFor="wz-price">
                  <input id="wz-price" type="number" min={0} step={1} inputMode="numeric" className="gx-inp" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <Field label="Available from" htmlFor="wz-avail">
                  <input id="wz-avail" type="date" className="gx-inp" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} />
                </Field>
              </>
            )}

            {step === 6 && (
              <>
                <Field label="Cancellation policy">
                  <Seg label="Cancellation policy" value={cancel} onChange={setCancel}
                    options={[{ v: 'flexible', l: 'Flexible' }, { v: 'moderate', l: 'Moderate' }, { v: 'strict', l: 'Strict' }]} />
                </Field>
                <Field label="Rules and terms" htmlFor="wz-rules" hint="What customers agree to when they book or enquire.">
                  <textarea id="wz-rules" className="gx-ta" value={rules} onChange={(e) => setRules(e.target.value)} rows={5} />
                </Field>
                <div className="gx-lb" style={{ marginBottom: 6 }}>Declared lifecycle customers will follow</div>
                <LifecycleFlow offer={offer} />
              </>
            )}

            {step === 7 && (
              <>
                <Checklist items={checks} />
                <div style={{ marginTop: 12 }}>
                  {allPass
                    ? <Evid tone="ok">Ready to submit for review.</Evid>
                    : <Evid tone="warn">Fix the failed checks before submitting. Open the step that holds each item.</Evid>}
                </div>
              </>
            )}

            {step === 8 && (
              <>
                <Callout tone="info" title="Gate 3 · Listing approval.">
                  Submitting sends this listing to UpNow for review. Approval is per listing — your business verification and {vertical.label} authorisation do not approve listings automatically.
                </Callout>
                <div style={{ marginTop: 12 }}><Checklist items={checks} /></div>
                <div className="gx-btn-row" style={{ marginTop: 14 }}>
                  <Btn variant="primary" disabled={!allPass} onClick={() => { setSubmitted(true); setStep(9); }}>Submit for review</Btn>
                  {!allPass && <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Every check must pass first.</span>}
                </div>
              </>
            )}

            {step === 9 && (
              submitted ? (
                <>
                  <Evid tone="ok">Submitted for review (preview — nothing was sent). A real submission would now be in the listing approval queue.</Evid>
                  <div className="gx-lb" style={{ margin: '14px 0 6px' }}>What happens next — one of three outcomes</div>
                  <Checklist items={[
                    { l: 'Approved & published', sub: 'The listing goes live for customers in this subcategory.', state: 'pass' },
                    { l: 'Changes requested', sub: 'The reviewer explains what to fix; you edit and resubmit.', state: 'wait' },
                    { l: 'Rejected', sub: 'The listing cannot be published as declared; the reason is recorded.', state: 'fail' },
                  ]} />
                  <div style={{ marginTop: 12 }}><Evid>Gate 3 is per listing: every new listing is reviewed on its own, even inside an authorised vertical.</Evid></div>
                </>
              ) : <Evid tone="warn">Not submitted yet. Complete the checklist and submit at step 9.</Evid>
            )}

            {step < last && (
              <div className="gx-btn-row" style={{ marginTop: 18, borderTop: '1px solid var(--ms-surface-3)', paddingTop: 14 }}>
                {step > 0 && <Btn onClick={() => setStep(step - 1)}>Back</Btn>}
                <Btn variant="primary" onClick={() => setStep(step + 1)}>Continue</Btn>
              </div>
            )}
            {step === 8 && !submitted && (
              <div className="gx-btn-row" style={{ marginTop: 10 }}><Btn onClick={() => setStep(7)}>Back</Btn></div>
            )}
          </div>

          <aside className="gx-wz-prev" aria-label="Live preview">
            <div className="gx-lb" style={{ marginBottom: 8 }}>Live preview <PreviewPill /></div>
            <div className="gx-card" style={{ overflow: 'hidden' }}>
              <div style={{ height: 120, background: 'var(--ms-surface-3)', display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--ms-ink-3)' }}>
                {photoUrl ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'No photo yet'}
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3 }}>{title.trim() || 'Untitled listing'}</div>
                <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 3 }}>{offer.label}{assetArea.trim() ? ` · ${assetArea.trim()}` : ''}</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 8 }}>{Number(price) > 0 ? fmtAed(price) : 'Price not set'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>{offer.basis ?? ''}</div>
                {offer.action && <div style={{ marginTop: 10 }}><Pill tone="primary" dot={false}>{offer.action}</Pill></div>}
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ms-ink-3)' }}>
              {checks.filter((c) => c.state === 'pass').length} of {checks.length} checks passing
            </div>
          </aside>
        </div>
      </section>
      <div style={{ marginTop: 14 }}>
        <Card title="About this wizard" pad>
          <p style={{ fontSize: 12, color: 'var(--ms-ink-2)', lineHeight: 1.6 }}>
            Fields come straight from the {offer.label} declaration in the catalogue, so each subcategory asks only for what it declares
            (for example, Industrial asks for clear height and has no bedrooms). See <Link href={`${RP_BASE}/v/${vertical.id}/catalogue?sub=${offer.id}`}>{vertical.label} offerings</Link> for the full declaration.
          </p>
        </Card>
      </div>
    </OsPage>
  );
}

/** One declared subcategory field, rendered by its declared control type. */
function DeclaredField({ f, value, onChange }: { f: MsFilterDef; value: FieldVal | undefined; onChange: (v: FieldVal) => void }) {
  const id = `wz-f-${f.id}`;
  const label = `${f.label}${f.required ? ' *' : ''}`;
  const str = typeof value === 'string' ? value : '';
  const arr = Array.isArray(value) ? value : [];

  if (f.type === 'multi' || (f.type === 'select' && f.many)) {
    return (
      <Field label={label}>
        <div className="gx-chips" role="group" aria-label={f.label}>
          {f.options.map((o) => {
            const on = arr.includes(o.v);
            return <button key={o.v} type="button" className="gx-chip" aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== o.v) : [...arr, o.v])}>{o.l}</button>;
          })}
        </div>
      </Field>
    );
  }
  if (f.type === 'select') {
    if (f.options.length <= 6) {
      return (
        <Field label={label}>
          <div className="gx-chips" role="group" aria-label={f.label}>
            {f.options.map((o) => <button key={o.v} type="button" className="gx-chip" aria-pressed={str === o.v} onClick={() => onChange(o.v)}>{o.l}</button>)}
          </div>
        </Field>
      );
    }
    return (
      <Field label={label} htmlFor={id}>
        <select id={id} className="gx-sel" value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </Field>
    );
  }
  if (f.type === 'toggle') {
    return (
      <Field label={label}>
        <div><Seg label={f.label} value={str || ''} onChange={(v) => onChange(v)} options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]} /></div>
      </Field>
    );
  }
  if (f.type === 'seg') {
    return (
      <Field label={label}>
        <div><Seg label={f.label} value={str} onChange={(v) => onChange(v)} options={f.options.map((o) => ({ v: o.v, l: o.l }))} /></div>
      </Field>
    );
  }
  if (f.type === 'range') {
    return (
      <Field label={`${label}${f.unit ? ` (${f.unit})` : ''}`} htmlFor={id}>
        <input id={id} type="number" min={0} inputMode="decimal" className="gx-inp" value={str} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  if (f.type === 'date') {
    return (
      <Field label={label} htmlFor={id}>
        <input id={id} type="date" className="gx-inp" value={str} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} className="gx-inp" value={str} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
