'use client';

/** Sample ⇄ Schema switch, shown only when an operation has both to show. */
export function ViewToggle({
  value,
  onChange,
  sampleCount,
}: {
  value: 'sample' | 'schema';
  onChange: (v: 'sample' | 'schema') => void;
  sampleCount?: number;
}) {
  const options: Array<{ id: 'sample' | 'schema'; label: string }> = [
    { id: 'sample', label: sampleCount && sampleCount > 1 ? `Samples (${sampleCount})` : 'Sample' },
    { id: 'schema', label: 'Schema' },
  ];

  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid #e4e9e5',
      borderRadius: 7,
      overflow: 'hidden',
      backgroundColor: '#ffffff',
    }}>
      {options.map(o => {
        const isActive = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: '4px 11px',
              border: 'none',
              backgroundColor: isActive ? '#eef7f2' : 'transparent',
              color: isActive ? '#0f4f36' : '#8a948d',
              fontWeight: isActive ? 700 : 500,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
