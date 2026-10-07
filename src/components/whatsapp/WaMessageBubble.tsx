'use client';

/**
 * One WhatsApp message, drawn the way the person operating the number expects
 * to see it: text with WhatsApp's own formatting, photos, videos, voice notes
 * (with their transcript), documents, locations, contact cards, stickers, calls,
 * replies, forwards, edits, deletions, reactions and delivery ticks.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle, Ban, Check, CheckCheck, Clock, Copy, Download, ExternalLink, FileText, Forward, Loader2, MapPin, Mic, Pause, Phone, Play, Reply, User, X,
} from 'lucide-react';
import { clock, fileSize, prettyPhone, waTime, whatsappApi, type Rp, type WaMessage } from '@/lib/whatsappApi';

// ─── Media links ─────────────────────────────────────────────────────────────
// A link is asked for once per message and kept for ten minutes (they are short-lived).
const urlCache = new Map<number, { at: number; p: Promise<string> }>();
function mediaLink(rp: Rp, id: number): Promise<string> {
  const hit = urlCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = whatsappApi.mediaUrl(rp, id).then((r) => r.url);
  urlCache.set(id, { at: Date.now(), p });
  p.catch(() => urlCache.delete(id));
  return p;
}

/** The file's link, asked for only once the message scrolls into view. */
function useMediaUrl(rp: Rp, id: number, wanted: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || url) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      mediaLink(rp, id).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [rp, id, wanted, url]);
  return { ref, url, failed };
}

async function download(rp: Rp, id: number) {
  try { const { url } = await whatsappApi.mediaUrl(rp, id, true); window.open(url, '_blank', 'noopener'); } catch { /* the link simply does not open */ }
}

// ─── Text ────────────────────────────────────────────────────────────────────
const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"]|www\.[^\s<]+[^\s<.,;:!?)\]}'"])|```([\s\S]+?)```|`([^`\n]+)`|(?<![\w*])\*(\S(?:[^*\n]*\S)?)\*(?![\w*])|(?<![\w_])_(\S(?:[^_\n]*\S)?)_(?![\w_])|(?<![\w~])~(\S(?:[^~\n]*\S)?)~(?![\w~])/g;

/** WhatsApp's own formatting — *bold*, _italic_, ~strike~, `code` — and links that open in a new tab. */
export function formatWa(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0; let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1]) out.push(<a key={k++} href={m[1].startsWith('http') ? m[1] : `https://${m[1]}`} target="_blank" rel="noopener noreferrer" className="text-[#1d6fb8] underline break-all">{m[1]}</a>);
    else if (m[2] != null) out.push(<code key={k++} className="block font-mono text-[12px] bg-black/5 rounded px-1.5 py-1 my-0.5 whitespace-pre-wrap">{m[2]}</code>);
    else if (m[3] != null) out.push(<code key={k++} className="font-mono text-[12px] bg-black/5 rounded px-1">{m[3]}</code>);
    else if (m[4] != null) out.push(<strong key={k++}>{m[4]}</strong>);
    else if (m[5] != null) out.push(<em key={k++}>{m[5]}</em>);
    else if (m[6] != null) out.push(<s key={k++}>{m[6]}</s>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
export interface LightboxItem { id: number; kind: 'image' | 'video'; url: string; caption: string; when: string }

export function WaLightbox({ item, rp, onClose }: { item: LightboxItem; rp: Rp; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] bg-black/85 flex flex-col" role="dialog" aria-modal="true" aria-label="Photo or video" onClick={onClose}>
      <div className="flex items-center gap-2 px-4 py-3 text-white/90 text-sm shrink-0" onClick={(e) => e.stopPropagation()}>
        <span className="flex-1 truncate">{item.when}</span>
        <button type="button" onClick={() => void download(rp, item.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"><Download size={14} /> Download</button>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 grid place-items-center px-4 pb-4">
        {item.kind === 'image'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.url} alt={item.caption || 'Photo'} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          : <video src={item.url} controls autoPlay playsInline className="max-w-full max-h-full rounded-lg bg-black" onClick={(e) => e.stopPropagation()} />}
      </div>
      {item.caption && <div className="px-6 pb-5 text-center text-sm text-white/90 whitespace-pre-wrap shrink-0" onClick={(e) => e.stopPropagation()}>{item.caption}</div>}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────
function Ticks({ m }: { m: WaMessage }) {
  if (m.direction !== 'out') return null;
  if (m.status === 'not_sent' || m.ack === -1) return <AlertCircle size={13} className="text-[#b42318]" aria-label="Not sent" />;
  if (m.status === 'sending' || m.ack === 0) return <Clock size={12} className="text-[#9b9890]" aria-label="Sending" />;
  // Older messages brought in from history carry no delivery state: they were sent.
  if (m.ack === 1 || m.ack == null) return <Check size={14} className="text-[#9b9890]" aria-label="Sent" />;
  if (m.ack === 2) return <CheckCheck size={14} className="text-[#9b9890]" aria-label="Delivered" />;
  return <CheckCheck size={14} className="text-[#2f9be0]" aria-label={m.ack === 4 ? 'Played' : 'Read'} />;
}

function MediaUnavailable({ m }: { m: WaMessage }) {
  const expired = m.media?.state === 'expired';
  return (
    <div className="flex items-center gap-2 text-xs text-[#6b6860] bg-black/[0.04] rounded-lg px-3 py-2.5 min-w-[200px]">
      {expired ? <Ban size={14} className="shrink-0" /> : <Loader2 size={14} className="shrink-0 animate-spin" />}
      <span>{expired ? 'This file is no longer on WhatsApp. Ask them to send it again.' : 'Still arriving from WhatsApp…'}</span>
    </div>
  );
}

function Photo({ m, rp, onOpen, sticker = false }: { m: WaMessage; rp: Rp; onOpen: (i: LightboxItem) => void; sticker?: boolean }) {
  const { ref, url, failed } = useMediaUrl(rp, m.id, !!m.media?.stored);
  if (!m.media?.stored) return <MediaUnavailable m={m} />;
  return (
    <div ref={ref} className={sticker ? 'w-[130px] h-[130px]' : 'w-[280px] max-w-full min-h-[120px] rounded-lg overflow-hidden bg-black/[0.04] grid place-items-center'}>
      {url ? (
        <button type="button" onClick={() => !sticker && onOpen({ id: m.id, kind: 'image', url, caption: m.body, when: `${new Date(m.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${waTime(m.sentAt)}` })}
          className={sticker ? 'cursor-default' : 'cursor-zoom-in block w-full'} aria-label={sticker ? 'Sticker' : 'Open photo'}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={m.body || (sticker ? 'Sticker' : 'Photo')} loading="lazy" className={sticker ? 'w-[130px] h-[130px] object-contain' : 'w-full max-h-[340px] object-cover'} />
        </button>
      ) : <span className="text-xs text-[#9b9890] py-10">{failed ? 'Could not load the photo' : 'Loading…'}</span>}
    </div>
  );
}

function VideoTile({ m, rp, onOpen }: { m: WaMessage; rp: Rp; onOpen: (i: LightboxItem) => void }) {
  const { ref, url, failed } = useMediaUrl(rp, m.id, !!m.media?.stored);
  if (!m.media?.stored) return <MediaUnavailable m={m} />;
  return (
    <div ref={ref} className="relative w-[280px] max-w-full min-h-[150px] rounded-lg overflow-hidden bg-black grid place-items-center">
      {url ? (
        <button type="button" aria-label="Play video" className="block w-full cursor-pointer"
          onClick={() => onOpen({ id: m.id, kind: 'video', url, caption: m.body, when: `${new Date(m.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${waTime(m.sentAt)}` })}>
          <video src={`${url}#t=0.1`} preload="metadata" muted playsInline className="w-full max-h-[340px] object-cover pointer-events-none" />
          <span className="absolute inset-0 grid place-items-center"><span className="w-12 h-12 rounded-full bg-black/55 grid place-items-center text-white"><Play size={20} className="ml-0.5" /></span></span>
          {m.durationSeconds ? <span className="absolute left-2 bottom-2 text-[11px] text-white bg-black/55 rounded px-1.5 py-0.5">{clock(m.durationSeconds)}</span> : null}
        </button>
      ) : <span className="text-xs text-white/70 py-12">{failed ? 'Could not load the video' : 'Loading…'}</span>}
    </div>
  );
}

const SPEEDS = [1, 1.5, 2];

/** Voice note or audio file: play, seek, change speed — and read it, when it has been transcribed. */
function VoiceNote({ m, rp }: { m: WaMessage; rp: Rp }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(m.durationSeconds ?? 0);
  const [speed, setSpeed] = useState(0);
  const [failed, setFailed] = useState(false);
  const voice = m.type === 'ptt';

  useEffect(() => () => { audio.current?.pause(); audio.current = null; }, []);

  const ensure = useCallback(async () => {
    if (audio.current) return audio.current;
    setLoading(true);
    try {
      const a = new Audio(await mediaLink(rp, m.id));
      a.preload = 'auto';
      a.addEventListener('timeupdate', () => setPos(a.currentTime));
      a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration) && a.duration > 0) setDur(a.duration); });
      a.addEventListener('ended', () => { setPlaying(false); setPos(0); });
      a.addEventListener('pause', () => setPlaying(false));
      a.addEventListener('play', () => setPlaying(true));
      a.addEventListener('error', () => { setFailed(true); setPlaying(false); });
      audio.current = a;
      return a;
    } finally { setLoading(false); }
  }, [rp, m.id]);

  const toggle = async () => {
    try {
      const a = await ensure();
      a.playbackRate = SPEEDS[speed];
      if (a.paused) await a.play(); else a.pause();
    } catch { setFailed(true); }
  };
  const seek = async (fraction: number) => {
    if (!dur) return;
    try { const a = await ensure(); a.currentTime = Math.min(Math.max(fraction, 0), 1) * dur; setPos(a.currentTime); } catch { /* nothing to seek */ }
  };
  const nextSpeed = () => { const n = (speed + 1) % SPEEDS.length; setSpeed(n); if (audio.current) audio.current.playbackRate = SPEEDS[n]; };

  if (!m.media?.stored) return <MediaUnavailable m={m} />;
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
  return (
    <div className="w-[290px] max-w-full">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => void toggle()} aria-label={playing ? 'Pause' : 'Play'} className="w-9 h-9 shrink-0 rounded-full bg-[#2e9f82] text-white grid place-items-center hover:bg-[#26856d] cursor-pointer">
          {loading ? <Loader2 size={16} className="animate-spin" /> : playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void seek((e.clientX - r.left) / r.width); }}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') void seek((pos + 5) / (dur || 1)); if (e.key === 'ArrowLeft') void seek((pos - 5) / (dur || 1)); }}
            className="h-5 flex items-center cursor-pointer group">
            <div className="h-1 w-full rounded-full bg-black/10 relative">
              <div className="absolute inset-y-0 left-0 rounded-full bg-[#2e9f82]" style={{ width: `${pct}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#2e9f82] shadow" style={{ left: `${pct}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#6b6860] tabular-nums">
            {voice ? <Mic size={11} className={m.ack === 4 ? 'text-[#2f9be0]' : ''} /> : null}
            <span>{clock(playing || pos > 0 ? pos : dur)}</span>
            {!voice && m.media.name ? <span className="truncate">· {m.media.name}</span> : null}
          </div>
        </div>
        <button type="button" onClick={nextSpeed} aria-label="Playback speed" className="shrink-0 text-[11px] font-semibold text-[#4a4842] bg-black/[0.06] hover:bg-black/10 rounded-full px-2 py-1 cursor-pointer tabular-nums">{SPEEDS[speed]}×</button>
      </div>
      {failed && <div className="mt-1.5 text-[11px] text-[#b42318]">This browser could not play it. <button type="button" onClick={() => void download(rp, m.id)} className="underline cursor-pointer">Download</button></div>}
      {voice && (
        <div className="mt-2 pt-2 border-t border-black/[0.07] text-[13px] leading-snug text-[#2b2a27]">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-0.5">Transcript</span>
          {m.transcript ? <span className="whitespace-pre-wrap break-words" dir="auto">{m.transcript}</span> : <span className="text-[#9b9890]">Being written out…</span>}
        </div>
      )}
    </div>
  );
}

function DocumentCard({ m, rp }: { m: WaMessage; rp: Rp }) {
  const name = m.media?.name || m.body || 'Document';
  const ext = (name.split('.').pop() ?? '').slice(0, 4).toUpperCase();
  const open = async () => { try { window.open(await mediaLink(rp, m.id), '_blank', 'noopener'); } catch { /* the link simply does not open */ } };
  if (!m.media?.stored) return (<div><div className="text-sm font-medium text-[#1a1916] mb-1.5 break-all">{name}</div><MediaUnavailable m={m} /></div>);
  return (
    <div className="flex items-center gap-3 w-[290px] max-w-full bg-black/[0.04] rounded-lg px-3 py-2.5">
      <div className="w-10 h-11 shrink-0 rounded-md bg-white border border-[#e8e6e0] grid place-items-center text-[#6b6860] relative">
        <FileText size={18} />
        {ext && ext.length <= 4 ? <span className="absolute -bottom-1.5 text-[8px] font-bold bg-[#1a1916] text-white rounded px-1">{ext}</span> : null}
      </div>
      <button type="button" onClick={() => void open()} className="flex-1 min-w-0 text-left cursor-pointer">
        <div className="text-sm font-medium text-[#1a1916] truncate" title={name}>{name}</div>
        <div className="text-[11px] text-[#6b6860]">{[fileSize(m.media.size), 'Open'].filter(Boolean).join(' · ')}</div>
      </button>
      <button type="button" onClick={() => void download(rp, m.id)} aria-label={`Download ${name}`} className="shrink-0 w-8 h-8 rounded-full border border-[#d9d6cf] grid place-items-center text-[#4a4842] hover:border-[#2e9f82] hover:text-[#1a7a5a] cursor-pointer"><Download size={14} /></button>
    </div>
  );
}

function LocationCard({ m }: { m: WaMessage }) {
  const l = m.location;
  if (!l) return null;
  const href = `https://www.google.com/maps?q=${l.lat},${l.lng}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 w-[280px] max-w-full bg-black/[0.04] hover:bg-black/[0.07] rounded-lg px-3 py-2.5">
      <span className="w-10 h-10 shrink-0 rounded-full bg-[#fdecea] text-[#c0392b] grid place-items-center"><MapPin size={18} /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[#1a1916] truncate">{l.name || 'Location'}</span>
        <span className="block text-[11px] text-[#6b6860] truncate">{l.address || `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`}</span>
      </span>
      <ExternalLink size={14} className="shrink-0 text-[#6b6860]" />
    </a>
  );
}

function parseVcard(v: string): { name: string; phones: string[] } {
  const name = (/^FN[^:]*:(.+)$/m.exec(v)?.[1] ?? /^N[^:]*:(.+)$/m.exec(v)?.[1] ?? 'Contact').replace(/;/g, ' ').trim();
  const phones = [...v.matchAll(/^TEL[^:]*:(.+)$/gm)].map((x) => x[1].trim());
  return { name, phones };
}

function ContactCards({ m }: { m: WaMessage }) {
  const cards = (m.vcards?.length ? m.vcards : m.body ? [m.body] : []).map(parseVcard);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (p: string) => { void navigator.clipboard?.writeText(p).then(() => { setCopied(p); window.setTimeout(() => setCopied(null), 1500); }); };
  return (
    <div className="space-y-1.5 w-[270px] max-w-full">
      {cards.map((c, i) => (
        <div key={i} className="flex items-center gap-3 bg-black/[0.04] rounded-lg px-3 py-2.5">
          <span className="w-9 h-9 shrink-0 rounded-full bg-[#e8e6e0] text-[#6b6860] grid place-items-center"><User size={16} /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-[#1a1916] truncate">{c.name}</span>
            {c.phones.map((p) => (
              <button key={p} type="button" onClick={() => copy(p)} className="block text-[11px] text-[#1d6fb8] hover:underline cursor-pointer tabular-nums" title="Copy the number">{copied === p ? 'Copied' : p}</button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Message kinds WhatsApp shows only on the phone — said plainly instead of an empty bubble. */
const PHONE_ONLY: Record<string, string> = {
  album: 'Album — the photos follow as separate messages',
  poll_creation: 'Poll', interactive: 'Message with buttons', buttons_response: 'Button reply', list: 'List message', list_response: 'List reply',
  template_button_reply: 'Button reply', order: 'Order', product: 'Product', payment: 'Payment', groups_v4_invite: 'Group invitation', ciphertext: 'Waiting for this message. Open WhatsApp on the phone.',
};

const AUTHOR_TONES = ['#1d6fb8', '#b8561d', '#7a3db8', '#1a7a5a', '#b81d5e', '#8a6d1d', '#2a7f8a'];
function authorTone(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AUTHOR_TONES[h % AUTHOR_TONES.length];
}

// ─── The bubble ──────────────────────────────────────────────────────────────
export function WaMessageBubble({ m, rp, isGroup, onReply, onOpenMedia, onJumpTo, onRetry }: {
  m: WaMessage;
  rp: Rp;
  isGroup: boolean;
  onReply: (m: WaMessage) => void;
  onOpenMedia: (i: LightboxItem) => void;
  onJumpTo: (id: number) => void;
  onRetry?: (m: WaMessage) => void;
}) {
  const out = m.direction === 'out';
  const [copied, setCopied] = useState(false);

  if (m.type === 'call_log') {
    return (
      <div id={`wa-msg-${m.id}`} className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6b6860] bg-white border border-[#e8e6e0] rounded-full px-3 py-1">
          <Phone size={11} /> {out ? 'Outgoing' : 'Incoming'} WhatsApp call{m.body ? ` · ${m.body}` : ''} · {waTime(m.sentAt)}
        </span>
      </div>
    );
  }

  const sticker = m.type === 'sticker' && !m.isRevoked;
  const copyText = m.type === 'ptt' ? (m.transcript ?? '') : m.body;
  const copy = () => { if (!copyText) return; void navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); };

  let content: ReactNode;
  if (m.isRevoked) {
    content = <span className="inline-flex items-center gap-1.5 text-sm italic text-[#9b9890]"><Ban size={13} /> This message was deleted</span>;
  } else {
    const caption = m.body && !['vcard', 'multi_vcard'].includes(m.type) && !(m.type === 'document' && m.body === m.media?.name)
      ? <div className="text-sm text-[#1a1916] whitespace-pre-wrap break-words leading-relaxed mt-1.5" dir="auto">{formatWa(m.body)}</div> : null;
    switch (m.type) {
      case 'image': content = <><Photo m={m} rp={rp} onOpen={onOpenMedia} />{caption}</>; break;
      case 'sticker': content = <Photo m={m} rp={rp} onOpen={onOpenMedia} sticker />; break;
      case 'video': content = <><VideoTile m={m} rp={rp} onOpen={onOpenMedia} />{caption}</>; break;
      case 'ptt': case 'audio': content = <VoiceNote m={m} rp={rp} />; break;
      case 'document': content = <><DocumentCard m={m} rp={rp} />{caption}</>; break;
      case 'location': content = <><LocationCard m={m} />{caption}</>; break;
      case 'vcard': case 'multi_vcard': content = <ContactCards m={m} />; break;
      default:
        content = m.body
          ? <div className="text-sm text-[#1a1916] whitespace-pre-wrap break-words leading-relaxed" dir="auto">{formatWa(m.body)}</div>
          : <span className="text-sm italic text-[#6b6860]">{PHONE_ONLY[m.type] ?? 'This kind of message shows on the phone only.'}</span>;
        if (m.body && PHONE_ONLY[m.type]) content = <><span className="block text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-0.5">{PHONE_ONLY[m.type]}</span>{content}</>;
    }
  }

  const actions = m.isRevoked ? null : (
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity mb-1">
        <button type="button" onClick={() => onReply(m)} aria-label="Reply" title="Reply" className="w-7 h-7 rounded-full grid place-items-center text-[#6b6860] hover:bg-white hover:text-[#1a7a5a] cursor-pointer"><Reply size={14} /></button>
        {copyText ? <button type="button" onClick={copy} aria-label="Copy text" title={copied ? 'Copied' : 'Copy text'} className="w-7 h-7 rounded-full grid place-items-center text-[#6b6860] hover:bg-white hover:text-[#1a7a5a] cursor-pointer">{copied ? <Check size={14} /> : <Copy size={14} />}</button> : null}
        {m.media?.stored ? <button type="button" onClick={() => void download(rp, m.id)} aria-label="Download" title="Download" className="w-7 h-7 rounded-full grid place-items-center text-[#6b6860] hover:bg-white hover:text-[#1a7a5a] cursor-pointer"><Download size={14} /></button> : null}
      </div>
  );

  const who = out ? m.sentByName : isGroup ? (m.authorName || prettyPhone(m.authorPhone)) : null;
  // A reply typed on the phone or on a computer's WhatsApp reaches the portal with no person behind it.
  const outside = out && !m.sentByName ? (m.typedOn === 'phone' ? 'Typed on the phone — nobody named' : m.typedOn === 'computer' ? 'Typed on a computer, not the portal — nobody named' : null) : null;
  return (
    <div id={`wa-msg-${m.id}`} className={`group flex items-end gap-1.5 ${out ? 'justify-end' : 'justify-start'} scroll-mt-24`}>
      {out && actions}
      <div className={`relative max-w-[min(78%,560px)] ${sticker ? '' : `rounded-2xl px-3 py-2 shadow-[0_1px_0.5px_rgba(0,0,0,0.08)] ${out ? 'bg-[#dff3ea] rounded-br-md' : 'bg-white rounded-bl-md'}`} ${m.reactions?.length ? 'mb-3' : ''}`}>
        {who && !out && <div className="text-xs font-semibold mb-0.5 truncate" style={{ color: authorTone(m.authorPhone || who) }}>{who}</div>}
        {m.isForwarded && !m.isRevoked && <div className="flex items-center gap-1 text-[11px] italic text-[#9b9890] mb-0.5"><Forward size={11} /> Forwarded</div>}
        {m.quotedSnippet && !m.isRevoked && (
          <button type="button" onClick={() => m.quotedId && onJumpTo(m.quotedId)} className={`block w-full text-left mb-1.5 rounded-lg border-l-[3px] border-[#2e9f82] bg-black/[0.05] px-2.5 py-1.5 ${m.quotedId ? 'cursor-pointer hover:bg-black/[0.08]' : 'cursor-default'}`}>
            <span className="block text-xs text-[#4a4842] line-clamp-2 break-words">{m.quotedSnippet}</span>
          </button>
        )}
        {content}
        <div className={`flex items-center justify-end gap-1 mt-1 text-[10.5px] text-[#9b9890] tabular-nums ${sticker ? 'bg-white/80 rounded-full px-1.5 w-fit ml-auto' : ''}`}>
          {out && who ? <span className="mr-auto pr-3 truncate max-w-[180px]">{who}{m.sentByRole === 'manager' ? ' · manager' : ''}</span>
            : outside ? <span className="mr-auto pr-3 truncate max-w-[300px] italic" title={outside}>{outside}</span> : null}
          {m.editedAt && !m.isRevoked ? <span>Edited</span> : null}
          <span>{waTime(m.sentAt)}</span>
          <Ticks m={m} />
        </div>
        {(m.status === 'not_sent' || m.ack === -1) && (
          <div className="mt-1.5 text-xs text-[#b42318] flex flex-wrap items-center gap-x-2">
            <span>Not sent{m.error ? ` — ${m.error}` : ''}</span>
            {onRetry && m.type === 'chat' && <button type="button" onClick={() => onRetry(m)} className="font-semibold underline cursor-pointer">Try again</button>}
          </div>
        )}
        {m.reactions?.length ? (
          <div className={`absolute -bottom-3.5 ${out ? 'right-2' : 'left-2'} flex items-center gap-0.5 bg-white border border-[#e8e6e0] rounded-full px-1.5 py-0.5 text-xs shadow-sm`}>
            {m.reactions.map((r) => <span key={r.emoji} title={r.mine ? 'Includes yours' : undefined}>{r.emoji}{r.count > 1 ? <span className="text-[10px] text-[#6b6860] ml-0.5">{r.count}</span> : null}</span>)}
          </div>
        ) : null}
      </div>
      {!out && actions}
    </div>
  );

}
