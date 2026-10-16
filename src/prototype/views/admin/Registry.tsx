'use client';

import { useState } from 'react';
import { toast } from '../../toast';
import { Lock } from 'lucide-react';
import { useProto } from '../../store';
import { MODEL_INFO, VERTICALS, subsOf } from '../../registry';
import { Badge, PageHeader, ProtoNote, SectionTitle, Table, Td } from '../../ui';

export function AdminRegistry() {
  const { orgs, listings } = useProto();
  const [disabled, setDisabled] = useState<string[]>([]);
  return (
    <div>
      <PageHeader title="Category registry" subtitle="The single source of verticals, subcategories and their operating rules (model, pricing basis, licence gates). Today production has two separate taxonomies — Space categories and the home-services catalogue." />
      <div className="mb-6"><ProtoNote>Seeded from upnow-marketspace <code>data/listings.js</code> (7 verticals, 35 live subcategories; “Mixed-use” is retired there but stays valid for existing production leases). Keys are namespaced — <code>insurance.health</code> vs the <code>health</code> vertical.</ProtoNote></div>
      {VERTICALS.map((v) => (
        <div key={v.id} className="mb-6">
          <SectionTitle right={<span className="text-xs text-[var(--ink3)]">{v.regulators}</span>}>{v.label}</SectionTitle>
          <Table head={['Subcategory', 'Key', 'Operating model', 'Pricing basis', 'Licence gate', 'Providers', 'Live', 'Enabled']}>
            {subsOf(v.id).map((s) => {
              const providers = orgs.filter((o) => o.verticals.some((a) => a.status === 'approved' && a.subcategories.includes(s.key))).length;
              const live = listings.filter((l) => l.subKey === s.key && l.status === 'published').length;
              const on = !disabled.includes(s.key);
              return (
                <tr key={s.key} className={on ? '' : 'opacity-50'}>
                  <Td className="font-semibold">{s.label}</Td>
                  <Td className="font-mono text-xs">{s.key}</Td>
                  <Td><Badge tone={MODEL_INFO[s.model].flow === 'lead' ? 'blue' : MODEL_INFO[s.model].flow === 'booking' ? 'green' : 'violet'}>{MODEL_INFO[s.model].label}</Badge></Td>
                  <Td className="text-[13px]">{s.priceBasis}</Td>
                  <Td className="text-[13px]">{s.licenceGate ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3 text-[#8a958e]" aria-hidden />{s.licenceGate}</span> : <span className="text-[#8a958e]">—</span>}</Td>
                  <Td>{providers}</Td>
                  <Td>{live}</Td>
                  <Td>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" checked={on} onChange={() => {
                        setDisabled(on ? [...disabled, s.key] : disabled.filter((x) => x !== s.key));
                        toast.message(`${s.label} ${on ? 'disabled' : 'enabled'} for new listings`, { description: 'Simulated — existing listings unaffected' });
                      }} />
                      {on ? 'On' : 'Off'}
                    </label>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </div>
      ))}
    </div>
  );
}
