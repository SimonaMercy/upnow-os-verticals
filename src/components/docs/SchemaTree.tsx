'use client';

import { useState } from 'react';
import type { SchemaObject, OpenAPISpec } from '@/types/openapi';

export function resolveRef(ref: string, spec: OpenAPISpec): SchemaObject | null {
  // handles "#/components/schemas/Foo"
  const parts = ref.replace(/^#\//, '').split('/');
  let obj: unknown = spec;
  for (const part of parts) {
    if (typeof obj !== 'object' || obj === null) return null;
    obj = (obj as Record<string, unknown>)[part];
  }
  return (obj as SchemaObject) ?? null;
}

export function resolveSchema(schema: SchemaObject, spec: OpenAPISpec): SchemaObject {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    if (resolved) return resolveSchema(resolved, spec);
  }
  if (schema.allOf?.length) {
    const merged: SchemaObject = { type: 'object', properties: {}, required: [] };
    for (const sub of schema.allOf) {
      const res = resolveSchema(sub, spec);
      Object.assign(merged.properties!, res.properties ?? {});
      if (res.required) merged.required = [...(merged.required ?? []), ...res.required];
    }
    return merged;
  }
  return schema;
}

function typeLabel(schema: SchemaObject, spec: OpenAPISpec): string {
  if (schema.$ref) return schema.$ref.split('/').pop() ?? 'object';
  const r = resolveSchema(schema, spec);
  if (r.enum) return r.enum.map(v => JSON.stringify(v)).join(' | ');
  if (r.type === 'array' && r.items) {
    const item = resolveSchema(r.items, spec);
    const itemName = r.items.$ref ? r.items.$ref.split('/').pop() : (item.type ?? 'object');
    return `${itemName}[]`;
  }
  let t = r.type ?? 'any';
  if (r.format) t += `<${r.format}>`;
  return t;
}

interface PropertyRowProps {
  name: string;
  schema: SchemaObject;
  spec: OpenAPISpec;
  required: boolean;
  depth: number;
}

function PropertyRow({ name, schema, spec, required, depth }: PropertyRowProps) {
  const resolved = resolveSchema(schema, spec);
  const hasObjChildren = resolved.type === 'object' && resolved.properties;
  const isArray = resolved.type === 'array';
  const arrayItem = isArray && resolved.items ? resolveSchema(resolved.items, spec) : null;
  const hasArrayChildren = !!(arrayItem?.type === 'object' && arrayItem?.properties);
  const canExpand = hasObjChildren || hasArrayChildren;

  const [expanded, setExpanded] = useState(depth < 1);

  return (
    <div>
      <div
        onClick={() => canExpand && setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          paddingBlock: 8,
          paddingInlineStart: 16 + depth * 20,
          paddingInlineEnd: 16,
          borderBottom: '1px solid #eef1ef',
          cursor: canExpand ? 'pointer' : 'default',
          backgroundColor: depth % 2 === 1 ? '#fdfcfb' : 'transparent',
        }}
      >
        <span style={{ fontSize: 10, marginTop: 4, color: '#8a948d', width: 10, flexShrink: 0 }}>
          {canExpand ? (expanded ? '▾' : '▸') : ''}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#14201a' }}>
              {name}
            </span>
            {required && (
              <span style={{ fontSize: 10, color: '#b91c1c', fontWeight: 700, backgroundColor: '#fee2e2', padding: '1px 5px', borderRadius: 3 }}>
                required
              </span>
            )}
            {resolved.readOnly && (
              <span style={{ fontSize: 10, color: '#5f6b63', fontStyle: 'italic' }}>read-only</span>
            )}
            {resolved.deprecated && (
              <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600, backgroundColor: '#fef3c7', padding: '1px 5px', borderRadius: 3 }}>
                deprecated
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#7c3aed', fontWeight: 500 }}>
              {typeLabel(schema, spec)}
            </span>
            {resolved.description && (
              <span style={{ fontSize: 12, color: '#5f6b63' }}>{resolved.description}</span>
            )}
          </div>
          {resolved.enum && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#5f6b63' }}>
              Enum: {resolved.enum.map(v => (
                <code key={String(v)} style={{ backgroundColor: '#eef1ef', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>
                  {JSON.stringify(v)}
                </code>
              ))}
            </div>
          )}
          {resolved.example !== undefined && (
            <div style={{ marginTop: 3, fontSize: 11, color: '#8a948d' }}>
              Example:{' '}
              <code style={{ backgroundColor: '#eef1ef', padding: '1px 4px', borderRadius: 3 }}>
                {JSON.stringify(resolved.example)}
              </code>
            </div>
          )}
        </div>
      </div>

      {expanded && hasObjChildren && resolved.properties && (
        <div style={{ borderLeft: '2px solid #e4e9e5', marginInlineStart: 16 + depth * 20 + 18 }}>
          {Object.entries(resolved.properties).map(([k, v]) => (
            <PropertyRow key={k} name={k} schema={v} spec={spec}
              required={resolved.required?.includes(k) ?? false} depth={depth + 1} />
          ))}
        </div>
      )}

      {expanded && hasArrayChildren && arrayItem?.properties && (
        <div style={{ borderLeft: '2px solid #e4e9e5', marginInlineStart: 16 + depth * 20 + 18 }}>
          {Object.entries(arrayItem.properties).map(([k, v]) => (
            <PropertyRow key={k} name={k} schema={v} spec={spec}
              required={arrayItem.required?.includes(k) ?? false} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  schema: SchemaObject;
  spec: OpenAPISpec;
}

export function SchemaTree({ schema, spec }: Props) {
  const resolved = resolveSchema(schema, spec);

  // Primitive or simple array
  if (!resolved.properties && resolved.type !== 'object') {
    return (
      <div style={{
        padding: '10px 14px', backgroundColor: '#f6f8fa', borderRadius: 8,
        fontFamily: 'monospace', fontSize: 13, color: '#7c3aed',
        border: '1px solid #e4e9e5',
      }}>
        {typeLabel(schema, spec)}
        {resolved.description && (
          <span style={{ color: '#5f6b63', fontFamily: 'inherit', marginInlineStart: 8 }}>
            — {resolved.description}
          </span>
        )}
      </div>
    );
  }

  // Array of objects
  if (resolved.type === 'array' && resolved.items) {
    const itemResolved = resolveSchema(resolved.items, spec);
    if (!itemResolved.properties) {
      return (
        <div style={{ padding: '10px 14px', backgroundColor: '#f6f8fa', borderRadius: 8, fontFamily: 'monospace', fontSize: 13, color: '#7c3aed', border: '1px solid #e4e9e5' }}>
          {typeLabel(schema, spec)}
        </div>
      );
    }
    return (
      <div style={{ border: '1px solid #e4e9e5', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', backgroundColor: '#f6f8fa', borderBottom: '1px solid #e4e9e5', fontSize: 11, fontWeight: 700, color: '#5f6b63', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', gap: 8, alignItems: 'center' }}>
          Array items
          <span style={{ fontFamily: 'monospace', color: '#7c3aed', textTransform: 'none', fontWeight: 400 }}>
            {typeLabel(resolved.items, spec)}
          </span>
        </div>
        {Object.entries(itemResolved.properties).map(([k, v]) => (
          <PropertyRow key={k} name={k} schema={v} spec={spec}
            required={itemResolved.required?.includes(k) ?? false} depth={0} />
        ))}
      </div>
    );
  }

  // Object
  return (
    <div style={{ border: '1px solid #e4e9e5', borderRadius: 10, overflow: 'hidden' }}>
      {resolved.properties && Object.entries(resolved.properties).map(([k, v]) => (
        <PropertyRow key={k} name={k} schema={v} spec={spec}
          required={resolved.required?.includes(k) ?? false} depth={0} />
      ))}
      {!resolved.properties && (
        <div style={{ padding: '12px 16px', color: '#8a948d', fontSize: 13, fontStyle: 'italic' }}>
          Empty object
        </div>
      )}
    </div>
  );
}
