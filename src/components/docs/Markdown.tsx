import { Fragment } from 'react';

/**
 * Minimal inline markdown for spec prose.
 *
 * Every description in the spec is authored as markdown (`main.ts` and the
 * controller decorators both use `**bold**` and `` `code` ``), and Swagger UI
 * renders it as such — rendering it literally is what made this page look
 * unlike the real docs. Only the two inline forms actually used are handled;
 * nothing is parsed as HTML, so there is nothing to sanitise.
 */
const INLINE = /(\*\*[^*]+\*\*)|(`[^`]+`)/g;

function inline(text: string, keyPrefix: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(
        <strong key={`${keyPrefix}-${m.index}`} style={{ fontWeight: 700, color: '#1a1916' }}>
          {m[1].slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <code key={`${keyPrefix}-${m.index}`} style={{
          fontFamily: 'monospace', fontSize: '0.92em',
          backgroundColor: '#f4f3ef', border: '1px solid #eceae4',
          padding: '1px 5px', borderRadius: 4, color: '#1a5a4a',
        }}>
          {m[2].slice(1, -1)}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, style }: { text: string; style?: React.CSSProperties }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div style={style}>
      {paragraphs.map((para, i) => (
        <p key={i} style={{ margin: i === 0 ? '0 0 0.6em' : '0.6em 0', lineHeight: 'inherit' }}>
          {para.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(line, `${i}-${j}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
