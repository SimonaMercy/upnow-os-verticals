'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, FileBarChart } from 'lucide-react';
import { useProto } from '../store';
import { SUB, VERTICAL } from '../registry';
import { Badge, Button, Modal, PageHeader, ProtoNote, SectionTitle, Table, Td, VerticalTag, fmtAed } from '../ui';
import type { VerticalId } from '../types';

interface ReportDef { id: string; title: string; body: string; production?: boolean }

const SHARED: ReportDef[] = [
  { id: 'revenue', title: 'Revenue by vertical', body: 'Collected and outstanding amounts per vertical this month.' },
  { id: 'conversion', title: 'Enquiry conversion by vertical', body: 'How many enquiries reached a transaction, per vertical.' },
  { id: 'activity', title: 'Team activity log', body: 'Every status change with actor and context (Settings → Audit history).' },
];

const PACK_REPORTS: Record<VerticalId, ReportDef[]> = {
  spaces: [
    { id: 'portfolio-overview', title: 'Portfolio overview & occupancy', body: 'Existing report', production: true },
    { id: 'leasing-funnel', title: 'Leasing funnel', body: 'Existing report', production: true },
    { id: 'lease-expiry', title: 'Lease expiry & renewal forecast', body: 'Existing report', production: true },
    { id: 'rent-receivable', title: 'Rent receivable & cheques management', body: 'Existing report', production: true },
    { id: 'security-deposits', title: 'Security deposits', body: 'Existing report', production: true },
    { id: 'stay-occupancy', title: 'Short-stay occupancy & ADR', body: 'Nights sold, average daily rate, cancellations.' },
    { id: 'court-utilisation', title: 'Court utilisation by hour', body: 'Booked vs available slot-hours, peak vs off-peak.' },
    { id: 'charter-settlement', title: 'Charter revenue & settlement', body: 'Trips, extras and deposit settlement per vessel.' },
  ],
  services: [
    { id: 'job-sla', title: 'Job SLA & completion', body: 'Time to accept, time on site, completion rate.' },
    { id: 'utilisation', title: 'Technician & staff utilisation', body: 'Booked hours vs rostered hours.' },
  ],
  experiences: [
    { id: 'fill-rate', title: 'Session fill rate', body: 'Seats sold vs capacity, by product and day.' },
    { id: 'no-shows', title: 'No-shows & provider cancellations', body: 'Guest no-shows and sessions cancelled with refunds.' },
  ],
  memberships: [
    { id: 'churn', title: 'Member churn & renewals', body: 'Active, frozen, expired and renewed members.' },
    { id: 'credit-burn', title: 'Credit burn & breakage', body: 'Credits used vs expired unused.' },
  ],
  programs: [
    { id: 'admissions', title: 'Admissions funnel', body: 'Tours → applications → offers → enrolments.' },
    { id: 'attendance', title: 'Attendance rate', body: 'Present / late / absent per group.' },
  ],
  health: [
    { id: 'clinic-utilisation', title: 'Appointment utilisation', body: 'Booked vs available practitioner hours. No clinical data.' },
  ],
  insurance: [
    { id: 'quote-to-policy', title: 'Quote-to-policy conversion', body: 'Requests, quotes received, applications, policies issued.' },
    { id: 'renewals', title: 'Renewals due', body: 'Policies expiring in the next 60 days.' },
  ],
};

/** `vertical` scopes the catalogue to one pack (pack → Reports). */
export function ReportsView({ vertical }: { vertical?: VerticalId } = {}) {
  const { org, approvedVerticals, invoices, leads, context } = useProto();
  const [open, setOpen] = useState<ReportDef | null>(null);
  const packs = vertical ? [vertical] : approvedVerticals(org);
  const myInv = invoices.filter((i) => i.orgId === context);
  const myLeads = leads.filter((l) => l.orgId === context);

  return (
    <div>
      <PageHeader eyebrow={vertical ? <VerticalTag v={vertical} /> : <Badge tone="green">Business-wide</Badge>} title={vertical ? `${VERTICAL[vertical].label} reports` : 'Reports across verticals'}
        subtitle={vertical ? 'This pack’s report catalogue. Production reports open the existing report hub, which is not changed.' : 'One catalogue. Cross-vertical reports at the top; each authorised pack adds its own. Spaces reports open the existing production report hub, which is not changed.'} />

      {!vertical && <SectionTitle>Across all verticals</SectionTitle>}
      {!vertical && <div className="mb-8 grid gap-3 md:grid-cols-3">
        {SHARED.map((r) => (
          <button key={r.id} type="button" onClick={() => setOpen(r)} className="flex flex-col gap-1.5 rounded-[var(--r)] border border-[var(--line)] bg-white p-4 text-left hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
            <BarChart3 className="h-5 w-5 text-[var(--g7)]" aria-hidden />
            <span className="font-bold text-[var(--ink)]">{r.title}</span>
            <span className="text-sm text-[var(--ink3)]">{r.body}</span>
          </button>
        ))}
      </div>}

      {packs.map((v) => (
        <div key={v} className="mb-8">
          <SectionTitle right={<VerticalTag v={v} size="md" />}>{VERTICAL[v].label} pack</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {PACK_REPORTS[v].map((r) => r.production ? (
              <Link key={r.id} href={`/prototype/os/rp/reports/${r.id}`} className="flex flex-col gap-1.5 rounded-[var(--r)] border border-[var(--g2)] bg-[var(--g1)] p-4 hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
                <span className="flex items-center justify-between"><FileBarChart className="h-5 w-5 text-[var(--g7)]" aria-hidden /><Badge tone="green">Production</Badge></span>
                <span className="font-bold text-[var(--ink)]">{r.title}</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--g7)]">Open live report</span>
              </Link>
            ) : (
              <button key={r.id} type="button" onClick={() => setOpen(r)} className="flex flex-col gap-1.5 rounded-[var(--r)] border border-[var(--line)] bg-white p-4 text-left hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
                <span className="flex items-center justify-between"><FileBarChart className="h-5 w-5 text-[#8a958e]" aria-hidden /><Badge tone="amber">Proposed</Badge></span>
                <span className="font-bold text-[var(--ink)]">{r.title}</span>
                <span className="text-sm text-[var(--ink3)]">{r.body}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} subtitle="Sample output from prototype data" wide
        footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
        {open?.id === 'revenue' && (
          <Table head={['Vertical', 'Collected', 'Outstanding', 'Refunded']}>
            {packs.map((v) => {
              const xs = myInv.filter((i) => i.vertical === v);
              const s = (st: string[]) => xs.filter((i) => st.includes(i.status)).reduce((a, i) => a + i.amount, 0);
              return (
                <tr key={v}><Td><VerticalTag v={v} /></Td><Td className="tabular-nums">{fmtAed(s(['paid']))}</Td><Td className="tabular-nums">{fmtAed(s(['issued', 'overdue']))}</Td><Td className="tabular-nums">{fmtAed(s(['refunded']))}</Td></tr>
              );
            })}
          </Table>
        )}
        {open?.id === 'conversion' && (
          <Table head={['Vertical', 'Enquiries', 'Converted', 'Lost', 'Conversion']}>
            {packs.map((v) => {
              const xs = myLeads.filter((l) => SUB[l.subKey].vertical === v);
              const conv = xs.filter((l) => l.stage === 'converted').length;
              return (
                <tr key={v}><Td><VerticalTag v={v} /></Td><Td>{xs.length}</Td><Td>{conv}</Td><Td>{xs.filter((l) => l.stage === 'lost').length}</Td><Td className="font-semibold">{xs.length ? Math.round((conv / xs.length) * 100) : 0}%</Td></tr>
              );
            })}
          </Table>
        )}
        {open && !['revenue', 'conversion'].includes(open.id) && (
          <ProtoNote>Report definition only: {open.body} In production this would be a catalogue entry in the shared report hub (today <code>reportCatalog.tsx</code>), tagged with its pack so it appears only for authorised businesses.</ProtoNote>
        )}
      </Modal>
    </div>
  );
}
