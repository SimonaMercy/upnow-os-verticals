/**
 * Reading an email as a person wrote it. Bodies are plain text made from a mail
 * app's HTML, and carry its debris: a line holding only a non-breaking space
 * between every paragraph, `[cid:image001.png@…]` where a logo was, every link
 * printed twice (`text [https://…]`), `<mailto:…>` after every address. None of
 * it is what anyone wrote. Pure functions — no I/O.
 */

/** Tidy the text without changing a word of it. */
export function tidyEmailText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\[cid:[^\]\n]{1,200}\]/gi, '')
    .replace(/<mailto:[^>\n]{1,254}>/gi, '')
    // "https://x [https://x]" and "Word [https://tracking…]" — keep the first, drop the bracketed twin.
    .replace(/(https?:\/\/\S+)\s*\[\1\]/gi, '$1')
    .replace(/\[(https?:\/\/[^\]\s]{1,2000})\]/gi, (m, url: string) => (/\.(png|jpe?g|gif|svg)(\?|$)/i.test(url) || /mail-sig|googleusercontent|gstatic|emailer\/|\/images?\//i.test(url) ? '' : m))
    .replace(/[ \t ]+$/gm, '')
    .replace(/(\n[ \t ]*){3,}/g, '\n\n')
    .trim();
}

const QUOTE_START = [
  /^On .{6,200}wrote:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{2,}\s*Forwarded message\s*-{2,}/i,
  /^_{10,}\s*$/,
];

/** Where the writer stops and the politeness, the job title and the legal notice begin. */
const SIGN_OFF = /^(thanks?( (and|&) (warm |best |kind )?regards)?|thank you|(best|kind|warm|with)( best| kind| warm)? regards|regards|sincerely|yours (truly|sincerely|faithfully)|cheers|br)[\s,.!]*$/i;
const NOTICE = /^(disclaimer|confidentiality notice|this (e-?mail|message)( and any| \(including| is| contains| may))/i;

export interface EmailBodyParts {
  /** What they wrote. */
  main: string;
  /** Sign-off block, contact card, legal notice — folded away, one click to see. */
  signature: string;
  /** The earlier emails quoted underneath. */
  quoted: string;
}

export function splitEmailBody(raw: string): EmailBodyParts {
  const lines = tidyEmailText(raw).split('\n');
  let quoteAt = lines.findIndex((l, i) => {
    const t = l.trim();
    return QUOTE_START.some((re) => re.test(t))
      || (/^From:\s.+/.test(t) && lines.slice(i + 1, i + 4).some((x) => /^(Sent|Date):\s/.test(x.trim())))
      || (l.startsWith('>') && lines.slice(i).every((x) => x.startsWith('>') || !x.trim()));
  });
  if (quoteAt === 0) quoteAt = -1; // an email that is nothing but a forward: show it
  const own = quoteAt > 0 ? lines.slice(0, quoteAt) : lines;
  const quoted = quoteAt > 0 ? lines.slice(quoteAt).join('\n').trim() : '';

  // The sign-off stays with the text (it is how they ended it), and so does the
  // name under it; the card after that folds. Only in the last part of the email —
  // "Thanks" on line two of a long email is not a signature.
  let sigAt = -1;
  for (let i = Math.max(1, own.length - 40); i < own.length; i++) {
    const t = own[i].trim();
    if (NOTICE.test(t)) { sigAt = i; break; }
    if (SIGN_OFF.test(t)) {
      let j = i + 1;
      while (j < own.length && !own[j].trim()) j++;
      const after = j + 1; // the name line
      if (own.slice(after).some((x) => x.trim())) sigAt = after;
      break;
    }
  }
  const main = (sigAt > 0 ? own.slice(0, sigAt) : own).join('\n').trim();
  const signature = sigAt > 0 ? own.slice(sigAt).join('\n').trim() : '';
  return { main, signature, quoted };
}

/** A list preview without the mail app's debris: "DEWA Email [https://…/image.png] Dear…" → "DEWA Email Dear…". */
export function tidySnippet(snippet: string | null | undefined): string {
  return (snippet ?? '').replace(/\[cid:[^\]]*\]?/gi, '').replace(/\[?https?:\/\/\S*\]?/gi, '').replace(/<mailto:[^>]*>?/gi, '').replace(/\s+/g, ' ').trim();
}

/** The first thing they actually said — for a collapsed email's one line. */
export function firstWords(raw: string, max = 140): string {
  const { main } = splitEmailBody(raw);
  const line = main.split('\n').map((l) => l.trim()).filter((l) => l && !/^(dear|hi|hello|good (morning|afternoon|evening)|greetings)\b.{0,60}$/i.test(l));
  return (line.join(' ') || main).replace(/\s+/g, ' ').slice(0, max);
}

/** "AE" for a company, "MA" for Mohammed Azhar, "" for a bare address. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !/^(l\.?l\.?c|llc|fz(e|co)?|co|ltd|the|mr|mrs|ms|dr|m\/s)$/i.test(w));
  // A bare address or a phone number has no initials — the person icon stands in.
  if (!words.length || (name ?? '').includes('@') || !/\p{L}/u.test(words[0])) return '';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

/** A conversation is titled by what it is about, not by how many times it was answered. */
export function bareSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd)\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s || subject;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}
