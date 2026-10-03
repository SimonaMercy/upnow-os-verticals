/**
 * An email as its writer laid it out (tables, bold, pictures), made safe to look
 * at. It is somebody else's HTML: DOMPurify takes out anything that runs, submits
 * or opens a page, and the frame it is shown in (EmailLayoutFrame) runs no script
 * at all and loads nothing but pictures. Browser-only.
 */
import DOMPurify from 'dompurify';

/** Where the earlier emails quoted underneath begin, as each mail app marks them. */
const QUOTE_MARKERS = [
  '.upnow-forwarded', // a forward sent from the portal (email-layout.ts FORWARDED_CLASS)
  '#divRplyFwdMsg', '#appendonsend', // Outlook on the web and on phones
  'div.gmail_quote', 'blockquote.gmail_quote',
  'div.yahoo_quoted', 'div.moz-cite-prefix', 'blockquote[type="cite"]', // Yahoo, Thunderbird, Apple Mail
];

/** The frame's own look — the email's styles come after it and win. */
const BASE_STYLE = 'html{overflow-x:auto}body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#2b2a27;overflow-wrap:break-word}img{max-width:100%;height:auto}a{color:#1a7a5a}';
/** Nothing runs; pictures from https and from the email itself; fonts only from the email. */
const POLICY = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:";

export interface CleanLayout {
  /** The whole email, ready for the frame. */
  full: string;
  /** Without the earlier emails quoted underneath — null when nothing is quoted. */
  short: string | null;
}

/**
 * Outlook's "From: … Sent: …" block on Windows sits in a div with a thin top
 * border; the rest of the email after it is what was answered.
 */
function outlookHeader(body: HTMLElement): Element | null {
  for (const el of Array.from(body.querySelectorAll('div[style*="border-top"]'))) {
    const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
    if (/border-top:solid#(e1e1e1|b5c4df)/.test(style) && /\b(From|De|Von|من):/.test(el.textContent ?? '')) return el;
  }
  return null;
}

function quoteStart(body: HTMLElement): Element | null {
  const found = [...QUOTE_MARKERS.map((s) => body.querySelector(s)), outlookHeader(body)].filter((e): e is Element => !!e);
  if (!found.length) return null;
  // The first in reading order.
  let start = found.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a));
  // Outlook on the web draws a line just before its header — it goes with it.
  if (start.id === 'divRplyFwdMsg' && start.previousElementSibling?.tagName === 'HR') start = start.previousElementSibling;
  // A wrapper holding nothing but the marker goes with it.
  while (start.parentElement && start.parentElement !== body && start.parentElement.childElementCount === 1 && !(start.parentElement.textContent ?? '').replace(start.textContent ?? '', '').trim()) start = start.parentElement;
  // An email that is nothing but a forward: show it.
  const before = body.ownerDocument.createRange();
  before.setStart(body, 0);
  before.setEndBefore(start);
  const hasOwn = before.toString().replace(/\s| /g, '') !== '' || before.cloneContents().querySelector?.('img') != null;
  return hasOwn ? start : null;
}

/** Everything from `start` to the end of the email, gone. */
function cutFrom(start: Node, body: HTMLElement) {
  for (let node: Node | null = start; node && node !== body; node = node.parentNode) {
    while (node.nextSibling) node.parentNode!.removeChild(node.nextSibling);
  }
  start.parentNode?.removeChild(start);
}

function asDocument(head: string, body: HTMLElement): string {
  const attrs = ['dir', 'lang', 'style', 'bgcolor'].map((a) => (body.hasAttribute(a) ? ` ${a}="${(body.getAttribute(a) ?? '').replace(/"/g, '&quot;')}"` : '')).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><base target="_blank"><style>${BASE_STYLE}</style>${head}</head><body${attrs}>${body.innerHTML}</body></html>`;
}

export function cleanLayout(html: string): CleanLayout | null {
  // Outlook writes its styles inside <!-- --> — harmless in CSS, but the cleaner
  // throws away a style block that holds them, and with it every table border.
  const unwrapped = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, css: string, close: string) => open + css.replace(/<!--|-->/g, '') + close);
  const root = DOMPurify.sanitize(unwrapped, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'option', 'textarea', 'iframe', 'frame', 'frameset', 'object', 'embed', 'audio', 'video', 'source', 'track', 'link', 'meta', 'base', 'title', 'svg', 'math'],
    FORBID_ATTR: ['srcset', 'action', 'formaction', 'ping', 'background'],
    ALLOW_DATA_ATTR: false,
  }) as unknown as HTMLElement;
  const body = root.querySelector('body');
  if (!body) return null;
  // Links open in a new tab, telling the site nothing about where they came from.
  for (const a of Array.from(body.querySelectorAll('a[href]'))) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  if (!(body.textContent ?? '').replace(/\s| /g, '') && !body.querySelector('img')) return null;
  const head = Array.from(root.querySelectorAll('style')).filter((s) => !body.contains(s)).map((s) => s.outerHTML).join('');

  const full = asDocument(head, body);
  const start = quoteStart(body);
  if (!start) return { full, short: null };
  cutFrom(start, body);
  return { full, short: asDocument(head, body) };
}
