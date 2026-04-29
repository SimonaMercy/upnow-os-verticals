'use client';

import { useState } from 'react';
import type { OpenAPISpec, ResponseObject } from '@/types/openapi';
import { SchemaTree } from './SchemaTree';

function statusStyle(code: string): { bg: string; text: string; border: string } {
  const n = parseInt(code);
  if (n >= 200 && n < 300) return { bg: '#dcfce7', text: '#15803d', border: '#86efac' };
  if (n >= 300 && n < 400) return { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' };
  if (n >= 400 && n < 500) return { bg: '#fef3c7', text: '#b45309', border: '#fcd34d' };
  if (n >= 500)             return { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5' };
  return                           { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
}

interface Props {
  responses: Record<string, ResponseObject>;
  spec: OpenAPISpec;
}

export function ResponsesPanel({ responses, spec }: Props) {
  const codes = Object.entries(responses);
  const [active, setActive] = useState(codes[0]?.[0] ?? '200');

  const current = responses[active] as ResponseObject | undefined;
  const contentEntries = Object.entries(current?.content ?? {});
  const schema = contentEntries[0]?.[1]?.schema;

  return (
    <div>
      {/* Status code tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {codes.map(([code]) => {
          const s = statusStyle(code);
          const isActive = active === code;
          return (
            <button
              key={code}
              onClick={() => setActive(code)}
              style={{
                padding: '5px 14px',
                borderRadius: 7,
                border: `1px solid ${isActive ? s.border : '#e8e6e0'}`,
                backgroundColor: isActive ? s.bg : '#ffffff',
                color: isActive ? s.text : '#6b6860',
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'monospace',
                transition: 'all 0.1s',
              }}
            >
              {code}
            </button>
          );
        })}
      </div>

      {/* Description */}
      {current?.description && (
        <p style={{ fontSize: 14, color: '#6b6860', marginBottom: 12, marginTop: 0 }}>
          {current.description}
        </p>
      )}

      {/* Content type + schema */}
      {contentEntries.length > 0 ? (
        <>
          <div style={{ marginBottom: 10 }}>
            <code style={{
              fontSize: 11, fontFamily: 'monospace', backgroundColor: '#f6f8fa',
              padding: '3px 9px', borderRadius: 5, border: '1px solid #e8e6e0', color: '#6b6860',
            }}>
              {contentEntries[0][0]}
            </code>
          </div>
          {schema
            ? <SchemaTree schema={schema} spec={spec} />
            : <p style={{ fontSize: 13, color: '#9b9890', fontStyle: 'italic' }}>No schema defined</p>
          }
        </>
      ) : (
        !current?.description && (
          <p style={{ fontSize: 13, color: '#9b9890', fontStyle: 'italic' }}>No response body</p>
        )
      )}
    </div>
  );
}
