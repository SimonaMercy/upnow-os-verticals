import type { HttpMethod } from '@/types/openapi';

const METHOD_STYLES: Record<string, { bg: string; text: string }> = {
  get:     { bg: '#dbeafe', text: '#1d4ed8' },
  post:    { bg: '#dcfce7', text: '#15803d' },
  put:     { bg: '#fef3c7', text: '#b45309' },
  patch:   { bg: '#ede9fe', text: '#7c3aed' },
  delete:  { bg: '#fee2e2', text: '#b91c1c' },
  head:    { bg: '#f1f5f9', text: '#475569' },
  options: { bg: '#f1f5f9', text: '#475569' },
};

interface Props {
  method: HttpMethod;
  size?: 'sm' | 'md' | 'lg';
}

export function MethodBadge({ method, size = 'md' }: Props) {
  const style = METHOD_STYLES[method] ?? { bg: '#f1f5f9', text: '#475569' };
  const fontSize = size === 'sm' ? 10 : size === 'lg' ? 13 : 11;
  const padding = size === 'sm' ? '2px 5px' : size === 'lg' ? '5px 10px' : '3px 7px';
  const minWidth = size === 'lg' ? 68 : size === 'sm' ? 40 : 52;

  return (
    <span
      style={{
        backgroundColor: style.bg,
        color: style.text,
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.06em',
        padding,
        borderRadius: 5,
        fontFamily: 'monospace',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        display: 'inline-block',
        minWidth,
        textAlign: 'center',
      }}
    >
      {method.toUpperCase()}
    </span>
  );
}
