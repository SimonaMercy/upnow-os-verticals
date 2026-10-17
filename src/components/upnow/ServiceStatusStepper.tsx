/**
 * ServiceStatusStepper — the booking's progress on its mode's path
 * (fixed price: Booked → … → Reviewed; quote: Inspection requested → … →
 * Reviewed). Driven entirely by serviceStatusView(); shared by the customer
 * My Services page and the SP job page.
 */
import type { StatusView } from '@/lib/homeServices/statusView';
import { TONE_COLORS } from '@/lib/homeServices/statusView';

const GREEN = '#0B7A4E';
const LINE = '#DDE2DD';
const FAINT = '#8A968D';
const INK = '#182420';

export function ServiceStatusStepper({ view, audience = 'customer' }: { view: StatusView; audience?: 'customer' | 'provider' }) {
  const off = view.terminal === 'cancelled' || view.terminal === 'customer_no_show' || view.terminal === 'provider_no_show';
  const hint = audience === 'provider' ? view.spHint : view.customerHint;
  return (
    <div>
      <ol style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 4px', listStyle: 'none', margin: 0, padding: 0 }} aria-label="Booking progress">
        {view.steps.map((label, i) => {
          const done = !off && i < view.step;
          const current = !off && i === view.step;
          const color = current ? (view.terminal === 'dispute' ? '#B42318' : GREEN) : done ? GREEN : FAINT;
          return (
            <li key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} aria-current={current ? 'step' : undefined}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${done || current ? color : LINE}`,
                background: done ? GREEN : current ? '#fff' : 'transparent',
                color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{done ? '✓' : ''}</span>
              <span style={{ fontSize: 11.5, fontWeight: current ? 700 : 500, color: current ? INK : done ? '#3f4a44' : FAINT, whiteSpace: 'nowrap' }}>{label}</span>
              {i < view.steps.length - 1 && <span aria-hidden style={{ width: 14, height: 2, background: done ? GREEN : LINE, margin: '0 2px' }} />}
            </li>
          );
        })}
      </ol>
      {off && (
        <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: TONE_COLORS.danger.fg }}>
          {audience === 'provider' ? view.spLabel : view.label}
        </p>
      )}
      {hint && <p style={{ marginTop: off ? 2 : 8, fontSize: 12, color: '#5f6b63' }}>{hint}</p>}
    </div>
  );
}
