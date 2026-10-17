'use client';

import type { EndpointEntry, GroupSection, OpenAPISpec } from '@/types/openapi';
import { EndpointDetail } from './EndpointDetail';
import { Markdown } from './Markdown';

/**
 * Landing view. Mirrors what the spec itself declares — the product groups and
 * the tag blurbs written in `main.ts` — so the first screen says what the API
 * covers instead of just "select an endpoint".
 */
function Overview({
  spec,
  groups,
  onSelectGroup,
}: {
  spec: OpenAPISpec;
  groups: GroupSection[];
  onSelectGroup: (g: string | null) => void;
}) {
  const total = groups.reduce((n, g) => n + g.endpointCount, 0);

  return (
    <div style={{ maxWidth: 840, paddingBlock: 32, paddingInline: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#14201a', margin: '0 0 8px' }}>
        {spec.info.title}
      </h1>
      <div style={{ fontSize: 13, color: '#8a948d', marginBottom: 18 }}>
        v{spec.info.version} · {total} endpoints · {groups.length} {groups.length === 1 ? 'product' : 'products'}
      </div>

      {spec.info.description && (
        <Markdown
          text={spec.info.description}
          style={{
            backgroundColor: '#ffffff', border: '1px solid #e4e9e5', borderRadius: 12,
            padding: '16px 20px', marginBottom: 24,
            fontSize: 14, color: '#46534c', lineHeight: 1.7,
          }}
        />
      )}

      {groups.map(group => (
        <div key={group.name} style={{
          backgroundColor: '#ffffff', border: '1px solid #e4e9e5', borderRadius: 12,
          marginBottom: 16, overflow: 'hidden',
        }}>
          <button
            onClick={() => onSelectGroup(group.name)}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '12px 20px', backgroundColor: '#f6f8f6',
              border: 'none', borderBottom: '1px solid #f0f0f0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}
          >
            <span style={{
              fontSize: 12, fontWeight: 800, color: '#46534c',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              {group.name}
            </span>
            <span style={{
              fontSize: 11, backgroundColor: '#eef7f2', color: '#047246',
              padding: '2px 8px', borderRadius: 99, fontWeight: 700,
            }}>
              {group.endpointCount} endpoints
            </span>
          </button>
          <div>
            {group.tags.map(section => (
              <div key={section.tag} style={{
                padding: '9px 20px',
                borderBottom: '1px solid #f6f5f2',
                display: 'flex', gap: 12, alignItems: 'baseline',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#14201a', minWidth: 190 }}>
                  {section.label}
                </span>
                <span style={{ fontSize: 12.5, color: '#5f6b63', flex: 1, lineHeight: 1.6 }}>
                  {section.description ?? ''}
                </span>
                <span style={{ fontSize: 11, color: '#8a948d', fontFamily: 'monospace' }}>
                  {section.endpoints.length}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 12, color: '#c4c2bc', marginTop: 20 }}>
        Press <kbd style={{ backgroundColor: '#eef1ef', border: '1px solid #e4e9e5', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace', fontSize: 11 }}>⌘K</kbd> to search every endpoint.
      </p>
    </div>
  );
}

interface Props {
  endpoint: EndpointEntry | null;
  spec: OpenAPISpec;
  groups: GroupSection[];
  onSelectGroup: (g: string | null) => void;
}

export function DocsMain({ endpoint, spec, groups, onSelectGroup }: Props) {
  return (
    <main style={{
      flex: 1,
      overflowY: 'auto',
      backgroundColor: '#f6f8f6',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {endpoint
        ? <EndpointDetail endpoint={endpoint} spec={spec} />
        : <Overview spec={spec} groups={groups} onSelectGroup={onSelectGroup} />
      }
    </main>
  );
}
