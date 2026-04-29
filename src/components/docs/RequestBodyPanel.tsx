import type { RequestBody, OpenAPISpec } from '@/types/openapi';
import { SchemaTree } from './SchemaTree';

interface Props {
  body: RequestBody;
  spec: OpenAPISpec;
}

export function RequestBodyPanel({ body, spec }: Props) {
  const entries = Object.entries(body.content ?? {});
  if (!entries.length) return null;

  const [contentType, mediaType] = entries[0];

  return (
    <div>
      {body.description && (
        <p style={{ fontSize: 14, color: '#6b6860', marginBottom: 12, marginTop: 0 }}>{body.description}</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <code style={{
          fontSize: 11, fontFamily: 'monospace', backgroundColor: '#f6f8fa',
          padding: '3px 9px', borderRadius: 5, border: '1px solid #e8e6e0', color: '#6b6860',
        }}>
          {contentType}
        </code>
        {body.required && (
          <span style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700, backgroundColor: '#fee2e2', padding: '2px 6px', borderRadius: 4 }}>
            required
          </span>
        )}
      </div>
      {mediaType.schema ? (
        <SchemaTree schema={mediaType.schema} spec={spec} />
      ) : (
        <p style={{ fontSize: 13, color: '#9b9890', fontStyle: 'italic' }}>No schema defined</p>
      )}
    </div>
  );
}
