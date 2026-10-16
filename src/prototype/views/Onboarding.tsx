'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, User, Check, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../store';
import { VERTICAL, VERTICALS, subsOf } from '../registry';
import { BASE } from '../nav';
import { DEMO_PERSON, TODAY } from '../seed';
import { Button, Card, Field, PageHeader, ProtoNote, SelectInput, Stepper, TextInput, VerticalTag } from '../ui';
import { BUSINESS_TYPES, REQUIRED_LICENCE } from './Business';
import type { Org, VerticalId } from '../types';

const STEPS = ['Business type', 'Details', 'Verticals', 'Documents', 'Review'];
const COLOURS = ['#047246'];

export function OnboardingView() {
  const { addOrg, orgs, nextId } = useProto();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState<'company' | 'individual'>('company');
  const [name, setName] = useState('');
  const [licence, setLicence] = useState('');
  const [emirate, setEmirate] = useState('Dubai');
  // Every vertical the business wants to operate in, each with its own business type and subcategories.
  const [sel, setSel] = useState<Partial<Record<VerticalId, { type: string; subs: string[] }>>>({});
  const [docs, setDocs] = useState<Record<string, boolean>>({});
  const chosen = VERTICALS.map((v) => v.id).filter((v) => sel[v]);

  const toggle = (v: VerticalId) => {
    const next = { ...sel };
    if (next[v]) delete next[v];
    else next[v] = { type: BUSINESS_TYPES[v][0], subs: subsOf(v).map((x) => x.key) };
    setSel(next);
  };
  const setFor = (v: VerticalId, p: Partial<{ type: string; subs: string[] }>) => setSel({ ...sel, [v]: { ...sel[v]!, ...p } });

  const baseDocs = [entity === 'company' ? 'Trade licence' : 'Emirates ID', entity === 'company' ? 'Owner / manager Emirates ID' : 'Passport'];
  // Licences differ per vertical; they can be added later, but listings in that vertical wait until they are on file.
  const licenceDocs = [...new Set(chosen.map((v) => REQUIRED_LICENCE[v]))].filter((d) => !baseDocs.includes(d));
  const docList = [...baseDocs, ...licenceDocs, 'Bank account letter'];

  const canNext = [
    true,
    name.trim().length > 2 && licence.trim().length > 3,
    chosen.length > 0 && chosen.every((v) => sel[v]!.subs.length > 0),
    baseDocs.every((d) => docs[d]),
    true,
  ][step];

  function submit() {
    const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const org: Org = {
      id: nextId('o'), name, legalName: entity === 'company' ? `${name} LLC` : name, entityType: entity, tradeLicence: licence, emirate,
      status: 'pending_review', initials, colour: COLOURS[orgs.length % COLOURS.length],
      branches: [{ id: 'b-main', name: 'Main location', area: emirate, verticals: chosen }],
      verticals: chosen.map((v) => {
        const lic = REQUIRED_LICENCE[v];
        const onFile = docs[lic] || baseDocs.includes(lic);
        return { vertical: v, status: 'submitted' as const, businessType: sel[v]!.type, subcategories: sel[v]!.subs, requestedAt: TODAY,
          licences: [{ name: lic, number: onFile ? 'Uploaded' : '', expires: onFile ? '2027-10-15' : '', status: onFile ? 'valid' as const : 'missing' as const }] };
      }),
      members: [{ id: nextId('m'), name: DEMO_PERSON.name, email: DEMO_PERSON.email, role: 'owner', branch: 'All branches', packs: chosen, status: 'active' }],
      documents: docList.map((d) => ({ name: d, status: docs[d] ? 'pending' : 'missing' })),
    };
    addOrg(org);
    router.push(BASE);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Start a business" subtitle={`${DEMO_PERSON.name} keeps their personal customer account. The business is a separate context they can switch into.`} />
      <div className="mb-5"><Stepper steps={STEPS} current={step} /></div>

      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {([['company', 'Company', 'Trade-licensed business with a team', Building2], ['individual', 'Individual', 'Owner, freelancer, guide or tutor', User]] as const).map(([id, label, body, Icon]) => (
            <button key={id} type="button" onClick={() => setEntity(id)}
              className={cn('flex flex-col gap-2 rounded-[var(--r)] border bg-white p-5 text-left', entity === id ? 'border-[var(--g7)] ring-2 ring-[var(--g2)]' : 'border-[var(--line)]')}>
              <Icon className="h-6 w-6 text-[var(--g7)]" aria-hidden />
              <span className="font-bold">{label}</span>
              <span className="text-sm text-[var(--ink3)]">{body}</span>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <Card className="grid gap-3 sm:grid-cols-2">
          <Field label={entity === 'company' ? 'Business name' : 'Your trading name'}><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hatta Trails Adventures" /></Field>
          <Field label={entity === 'company' ? 'Trade licence number' : 'Emirates ID / permit number'}><TextInput value={licence} onChange={(e) => setLicence(e.target.value)} /></Field>
          <Field label="Emirate"><SelectInput value={emirate} onChange={(e) => setEmirate(e.target.value)} options={['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain']} /></Field>
        </Card>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-[var(--ink3)]">Choose every vertical your business operates in. Each one is reviewed separately; you can add more later from Settings › Verticals & licences without registering again.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {VERTICALS.map((v) => {
              const Icon = v.icon;
              const on = !!sel[v.id];
              return (
                <button key={v.id} type="button" aria-pressed={on} onClick={() => toggle(v.id)}
                  className={cn('flex items-center gap-2 rounded-xl border bg-white p-3 text-left text-sm font-semibold transition-colors', on ? 'border-[var(--g7)] ring-2 ring-[var(--g2)]' : 'border-[var(--line)] hover:border-[var(--g5)]')}>
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--g1)] text-[var(--g7)]"><Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="flex-1">{v.label}</span>
                  {on && <Check className="h-4 w-4 text-[var(--g7)]" aria-hidden />}
                </button>
              );
            })}
          </div>
          {chosen.map((v) => (
            <Card key={v} className="flex flex-col gap-3">
              <div className="flex items-center gap-2"><VerticalTag v={v} size="md" /><span className="text-[13px] text-[var(--ink3)]">Licence: {REQUIRED_LICENCE[v]}</span></div>
              <Field label="Business type"><SelectInput value={sel[v]!.type} onChange={(e) => setFor(v, { type: e.target.value })} options={BUSINESS_TYPES[v]} /></Field>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {subsOf(v).map((x) => (
                  <label key={x.key} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
                    <input type="checkbox" checked={sel[v]!.subs.includes(x.key)} onChange={() => setFor(v, { subs: sel[v]!.subs.includes(x.key) ? sel[v]!.subs.filter((k) => k !== x.key) : [...sel[v]!.subs, x.key] })} />{x.label}
                  </label>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {step === 3 && (
        <Card>
          <ul className="flex flex-col divide-y divide-[#eef0ef]">
            {docList.map((d, i) => (
              <li key={d} className="flex items-center gap-3 py-3">
                <span className="flex-1 text-sm font-semibold">{d} {i >= baseDocs.length && <span className="font-normal text-[var(--ink3)]">(can be added later — listings in that vertical wait until it is on file)</span>}</span>
                {docs[d]
                  ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--g7)]"><Check className="h-4 w-4" aria-hidden />Attached</span>
                  : <Button size="sm" variant="secondary" onClick={() => setDocs({ ...docs, [d]: true })}><Upload className="h-3.5 w-3.5" aria-hidden />Attach</Button>}
              </li>
            ))}
          </ul>
          <div className="mt-3"><ProtoNote>Files are not uploaded; attaching only marks the item in the prototype.</ProtoNote></div>
        </Card>
      )}

      {step === 4 && (
        <Card className="flex flex-col gap-3 text-sm">
          <div className="text-lg font-bold">{name}</div>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5">
            <dt className="text-[var(--ink3)]">Entity</dt><dd className="capitalize">{entity}</dd>
            <dt className="text-[var(--ink3)]">Licence</dt><dd>{licence}</dd>
            <dt className="text-[var(--ink3)]">Verticals</dt>
            <dd className="flex flex-col gap-1">{chosen.map((v) => <span key={v} className="flex flex-wrap items-center gap-1.5"><VerticalTag v={v} /> {sel[v]!.type} · {sel[v]!.subs.length} subcategories</span>)}</dd>
          </dl>
          <ProtoNote kind="info">After submitting, the business appears in <strong>Admin → Provider verification</strong> and each vertical ({chosen.map((v) => VERTICAL[v].label).join(', ')}) as its own request in <strong>Admin → Vertical access</strong>. Packs appear as each is approved; you can prepare listings meanwhile.</ProtoNote>
        </Card>
      )}

      <div className="mt-5 flex justify-between">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
        {step < 4 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button> : <Button onClick={submit}>Submit for verification</Button>}
      </div>
    </div>
  );
}
