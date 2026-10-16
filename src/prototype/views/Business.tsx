'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Upload, Plus, Check, Minus, MapPin, FileText, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../store';
import { SharedTabs } from '../bridgeFrame';
import { SUB, VERTICAL, VERTICALS, subsOf } from '../registry';
import { BASE, ROLE_PRESETS, SHARED_MODULES } from '../nav';
import { TODAY } from '../seed';
import {
  Avatar, Badge, Button, Card, Field, Modal, PageHeader, ProtoNote, SectionTitle, SelectInput, StatusBadge, Table, Td, TextInput,
  VerticalTag, fmtDate,
} from '../ui';
import type { RolePreset, VerticalAuth, VerticalId } from '../types';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'verticals', label: 'Verticals & licences' },
  { id: 'branches', label: 'Branches' },
  { id: 'team', label: 'Team & roles' },
  { id: 'audit', label: 'Audit history' },
];

export const BUSINESS_TYPES: Record<VerticalId, string[]> = {
  spaces: ['Landlord company', 'Individual owner', 'Brokerage (ORN)', 'Property manager', 'Holiday home operator', 'Venue operator', 'Sports facility operator', 'Charter operator'],
  services: ['Services company', 'Salon / studio', 'Freelancer (UAE permit)'],
  experiences: ['Tour operator', 'Activity provider', 'Licensed guide (individual)', 'Workshop host (individual)'],
  memberships: ['Gym / club', 'Membership aggregator'],
  programs: ['Nursery', 'School', 'Higher education institution', 'Training centre & academy', 'Tutor / coach (individual)'],
  health: ['Healthcare facility', 'Home healthcare provider'],
  insurance: ['Insurer', 'Insurance broker', 'Insurance agency'],
};
export const REQUIRED_LICENCE: Record<VerticalId, string> = {
  spaces: 'Trade licence', services: 'Trade licence or freelance permit', experiences: 'DTCM tour operator licence',
  memberships: 'DSC sports facility licence', programs: 'KHDA permit', health: 'DHA facility licence', insurance: 'CBUAE licence',
};

export function BusinessView({ tab }: { tab: string }) {
  const { org } = useProto();
  if (!org) return <ProtoNote>Switch to a business context to manage it.</ProtoNote>;
  const current = TABS.some((t) => t.id === tab) ? tab : 'profile';
  return (
    <div>
      {org.verticals.some((a) => a.vertical === 'spaces' && a.status === 'approved') && <SharedTabs slug="settings" active="/prototype/os/settings" />}
      <PageHeader eyebrow={<Badge tone="green">Shared module</Badge>} title="Settings"
        subtitle="Who you are, what you are authorised to operate, where, and who does what — one place for every vertical. The business and its verification live here, as production has no separate Business tab." />
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--line)]">
        {TABS.map((t) => (
          <Link key={t.id} role="tab" aria-selected={current === t.id} href={`${BASE}/settings/${t.id}`}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold', current === t.id ? 'border-[var(--g7)] text-[var(--g7)]' : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink)]')}>
            {t.label}
          </Link>
        ))}
      </div>
      {current === 'profile' && <ProfileTab />}
      {current === 'verification' && <VerificationTab />}
      {current === 'verticals' && <VerticalsTab />}
      {current === 'branches' && <BranchesTab />}
      {current === 'team' && <TeamTab />}
      {current === 'audit' && <AuditTab />}
    </div>
  );
}

function ProfileTab() {
  const { org, patchOrg } = useProto();
  const [name, setName] = useState(org!.name);
  const [legal, setLegal] = useState(org!.legalName);
  return (
    <Card className="max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Trading name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Legal name"><TextInput value={legal} onChange={(e) => setLegal(e.target.value)} /></Field>
        <Field label="Entity type"><TextInput value={org!.entityType === 'company' ? 'Company' : 'Individual'} disabled /></Field>
        <Field label="Trade licence" hint="Changing the licence re-triggers verification"><TextInput value={org!.tradeLicence} disabled /></Field>
        <Field label="Emirate"><TextInput value={org!.emirate} disabled /></Field>
        <Field label="Status"><div className="flex h-10 items-center"><StatusBadge status={org!.status} /></div></Field>
      </div>
      <div className="mt-4 flex justify-end"><Button onClick={() => patchOrg(org!.id, { name, legalName: legal }, 'Business profile updated')}>Save profile</Button></div>
    </Card>
  );
}

function VerificationTab() {
  const { org, patchOrg, applications, patch } = useProto();
  const o = org!;
  const app = applications.find((a) => a.orgName === o.name);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        {o.status === 'changes_requested' && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-[#fbf0dc] p-3 text-[13.5px] text-[#8a5a14]">
            <span className="min-w-0 flex-1"><strong>UpNow asked for changes.</strong> {app?.note ?? 'Update the documents below, then resubmit.'}</span>
            <Button size="sm" onClick={() => {
              patchOrg(o.id, { status: 'pending_review' }, 'Verification resubmitted');
              if (app) patch('applications', app.id, { status: 'pending_review' });
            }}>Resubmit for verification</Button>
          </div>
        )}
        {o.status === 'pending_review' && <div className="mb-4"><ProtoNote kind="info">Verification is with UpNow. You can already prepare listings — they wait until you are approved.</ProtoNote></div>}
        <SectionTitle>Organisation documents</SectionTitle>
        <ul className="flex flex-col divide-y divide-[#eef0ef]">
          {o.documents.map((d) => (
            <li key={d.name} className="flex flex-wrap items-center gap-3 py-3">
              <FileText className="h-4 w-4 text-[#8a958e]" aria-hidden />
              <span className="flex-1 text-sm font-semibold">{d.name}</span>
              {d.expires && <span className="text-xs text-[var(--ink3)]">Expires {fmtDate(d.expires)}</span>}
              <StatusBadge status={d.status} />
              {d.status !== 'verified' && (
                <Button size="sm" variant="secondary" onClick={() => patchOrg(o.id, { documents: o.documents.map((x) => (x.name === d.name ? { ...x, status: 'pending', expires: x.expires } : x)) }, `Uploaded ${d.name}`)}>
                  <Upload className="h-3.5 w-3.5" aria-hidden />Upload
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-3">
        <SectionTitle>Two separate gates</SectionTitle>
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--g7)]" aria-hidden /><span className="text-sm font-semibold">Organisation</span><span className="ml-auto"><StatusBadge status={o.status} /></span></div>
        <p className="text-sm text-[var(--ink3)]">Identity, trade licence and bank details. Verified once for the business.</p>
        <div className="border-t border-[#eef0ef] pt-3 text-sm font-semibold">Vertical authorisation</div>
        {o.verticals.map((v) => (
          <div key={v.vertical} className="flex items-center gap-2 text-sm"><VerticalTag v={v.vertical} /><span className="ml-auto"><StatusBadge status={v.status} /></span></div>
        ))}
        <p className="text-sm text-[var(--ink3)]">Each vertical has its own licences. Listings are then reviewed one by one.</p>
      </Card>
    </div>
  );
}

/** A vertical's licences plus any subcategory licence gate it still lacks (shown as missing, uploadable). */
function withGateLicences(a: VerticalAuth): VerticalAuth['licences'] {
  const gates = [...new Set(a.subcategories.map((k) => SUB[k]?.licenceGate).filter((g): g is string => !!g))];
  const extra = gates.filter((g) => !a.licences.some((l) => l.name === g)).map((g) => ({ name: g, number: '', expires: '', status: 'missing' as const }));
  return [...a.licences, ...extra];
}

function VerticalsTab() {
  const { org, requestVertical, setVertical } = useProto();
  const o = org!;
  const [req, setReq] = useState<VerticalId | null>(null);
  const [type, setType] = useState('');
  const [subs, setSubs] = useState<string[]>([]);
  const [licNo, setLicNo] = useState('');

  function openReq(v: VerticalId) {
    setReq(v); setType(BUSINESS_TYPES[v][0]); setSubs(subsOf(v).map((s) => s.key)); setLicNo('');
  }

  return (
    <div className="flex flex-col gap-3">
      <ProtoNote kind="info">A business must be authorised for a vertical (and its subcategories) before it can list there. Approval happens in <Link href="/prototype/admin/access" className="font-semibold underline">Admin → Vertical access</Link>.</ProtoNote>
      <div className="grid gap-3 lg:grid-cols-2">
        {VERTICALS.map((vd) => {
          const a = o.verticals.find((x) => x.vertical === vd.id);
          const Icon = vd.icon;
          return (
            <Card key={vd.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: vd.tint, color: vd.accent }}><Icon className="h-5 w-5" aria-hidden /></span>
                <div className="flex-1"><div className="font-bold">{vd.label}</div><div className="text-xs text-[var(--ink3)]">{a ? a.businessType : vd.regulators}</div></div>
                <StatusBadge status={a?.status ?? 'not_requested'} />
              </div>
              {a ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {subsOf(vd.id).map((s) => (
                      <span key={s.key} className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', a.subcategories.includes(s.key) ? 'bg-[var(--g1)] text-[var(--g7)]' : 'bg-[#eef0ef] text-[#8a958e] line-through')}>{s.label}</span>
                    ))}
                  </div>
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {withGateLicences(a).map((l) => (
                      <li key={l.name} className="flex flex-wrap items-center gap-2">
                        <span className="flex-1">{l.name} {l.number && <span className="text-[var(--ink3)]">· {l.number}</span>}</span>
                        {l.expires && <span className="text-xs text-[var(--ink3)]">{fmtDate(l.expires)}</span>}
                        <StatusBadge status={l.status} />
                        {l.status !== 'valid' && (
                          <Button size="sm" variant="secondary" onClick={() => setVertical(o.id, a.vertical, {
                            licences: [
                              ...a.licences.filter((x) => x.name !== l.name),
                              { name: l.name, status: 'valid', number: l.number || 'Uploaded', expires: '2027-10-15' },
                            ],
                          }, `Uploaded ${l.name} — waiting listings move on`)}>
                            <Upload className="h-3.5 w-3.5" aria-hidden />{l.status === 'expiring' ? 'Renew' : 'Upload'}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {a.note && <p className="rounded-lg bg-[#fbf0dc] px-3 py-2 text-[13px] text-[#8a5a14]">{a.note}</p>}
                  {a.status === 'submitted' && <p className="text-xs text-[var(--ink3)]">Requested {fmtDate(a.requestedAt)} · awaiting UpNow review</p>}
                  {(a.status === 'changes_requested' || a.status === 'rejected') && <Button size="sm" variant="secondary" onClick={() => openReq(vd.id)}>Update and resubmit</Button>}
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-[var(--ink3)]">Requires: {REQUIRED_LICENCE[vd.id]}</p>
                  <Button size="sm" onClick={() => openReq(vd.id)}><Plus className="h-3.5 w-3.5" aria-hidden />Request access</Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {req && (
        <Modal open onClose={() => setReq(null)} title={`Request access · ${VERTICAL[req].label}`} subtitle="Submitted to UpNow for review. Your existing verticals are unaffected."
          footer={<><Button variant="secondary" onClick={() => setReq(null)}>Cancel</Button><Button disabled={!subs.length} onClick={() => {
            requestVertical(o.id, {
              vertical: req, status: 'submitted', businessType: type, subcategories: subs, requestedAt: TODAY,
              licences: [{ name: REQUIRED_LICENCE[req], number: licNo, expires: licNo ? '2027-10-15' : '', status: licNo ? 'valid' : 'missing' }],
            });
            setReq(null);
          }}>Submit request</Button></>}>
          <div className="flex flex-col gap-4">
            <Field label="Business type"><SelectInput value={type} onChange={(e) => setType(e.target.value)} options={BUSINESS_TYPES[req]} /></Field>
            <div>
              <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--ink2)]">Subcategories you want to operate</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {subsOf(req).map((s) => (
                  <label key={s.key} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
                    <input type="checkbox" checked={subs.includes(s.key)} onChange={() => setSubs(subs.includes(s.key) ? subs.filter((x) => x !== s.key) : [...subs, s.key])} />
                    {s.label}{s.licenceGate && <span className="text-[11px] text-[var(--ink3)]">· needs {s.licenceGate}</span>}
                  </label>
                ))}
              </div>
            </div>
            <Field label={`${REQUIRED_LICENCE[req]} number`} hint="Leave empty to upload later — the request is reviewed with the licence marked missing."><TextInput value={licNo} onChange={(e) => setLicNo(e.target.value)} /></Field>
            <ProtoNote>Document upload is simulated.</ProtoNote>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BranchesTab() {
  const { org, patchOrg, approvedVerticals } = useProto();
  const o = org!;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [vs, setVs] = useState<VerticalId[]>([]);
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Add branch</Button></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {o.branches.map((b) => (
          <Card key={b.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold"><MapPin className="h-4 w-4 text-[var(--g7)]" aria-hidden />{b.name}</div>
            <div className="text-sm text-[var(--ink3)]">{b.area}, {o.emirate}</div>
            <div className="flex flex-wrap gap-1">{b.verticals.map((v) => <VerticalTag key={v} v={v} />)}</div>
            <div className="text-xs text-[var(--ink3)]">{o.members.filter((m) => m.branch === b.name || m.branch === 'All branches').length} team members</div>
          </Card>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add branch"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!name || !area} onClick={() => {
          patchOrg(o.id, { branches: [...o.branches, { id: `b-${o.branches.length + 10}`, name, area, verticals: vs }] }, `Branch “${name}” added`);
          setOpen(false); setName(''); setArea(''); setVs([]);
        }}>Add branch</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Branch name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Area"><TextInput value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Al Barsha" /></Field>
          <div className="flex flex-wrap gap-1.5">
            {approvedVerticals(o).map((v) => (
              <button key={v} type="button" aria-pressed={vs.includes(v)} onClick={() => setVs(vs.includes(v) ? vs.filter((x) => x !== v) : [...vs, v])}
                className={cn('rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ring-inset', vs.includes(v) ? 'bg-[var(--ink)] text-white ring-[var(--ink)]' : 'bg-white ring-[var(--line2)]')}>{VERTICAL[v].label}</button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TeamTab() {
  const { org, addMember, approvedVerticals, nextId } = useProto();
  const o = org!;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RolePreset>('leasing_agent');
  const [branch, setBranch] = useState('All branches');
  const [packs, setPacks] = useState<VerticalId[]>([]);
  const presets = Object.keys(ROLE_PRESETS) as RolePreset[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle right={<Button onClick={() => { setOpen(true); setPacks(approvedVerticals(o)); }}><Plus className="h-4 w-4" aria-hidden />Invite member</Button>}>Members</SectionTitle>
        <Table head={['Member', 'Role preset', 'Branch', 'Vertical packs', 'Status']}>
          {o.members.map((m) => (
            <tr key={m.id}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={m.name} size={30} /><div><div className="font-semibold">{m.name}</div><div className="text-xs text-[var(--ink3)]">{m.email}</div></div></div></Td>
              <Td>{ROLE_PRESETS[m.role].label}</Td>
              <Td>{m.branch}</Td>
              <Td><div className="flex flex-wrap gap-1">{m.packs.map((p) => <VerticalTag key={p} v={p} />)}</div></Td>
              <Td><StatusBadge status={m.status} /></Td>
            </tr>
          ))}
        </Table>
      </div>

      <div>
        <SectionTitle>Permission matrix</SectionTitle>
        <p className="mb-3 text-sm text-[var(--ink3)]">Presets decide which shared modules a member sees. Pack access is granted per vertical on top. Use the “View as role” switch in the top bar to see the effect on the sidebar.</p>
        <Table head={['Module', ...presets.map((p) => ROLE_PRESETS[p].label)]}>
          {[
            ...SHARED_MODULES.map((m) => ({ label: m.label, perm: m.perm })),
            { label: 'Pack · Overview', perm: 'overview' as const },
            { label: 'Pack · operations (Portfolio, Leases, Bookings, Jobs…)', perm: 'operate' as const },
            { label: 'Pack · Listings', perm: 'listings' as const },
            { label: 'Pack · Customers', perm: 'customers' as const },
            { label: 'Pack · Transactions / Performance & Economics', perm: 'finance' as const },
            { label: 'Pack · Reports', perm: 'reports' as const },
          ].map((m) => (
            <tr key={m.label}>
              <Td className="font-semibold">{m.label}</Td>
              {presets.map((p) => (
                <Td key={p}>{ROLE_PRESETS[p].perms.includes(m.perm)
                  ? <span className="inline-flex items-center gap-1 text-[var(--g7)]"><Check className="h-4 w-4" aria-hidden />Allowed</span>
                  : <span className="inline-flex items-center gap-1 text-[#8a958e]"><Minus className="h-4 w-4" aria-hidden />Hidden</span>}</Td>
              ))}
            </tr>
          ))}
        </Table>
        <div className="mt-3"><ProtoNote kind="info">Spaces keeps its existing fine-grained manager permissions (41 flags such as <code>canManageEjari</code>, <code>canClearCheques</code>) as the Spaces pack permission group. Other packs get their own groups.</ProtoNote></div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Invite team member"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!name || !email.includes('@')} onClick={() => {
          addMember(o.id, { id: nextId('m'), name, email, role, branch, packs, status: 'invited' });
          setOpen(false); setName(''); setEmail('');
        }}>Send invitation</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role preset" hint={ROLE_PRESETS[role].description}><SelectInput value={role} onChange={(e) => setRole(e.target.value as RolePreset)} options={presets.map((p) => ({ value: p, label: ROLE_PRESETS[p].label }))} /></Field>
            <Field label="Branch"><SelectInput value={branch} onChange={(e) => setBranch(e.target.value)} options={['All branches', ...o.branches.map((b) => b.name)]} /></Field>
          </div>
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--ink2)]">Vertical packs</div>
            <div className="flex flex-wrap gap-1.5">
              {approvedVerticals(o).map((v) => (
                <button key={v} type="button" aria-pressed={packs.includes(v)} onClick={() => setPacks(packs.includes(v) ? packs.filter((x) => x !== v) : [...packs, v])}
                  className={cn('rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 ring-inset', packs.includes(v) ? 'bg-[var(--ink)] text-white ring-[var(--ink)]' : 'bg-white ring-[var(--line2)]')}>{VERTICAL[v].label}</button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function AuditTab() {
  const { audit, org } = useProto();
  const rows = audit.filter((a) => a.context === org!.name || a.context === 'Admin');
  return (
    <Table head={['When', 'Actor', 'Context', 'Action', 'Record']}>
      {rows.map((a) => (
        <tr key={a.id}>
          <Td className="whitespace-nowrap text-xs">{fmtDate(a.at)}</Td>
          <Td>{a.actor}</Td>
          <Td>{a.context === 'Admin' ? <Badge tone="violet">Admin</Badge> : a.context}</Td>
          <Td>{a.action}</Td>
          <Td className="font-mono text-xs">{a.entity}</Td>
        </tr>
      ))}
    </Table>
  );
}
