import type { Parameter, OpenAPISpec } from '@/types/openapi';
import { resolveSchema } from './SchemaTree';

const IN_STYLES: Record<string, { bg: string; text: string }> = {
  path:   { bg: '#fef3c7', text: '#b45309' },
  query:  { bg: '#dbeafe', text: '#1d4ed8' },
  header: { bg: '#ede9fe', text: '#7c3aed' },
  cookie: { bg: '#fce7f3', text: '#be185d' },
};

interface Props {
  parameters: Parameter[];
  spec: OpenAPISpec;
}

export function ParamTable({ parameters, spec }: Props) {
  if (!parameters.length) return null;

  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e8e6e0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ backgroundColor: '#f6f8fa' }}>
            {['Name', 'Location', 'Type', 'Required', 'Description'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '8px 14px',
                borderBottom: '1px solid #e8e6e0',
                fontSize: 11, fontWeight: 700, color: '#6b6860',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parameters.map((p, i) => {
            const inStyle = IN_STYLES[p.in] ?? { bg: '#f6f8fa', text: '#6b6860' };
            // A `$ref`'d parameter schema (an enum query param, typically) has no
            // `type` of its own — resolve it so the column is not a dash.
            const schema = p.schema ? resolveSchema(p.schema, spec) : undefined;
            const type = schema?.enum
              ? 'enum'
              : schema?.type ?? (schema?.items ? 'array' : '—');
            const format = schema?.format;
            const isLast = i === parameters.length - 1;

            return (
              <tr key={i} style={{ borderBottom: isLast ? 'none' : '1px solid #f4f3ef' }}>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#1a1916', whiteSpace: 'nowrap' }}>
                  {p.name}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    backgroundColor: inStyle.bg, color: inStyle.text,
                    fontSize: 10, fontWeight: 700, padding: '2px 7px',
                    borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {p.in}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#7c3aed', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {type}{format ? `<${format}>` : ''}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {p.required
                    ? <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: 12 }}>Yes</span>
                    : <span style={{ color: '#9b9890', fontSize: 12 }}>No</span>}
                </td>
                <td style={{ padding: '10px 14px', color: '#6b6860', maxWidth: 320 }}>
                  <span>{p.description ?? <span style={{ color: '#c4c2bc', fontStyle: 'italic' }}>—</span>}</span>
                  {schema?.enum && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#6b6860' }}>
                      {schema.enum.map(v => (
                        <code key={String(v)} style={{ backgroundColor: '#f4f3ef', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>
                          {JSON.stringify(v)}
                        </code>
                      ))}
                    </div>
                  )}
                  {p.example !== undefined && (
                    <div style={{ marginTop: 3, fontSize: 11, color: '#9b9890' }}>
                      e.g.{' '}
                      <code style={{ backgroundColor: '#f4f3ef', padding: '1px 5px', borderRadius: 3 }}>
                        {JSON.stringify(p.example)}
                      </code>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
