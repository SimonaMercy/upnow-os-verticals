'use client';

import { useState } from 'react';
import type { MediaType, SchemaObject } from '@/types/openapi';

/**
 * Sample payload rendering.
 *
 * The backend injects captured samples in three different places
 * (`shared/swagger/apply-examples.ts`):
 *
 *  - named request examples at `content[type].examples`
 *  - a single request/response example at `content[type].example`
 *  - a response example parked on the schema, `content[type].schema.example`,
 *    on a schema that has NO `type`/`properties` of its own
 *
 * Only the first of those is a shape a generic viewer expects, which is why all
 * of them were invisible here before: the schema tree rendered the third case as
 * the type `any`. `collectSamples` normalises the three into one list.
 */
export interface Sample {
  key: string;
  label: string;
  description?: string;
  value: unknown;
}

export function collectSamples(media: MediaType | undefined): Sample[] {
  if (!media) return [];

  const named = Object.entries(media.examples ?? {}).map(([key, ex]) => ({
    key,
    label: ex?.summary ?? key,
    description: ex?.description,
    value: ex?.value,
  }));
  if (named.length) return named;

  if (media.example !== undefined) {
    return [{ key: 'example', label: 'Example', value: media.example }];
  }
  if (media.schema?.example !== undefined) {
    return [{ key: 'example', label: 'Example', value: media.schema.example }];
  }
  return [];
}

/**
 * True when a schema carries nothing but an example — captured response samples
 * arrive this way. Rendering it as a schema tree yields a box reading `any`, so
 * callers show the sample alone instead.
 */
export function isExampleOnlySchema(schema: SchemaObject | undefined): boolean {
  if (!schema) return false;
  return (
    schema.example !== undefined &&
    !schema.properties &&
    !schema.items &&
    !schema.$ref &&
    !schema.allOf &&
    schema.type === undefined
  );
}

// ── JSON block ───────────────────────────────────────────────────
const TOKEN = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function colourise(line: string, lineKey: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const colour = m[1] ? '#0f4f36' : m[2] ? '#b45309' : m[3] ? '#7c3aed' : '#1d4ed8';
    out.push(
      <span key={`${lineKey}-${m.index}`} style={{ color: colour }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function JsonBlock({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null';

  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={copy}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 1,
          background: '#ffffff', border: '1px solid #e4e9e5', borderRadius: 6,
          padding: '3px 9px', cursor: 'pointer', fontSize: 11,
          color: copied ? '#15803d' : '#5f6b63', fontWeight: 600,
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre style={{
        margin: 0,
        padding: '12px 14px',
        paddingInlineEnd: 72,
        backgroundColor: '#f6f8fa',
        border: '1px solid #e4e9e5',
        borderRadius: 8,
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.65,
        color: '#46534c',
        overflowX: 'auto',
        maxHeight: 460,
        overflowY: 'auto',
      }}>
        {text.split('\n').map((line, i) => (
          <div key={i}>{colourise(line, String(i))}</div>
        ))}
      </pre>
    </div>
  );
}

// ── panel ────────────────────────────────────────────────────────
export function SamplePanel({ samples }: { samples: Sample[] }) {
  const [active, setActive] = useState(0);
  if (!samples.length) return null;

  const current = samples[Math.min(active, samples.length - 1)];

  return (
    <div>
      {samples.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {samples.map((s, i) => {
            const isActive = i === Math.min(active, samples.length - 1);
            return (
              <button
                key={s.key}
                onClick={() => setActive(i)}
                style={{
                  padding: '4px 11px',
                  borderRadius: 7,
                  border: `1px solid ${isActive ? '#a7e0cd' : '#e4e9e5'}`,
                  backgroundColor: isActive ? '#eef7f2' : '#ffffff',
                  color: isActive ? '#0f4f36' : '#5f6b63',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      {current.description && (
        <p style={{ fontSize: 12, color: '#5f6b63', margin: '0 0 8px' }}>{current.description}</p>
      )}
      <JsonBlock value={current.value} />
    </div>
  );
}
