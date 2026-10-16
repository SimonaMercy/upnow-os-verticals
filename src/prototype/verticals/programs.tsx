'use client';

import { useState } from 'react';
import { toast } from '../toast';
import { Baby, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWork } from '../store';
import { ATTENDANCE_DAYS, LEARNERS } from '../seed';
import { Button, Card, Meter, ProtoNote, SelectInput, StatusBadge, Table, Td, fmtDate } from '../ui';
import { ModuleHeader, PipelineBoard } from './common';

export function ProgramApplications() {
  return (
    <div>
      <ModuleHeader v="programs" title="Applications" model="Admission / enrolment"
        subtitle="Admissions run on applications, not bookings: tour → application → assessment → offer → enrolment. Guardian consent is captured before an offer can be accepted." />
      <PipelineBoard
        dataset="applications"
        stages={[{ id: 'submitted', label: 'Submitted' }, { id: 'tour_booked', label: 'Tour booked' }, { id: 'assessment', label: 'Assessment' }, { id: 'offer', label: 'Offer made' }, { id: 'enrolled', label: 'Enrolled' }]}
        next={{
          submitted: { to: 'tour_booked', label: 'Book tour', msg: 'Tour booked' },
          tour_booked: { to: 'assessment', label: 'Move to assessment', msg: 'Assessment scheduled' },
          assessment: { to: 'offer', label: 'Make offer', msg: 'Offer sent to guardians' },
          offer: { to: 'enrolled', label: 'Consent received · enrol', msg: 'Enrolled — guardian consent on file' },
        }}
        exit={{ from: ['submitted', 'tour_booked', 'assessment', 'offer'], to: 'cancelled', label: 'Decline', msg: 'Application declined' }}
        body={(w) => (
          <div className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--ink3)]">
            <span>{w.meta.program}</span>
            {w.meta.child !== '—' && <span className="inline-flex items-center gap-1"><Baby className="h-3 w-3" aria-hidden />{w.meta.child}</span>}
          </div>
        )}
      />
      <div className="mt-4"><ProtoNote kind="info">Children&apos;s records (medical notes, authorised pick-up people) are restricted to staff of the enrolled branch and are not shown in shared Customers.</ProtoNote></div>
    </div>
  );
}

export function ProgramEnrolments() {
  const items = useWork('enrolments');
  return (
    <div>
      <ModuleHeader v="programs" title="Enrolments" model="Enrolment" subtitle="Enrolled groups with their timetable and term progress." />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((e) => (
          <Card key={e.id} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2"><div><div className="font-bold">{e.title}</div><div className="text-sm text-[var(--ink3)]">{e.customer}</div></div><StatusBadge status={e.stage} /></div>
            <div className="text-sm">{e.meta.schedule}</div>
            <div className="text-xs text-[var(--ink3)]">Started {fmtDate(e.date)}</div>
            <Meter value={Number(e.meta.progress)} max={100} label={`${e.meta.progress}% of term`} />
          </Card>
        ))}
      </div>
    </div>
  );
}

type Mark = 'present' | 'late' | 'absent';
const NEXT: Record<Mark, Mark> = { present: 'late', late: 'absent', absent: 'present' };

export function ProgramAttendance() {
  const [group, setGroup] = useState('Caterpillars room (Nursery)');
  const [grid, setGrid] = useState<Record<string, Mark>>(() => {
    const g: Record<string, Mark> = {};
    LEARNERS.forEach((l, i) => ATTENDANCE_DAYS.forEach((d, j) => { g[`${l}|${d}`] = (i + j) % 9 === 4 ? 'absent' : (i * 3 + j) % 11 === 2 ? 'late' : 'present'; }));
    return g;
  });
  const today = ATTENDANCE_DAYS[ATTENDANCE_DAYS.length - 1];
  const present = LEARNERS.filter((l) => grid[`${l}|${today}`] !== 'absent').length;

  return (
    <div>
      <ModuleHeader v="programs" title="Attendance" model="Enrolment"
        subtitle="Daily register per group. Click a cell to cycle present → late → absent. Absences trigger a guardian notification."
        actions={<Button onClick={() => toast.success('Register saved', { description: `${present}/${LEARNERS.length} present today · simulated` })}>Save register</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-72"><SelectInput value={group} onChange={(e) => setGroup(e.target.value)} options={['Caterpillars room (Nursery)', 'U10 squad (Football academy)', 'Evening cohort (Data & AI)']} /></div>
        <span className="text-sm text-[var(--ink3)]">Today: <strong className="text-[var(--ink)]">{present}/{LEARNERS.length}</strong> present</span>
      </div>
      <Table head={['Learner', ...ATTENDANCE_DAYS, 'Rate']}>
        {LEARNERS.map((l) => {
          const marks = ATTENDANCE_DAYS.map((d) => grid[`${l}|${d}`]);
          const rate = Math.round((marks.filter((m) => m !== 'absent').length / marks.length) * 100);
          return (
            <tr key={l}>
              <Td className="font-semibold">{l}</Td>
              {ATTENDANCE_DAYS.map((d) => {
                const m = grid[`${l}|${d}`];
                return (
                  <Td key={d}>
                    <button type="button" onClick={() => setGrid({ ...grid, [`${l}|${d}`]: NEXT[m] })}
                      className={cn('w-20 rounded-lg px-2 py-1 text-xs font-semibold capitalize ring-1 ring-inset',
                        m === 'present' ? 'bg-[var(--g1)] text-[var(--g7)] ring-[var(--g2)]' : m === 'late' ? 'bg-[#fbf0dc] text-[#8a5a14] ring-[#efdcb4]' : 'bg-[#f9e3e1] text-[var(--red)] ring-[#efcfcb]')}>
                      {m}
                    </button>
                  </Td>
                );
              })}
              <Td className="font-semibold">{rate}%</Td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-4"><ProtoNote kind="info"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Nursery pick-up is checked against each child&apos;s authorised pick-up list before release.</ProtoNote></div>
    </div>
  );
}
