import type { GuideSection, Block, Step, LifecycleState, GridItem } from '@/data/guide';

// ── lifecycle state colors ────────────────────────────────────────
const LIFECYCLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  green:  { bg: '#eef7f2', text: '#0f4f36', border: '#047246' },
  blue:   { bg: '#eff6ff', text: '#1e40af', border: '#3b82f6' },
  amber:  { bg: '#fffbeb', text: '#92400e', border: '#f59e0b' },
  red:    { bg: '#fef2f2', text: '#991b1b', border: '#ef4444' },
  purple: { bg: '#faf5ff', text: '#6b21a8', border: '#a855f7' },
  gray:   { bg: '#f9fafb', text: '#374151', border: '#9ca3af' },
};

// ── section card wrapper ─────────────────────────────────────────
function SectionCard({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: '1px solid #e4e9e5',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      {title && (
        <div style={{
          padding: '10px 20px',
          borderBottom: '1px solid #eef1ef',
          fontSize: 12,
          fontWeight: 700,
          color: '#5f6b63',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          backgroundColor: '#f6f8f6',
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  );
}

// ── text block (basic markdown-ish: **bold**) ─────────────────────
function TextBlock({ md }: { md: string }) {
  // Simple bold rendering
  const parts = md.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p style={{ fontSize: 14, lineHeight: 1.7, color: '#46534c', margin: '0 0 4px' }}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i} style={{ color: '#14201a', fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
        }
        // Handle [text](href) links
        const linkParts = p.split(/(\[[^\]]+\]\([^)]+\))/g);
        return linkParts.map((lp, j) => {
          const linkMatch = lp.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
          if (linkMatch) {
            return <a key={j} href={linkMatch[2]} style={{ color: '#047246', textDecoration: 'none', fontWeight: 500 }}>{linkMatch[1]}</a>;
          }
          return <span key={j}>{lp}</span>;
        });
      })}
    </p>
  );
}

// ── note block ────────────────────────────────────────────────────
function NoteBlock({ md, variant = 'info' }: { md: string; variant?: string }) {
  const styles: Record<string, { bg: string; border: string; icon: string; color: string }> = {
    info:    { bg: '#eff6ff', border: '#3b82f6', icon: 'ℹ️', color: '#1e40af' },
    warning: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠️', color: '#92400e' },
    tip:     { bg: '#eef7f2', border: '#047246', icon: '💡', color: '#0f4f36' },
    success: { bg: '#f0fdf4', border: '#16a34a', icon: '✅', color: '#14532d' },
  };
  const s = styles[variant] ?? styles.info;
  return (
    <div style={{
      backgroundColor: s.bg,
      borderLeft: `3px solid ${s.border}`,
      borderRadius: 6,
      padding: '10px 14px',
      marginBottom: 12,
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <span style={{ flexShrink: 0, fontSize: 14, marginTop: 1 }}>{s.icon}</span>
      <div style={{ fontSize: 13, color: s.color, lineHeight: 1.6 }}>
        <TextBlock md={md} />
      </div>
    </div>
  );
}

// ── steps ─────────────────────────────────────────────────────────
function StepsBlock({ steps, title }: { steps: Step[]; title?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {title && (
        <p style={{ fontSize: 12, fontWeight: 700, color: '#5f6b63', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          {title}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 0 }}>
            {/* Connector column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
              <div style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                backgroundColor: '#047246',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                zIndex: 1,
              }}>
                {i + 1}
              </div>
              {i < steps.length - 1 && (
                <div style={{ width: 2, flex: 1, backgroundColor: '#d8efe3', minHeight: 16, marginBlock: 2 }} />
              )}
            </div>
            {/* Content */}
            <div style={{ paddingLeft: 12, paddingBottom: i < steps.length - 1 ? 16 : 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#14201a' }}>{step.label}</span>
                {step.actor && (
                  <span style={{
                    fontSize: 10, backgroundColor: '#eef1ef', color: '#5f6b63',
                    padding: '1px 6px', borderRadius: 99, fontWeight: 600,
                  }}>
                    {step.actor}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: '#5f6b63', margin: 0, lineHeight: 1.6 }}>{step.description}</p>
              {step.note && (
                <p style={{ fontSize: 11, color: '#8a948d', margin: '4px 0 0', fontStyle: 'italic' }}>{step.note}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── lifecycle states ──────────────────────────────────────────────
function LifecycleBlock({ states }: { states: LifecycleState[] }) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      {/* Arrow chain */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, minWidth: 'max-content', marginBottom: 12 }}>
        {states.map((state, i) => {
          const c = LIFECYCLE_COLORS[state.color ?? 'gray'];
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                backgroundColor: c.bg,
                border: `1.5px solid ${c.border}`,
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 700,
                color: c.text,
                whiteSpace: 'nowrap',
              }}>
                {state.label}
              </div>
              {i < states.length - 1 && (
                <span style={{ fontSize: 12, color: '#c4c2bc', marginInline: 4 }}>→</span>
              )}
            </div>
          );
        })}
      </div>
      {/* Descriptions below */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {states.filter(s => s.description).map((state, i) => {
          const c = LIFECYCLE_COLORS[state.color ?? 'gray'];
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                backgroundColor: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: 4,
                padding: '1px 7px',
                fontSize: 11,
                fontWeight: 700,
                color: c.text,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                {state.label}
              </span>
              <span style={{ fontSize: 13, color: '#5f6b63' }}>{state.description}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── table ─────────────────────────────────────────────────────────
function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 4 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: 11,
                fontWeight: 700,
                color: '#5f6b63',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                backgroundColor: '#f6f8f6',
                borderBottom: '1.5px solid #e4e9e5',
                whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid #eef1ef' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '9px 12px',
                  color: ci === 0 ? '#14201a' : '#46534c',
                  fontWeight: ci === 0 ? 600 : 400,
                  verticalAlign: 'top',
                  lineHeight: 1.6,
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── grid ──────────────────────────────────────────────────────────
function GridBlock({ items }: { items: GridItem[] }) {
  const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
    green:  { bg: '#eef7f2', text: '#0f4f36' },
    blue:   { bg: '#eff6ff', text: '#1e40af' },
    amber:  { bg: '#fffbeb', text: '#92400e' },
    purple: { bg: '#faf5ff', text: '#6b21a8' },
  };
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.min(items.length, 2)}, 1fr)`,
      gap: 12,
      marginBottom: 4,
    }}>
      {items.map((item, i) => (
        <div key={i} style={{
          backgroundColor: '#f6f8f6',
          border: '1px solid #e4e9e5',
          borderRadius: 8,
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#14201a' }}>{item.title}</span>
            </div>
            {item.badge && (
              <span style={{
                fontSize: 10,
                backgroundColor: BADGE_COLORS[item.badgeColor ?? 'green']?.bg ?? '#eef7f2',
                color: BADGE_COLORS[item.badgeColor ?? 'green']?.text ?? '#0f4f36',
                padding: '2px 8px',
                borderRadius: 99,
                fontWeight: 700,
              }}>
                {item.badge}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: '#5f6b63', margin: 0, lineHeight: 1.6 }}>{item.desc}</p>
        </div>
      ))}
    </div>
  );
}

// ── code block ────────────────────────────────────────────────────
function CodeBlock({ content }: { content: string }) {
  return (
    <pre style={{
      backgroundColor: '#14201a',
      color: '#d8efe3',
      padding: '14px 16px',
      borderRadius: 8,
      fontSize: 12,
      fontFamily: 'monospace',
      overflowX: 'auto',
      lineHeight: 1.7,
      margin: 0,
    }}>
      {content}
    </pre>
  );
}

// ── diagram block ─────────────────────────────────────────────────
function DiagramBlock({ src, title, description }: { src: string; title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ border: '1px solid #e4e9e5', borderRadius: 10, overflow: 'hidden', backgroundColor: '#ffffff' }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid #eef1ef',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f6f8f6',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#46534c' }}>{title}</span>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              color: '#047246',
              textDecoration: 'none',
              fontWeight: 600,
              border: '1px solid #d8efe3',
              borderRadius: 5,
              padding: '3px 10px',
              backgroundColor: '#eef7f2',
            }}
          >
            Open full size ↗
          </a>
        </div>
        <div style={{ overflowX: 'auto', padding: 12, backgroundColor: '#ffffff' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={title} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6 }} />
        </div>
      </div>
      {description && (
        <p style={{ fontSize: 12, color: '#8a948d', marginTop: 6, lineHeight: 1.5 }}>{description}</p>
      )}
    </div>
  );
}

// ── block renderer ────────────────────────────────────────────────
function renderBlock(block: Block, idx: number): React.ReactNode {
  switch (block.type) {
    case 'text':
      return <div key={idx} style={{ marginBottom: 10 }}><TextBlock md={block.md} /></div>;
    case 'heading':
      return block.level === 3
        ? <h3 key={idx} style={{ fontSize: 14, fontWeight: 700, color: '#14201a', margin: '16px 0 8px' }}>{block.text}</h3>
        : <h2 key={idx} style={{ fontSize: 16, fontWeight: 800, color: '#14201a', margin: '20px 0 10px' }}>{block.text}</h2>;
    case 'note':
      return <NoteBlock key={idx} md={block.md} variant={block.variant} />;
    case 'steps':
      return <StepsBlock key={idx} steps={block.steps} title={block.title} />;
    case 'lifecycle':
      return <div key={idx} style={{ marginBottom: 12 }}><LifecycleBlock states={block.states} /></div>;
    case 'table':
      return <SectionCard key={idx}><TableBlock headers={block.headers} rows={block.rows} /></SectionCard>;
    case 'grid':
      return <div key={idx} style={{ marginBottom: 12 }}><GridBlock items={block.items} /></div>;
    case 'code':
      return <div key={idx} style={{ marginBottom: 12 }}><CodeBlock content={block.content} /></div>;
    case 'diagram':
      return <DiagramBlock key={idx} src={block.src} title={block.title} description={block.description} />;
    case 'divider':
      return <hr key={idx} style={{ border: 'none', borderTop: '1px solid #e4e9e5', margin: '16px 0' }} />;
    default:
      return null;
  }
}

// ── empty state ────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: '#8a948d', textAlign: 'center', padding: 48,
    }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>📖</div>
      <p style={{ fontSize: 16, fontWeight: 700, color: '#46534c', margin: '0 0 8px' }}>
        Select a topic
      </p>
      <p style={{ fontSize: 13, margin: 0, maxWidth: 280, lineHeight: 1.6 }}>
        Choose any section from the sidebar, or use the search bar to find what you need.
      </p>
      <p style={{ fontSize: 12, marginTop: 16, color: '#c4c2bc' }}>
        Press <kbd style={{ backgroundColor: '#eef1ef', border: '1px solid #e4e9e5', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace', fontSize: 11 }}>⌘K</kbd> to search
      </p>
    </div>
  );
}

// ── main export ────────────────────────────────────────────────────
interface Props {
  section: GuideSection | null;
  categoryLabel?: string;
  categoryIcon?: string;
}

export function GuideMain({ section, categoryLabel, categoryIcon }: Props) {
  if (!section) return (
    <main style={{ flex: 1, overflowY: 'auto', backgroundColor: '#f6f8f6', display: 'flex', flexDirection: 'column' }}>
      <EmptyState />
    </main>
  );

  return (
    <main style={{ flex: 1, overflowY: 'auto', backgroundColor: '#f6f8f6' }}>
      <div style={{ maxWidth: 820, marginInline: 'auto', padding: '28px 32px 60px' }}>
        {/* Breadcrumb */}
        {categoryLabel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, fontSize: 12, color: '#8a948d' }}>
            <span>{categoryIcon}</span>
            <span>{categoryLabel}</span>
            <span>›</span>
            <span style={{ color: '#46534c', fontWeight: 500 }}>{section.title}</span>
          </div>
        )}

        {/* Title */}
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#14201a', margin: '0 0 8px', lineHeight: 1.25 }}>
          {section.title}
        </h1>
        <p style={{ fontSize: 14, color: '#5f6b63', margin: '0 0 24px', lineHeight: 1.6 }}>
          {section.description}
        </p>

        {/* Tags */}
        {section.tags && section.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 28 }}>
            {section.tags.map(t => (
              <span key={t} style={{
                fontSize: 11, backgroundColor: '#eef1ef', color: '#5f6b63',
                padding: '2px 8px', borderRadius: 99, fontWeight: 500,
              }}>
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Divider */}
        <hr style={{ border: 'none', borderTop: '1px solid #e4e9e5', marginBottom: 24 }} />

        {/* Content blocks */}
        {section.blocks.map((block, i) => renderBlock(block, i))}
      </div>
    </main>
  );
}
