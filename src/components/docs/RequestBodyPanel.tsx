'use client';

import { useState } from 'react';
import type { RequestBody, OpenAPISpec } from '@/types/openapi';
import { SchemaTree } from './SchemaTree';
import { SamplePanel, collectSamples, isExampleOnlySchema } from './SamplePanel';
import { ViewToggle } from './ViewToggle';

interface Props {
  body: RequestBody;
  spec: OpenAPISpec;
}

export function RequestBodyPanel({ body, spec }: Props) {
  const entries = Object.entries(body.content ?? {});
  const [contentType, mediaType] = entries[0] ?? [];

  const samples = collectSamples(mediaType);
  // A schema that is nothing but an example has no tree worth drawing.
  const hasSchema = !!mediaType?.schema && !isExampleOnlySchema(mediaType.schema);
  const [view, setView] = useState<'sample' | 'schema'>(samples.length ? 'sample' : 'schema');

  if (!entries.length) return null;

  return (
    <div>
      {body.description && (
        <p style={{ fontSize: 14, color: '#5f6b63', marginBottom: 12, marginTop: 0 }}>{body.description}</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <code style={{
          fontSize: 11, fontFamily: 'monospace', backgroundColor: '#f6f8fa',
          padding: '3px 9px', borderRadius: 5, border: '1px solid #e4e9e5', color: '#5f6b63',
        }}>
          {contentType}
        </code>
        {body.required && (
          <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700, backgroundColor: '#fee2e2', padding: '2px 6px', borderRadius: 4 }}>
            required
          </span>
        )}
        <div style={{ flex: 1 }} />
        {samples.length > 0 && hasSchema && (
          <ViewToggle value={view} onChange={setView} sampleCount={samples.length} />
        )}
      </div>

      {view === 'sample' && samples.length > 0 ? (
        <SamplePanel samples={samples} />
      ) : hasSchema && mediaType?.schema ? (
        <SchemaTree schema={mediaType.schema} spec={spec} />
      ) : samples.length > 0 ? (
        <SamplePanel samples={samples} />
      ) : (
        <p style={{ fontSize: 13, color: '#8a948d', fontStyle: 'italic' }}>No schema defined</p>
      )}
    </div>
  );
}
