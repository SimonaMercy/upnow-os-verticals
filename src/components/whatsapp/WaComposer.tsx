'use client';

/**
 * The reply box of a WhatsApp conversation: text (Enter sends, Shift+Enter is a
 * new line), emoji, photos and videos, documents, pasted screenshots, and a
 * voice note recorded right here in the browser.
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Mic, Paperclip, Send, Smile, Trash2, X } from 'lucide-react';
import { clock, fileSize, type WaMessage } from '@/lib/whatsappApi';

const EMOJI: Array<{ label: string; set: string[] }> = [
  { label: 'Often used', set: ['👍', '🙏', '😊', '😂', '❤️', '👌', '✅', '🤝', '👏', '🙂', '😅', '🎉', '💯', '🔑', '🏠', '📄', '📞', '⏰', '📍', '💰'] },
  { label: 'Faces', set: ['😀', '😃', '😄', '😁', '😆', '🥲', '😉', '😍', '😘', '🤗', '🤔', '😐', '😴', '😕', '😟', '😢', '😭', '😤', '😡', '🤒', '😎', '🥳', '😇', '🙄', '😬'] },
  { label: 'Hands', set: ['👋', '🤚', '✋', '👆', '👇', '👉', '👈', '✌️', '🤞', '👊', '✊', '💪', '🙌', '🤲', '✍️'] },
  { label: 'Work', set: ['🏢', '🏗️', '🛠️', '🔧', '🚿', '💡', '❄️', '🚪', '🛏️', '🧹', '🚗', '🅿️', '📦', '🧾', '💳', '🏦', '📅', '📎', '📷', '⚠️', '❌', '❗', '❓', '⭐', '🔔'] },
];

export interface PendingFile { file: File; asDocument: boolean; preview: string | null }

export function toPending(files: File[], asDocument = false): PendingFile[] {
  return files.map((file) => {
    const visual = !asDocument && (file.type.startsWith('image/') || file.type.startsWith('video/'));
    return { file, asDocument: !visual, preview: visual && file.type.startsWith('image/') ? URL.createObjectURL(file) : null };
  });
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

export function WaComposer({ disabledReason, replyTo, onCancelReply, pending, onPendingChange, busy, onSendText, onSendFiles, onSendVoice }: {
  /** Set when nothing can be sent (the number is not connected) — said in the box itself. */
  disabledReason: string | null;
  replyTo: WaMessage | null;
  onCancelReply: () => void;
  pending: PendingFile[];
  onPendingChange: (next: PendingFile[]) => void;
  busy: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onSendFiles: (files: PendingFile[], caption: string) => Promise<void> | void;
  onSendVoice: (blob: Blob, seconds: number, fileName: string) => Promise<void> | void;
}) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; keep: boolean } | null>(null);

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - (rec.current?.startedAt ?? Date.now())) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [recording]);

  // Leaving the conversation mid-recording releases the microphone.
  useEffect(() => () => { const r = rec.current; if (r) { r.keep = false; try { r.recorder.stop(); } catch { /* already stopped */ } r.stream.getTracks().forEach((t) => t.stop()); } }, []);

  const addFiles = (list: FileList | File[] | null, asDocument = false) => {
    if (!list) return;
    const files = Array.from(list);
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > 64 * 1024 * 1024);
    if (tooBig) { setError(`${tooBig.name} is larger than 64 MB`); return; }
    setError(null);
    onPendingChange([...pending, ...toPending(files, asDocument)].slice(0, 10));
  };
  const removePending = (i: number) => {
    const p = pending[i];
    if (p?.preview) URL.revokeObjectURL(p.preview);
    onPendingChange(pending.filter((_, n) => n !== i));
  };

  const insertEmoji = (e: string) => {
    const el = area.current;
    const at = el ? el.selectionStart ?? text.length : text.length;
    const end = el ? el.selectionEnd ?? at : at;
    setText(text.slice(0, at) + e + text.slice(end));
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); });
  };

  const send = async () => {
    if (busy) return;
    const body = text.trim();
    if (pending.length) { setText(''); await onSendFiles(pending, body); return; }
    if (!body) return;
    setText('');
    await onSendText(body);
  };

  const startRecording = async () => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setError('This browser cannot record a voice note. Attach an audio file instead.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const state = { recorder, stream, chunks: [] as Blob[], startedAt: Date.now(), keep: false };
      recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const took = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
        rec.current = null; setRecording(false); setSeconds(0);
        if (!state.keep || !state.chunks.length) return;
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        void onSendVoice(new Blob(state.chunks, { type }), took, `voice-note.${ext}`);
      };
      rec.current = state;
      recorder.start(500);
      setRecording(true);
    } catch {
      setError('The microphone is blocked. Allow it for this site in the browser’s address bar, then try again.');
    }
  };
  const stopRecording = (keep: boolean) => { const r = rec.current; if (!r) return; r.keep = keep; try { r.recorder.stop(); } catch { /* already stopped */ } };

  if (disabledReason) {
    return <div className="border-t border-[#e4e9e5] bg-white px-5 py-3.5 text-sm text-[#8a6d1d] shrink-0">{disabledReason}</div>;
  }

  const canSend = (text.trim().length > 0 || pending.length > 0) && !busy;
  return (
    <div className="border-t border-[#e4e9e5] bg-white shrink-0 relative">
      {replyTo && (
        <div className="flex items-start gap-2 px-4 pt-3">
          <div className="flex-1 min-w-0 rounded-lg border-l-[3px] border-[#047246] bg-[#eef1ef] px-3 py-1.5">
            <div className="text-[11px] font-semibold text-[#1a7a5a]">Replying to {replyTo.direction === 'out' ? 'your message' : (replyTo.authorName || 'their message')}</div>
            <div className="text-xs text-[#4a4842] truncate">{replyTo.body || replyTo.transcript || replyTo.media?.name || replyTo.type}</div>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="p-1.5 rounded-full text-[#5f6b63] hover:bg-[#eef1ef] cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex gap-2 px-4 pt-3 overflow-x-auto">
          {pending.map((p, i) => (
            <div key={`${p.file.name}-${i}`} className="relative shrink-0 w-[92px]">
              <div className="w-[92px] h-[92px] rounded-lg border border-[#e4e9e5] bg-[#eef1ef] overflow-hidden grid place-items-center text-[#5f6b63]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.preview ? <img src={p.preview} alt={p.file.name} className="w-full h-full object-cover" /> : p.file.type.startsWith('video/') ? <ImageIcon size={22} /> : <FileText size={22} />}
              </div>
              <div className="text-[10px] text-[#5f6b63] truncate mt-0.5" title={p.file.name}>{p.file.name}</div>
              <div className="text-[10px] text-[#8a948d]">{fileSize(p.file.size)}{p.asDocument ? ' · document' : ''}</div>
              <button type="button" onClick={() => removePending(i)} aria-label={`Remove ${p.file.name}`} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#14201a] text-white grid place-items-center cursor-pointer"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {emojiOpen && (
        <div className="absolute bottom-full left-3 mb-2 w-[320px] max-w-[calc(100vw-48px)] max-h-[280px] overflow-y-auto bg-white border border-[#e4e9e5] rounded-xl shadow-lg p-3 z-20">
          {EMOJI.map((g) => (
            <div key={g.label} className="mb-2 last:mb-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a948d] mb-1">{g.label}</div>
              <div className="grid grid-cols-10 gap-0.5">
                {g.set.map((e) => <button key={e} type="button" onClick={() => insertEmoji(e)} className="h-7 rounded hover:bg-[#eef1ef] text-lg leading-none cursor-pointer">{e}</button>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {attachOpen && (
        <div className="absolute bottom-full left-12 mb-2 w-[210px] bg-white border border-[#e4e9e5] rounded-xl shadow-lg py-1.5 z-20">
          <button type="button" onClick={() => { setAttachOpen(false); mediaInput.current?.click(); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#2b2a27] hover:bg-[#eef1ef] cursor-pointer"><ImageIcon size={15} className="text-[#1d6fb8]" /> Photo or video</button>
          <button type="button" onClick={() => { setAttachOpen(false); docInput.current?.click(); }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#2b2a27] hover:bg-[#eef1ef] cursor-pointer"><FileText size={15} className="text-[#7a3db8]" /> Document</button>
        </div>
      )}
      <input ref={mediaInput} id="wa-attach-media" type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={docInput} id="wa-attach-document" type="file" multiple hidden onChange={(e) => { addFiles(e.target.files, true); e.target.value = ''; }} />

      {recording ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => stopRecording(false)} aria-label="Discard the recording" className="w-10 h-10 rounded-full grid place-items-center text-[#b42318] hover:bg-red-50 cursor-pointer"><Trash2 size={18} /></button>
          <div className="flex-1 flex items-center gap-2.5 text-sm text-[#14201a]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#d92d20] animate-pulse" />
            <span className="tabular-nums font-medium">{clock(seconds)}</span>
            <span className="text-[#8a948d]">Recording a voice note…</span>
          </div>
          <button type="button" onClick={() => stopRecording(true)} aria-label="Send the voice note" className="w-10 h-10 rounded-full grid place-items-center bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer"><Send size={17} /></button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5 px-3 py-2.5">
          <button type="button" onClick={() => { setEmojiOpen((v) => !v); setAttachOpen(false); }} aria-label="Emoji" aria-expanded={emojiOpen} className={`w-10 h-10 shrink-0 rounded-full grid place-items-center cursor-pointer ${emojiOpen ? 'bg-[#eef9f4] text-[#1a7a5a]' : 'text-[#5f6b63] hover:bg-[#eef1ef]'}`}><Smile size={19} /></button>
          <button type="button" onClick={() => { setAttachOpen((v) => !v); setEmojiOpen(false); }} aria-label="Attach" aria-expanded={attachOpen} className={`w-10 h-10 shrink-0 rounded-full grid place-items-center cursor-pointer ${attachOpen ? 'bg-[#eef9f4] text-[#1a7a5a]' : 'text-[#5f6b63] hover:bg-[#eef1ef]'}`}><Paperclip size={19} /></button>
          <textarea ref={area} id="wa-composer-text" value={text} rows={1} dir="auto"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => { setEmojiOpen(false); setAttachOpen(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); addFiles(files); } }}
            placeholder={pending.length ? 'Add a caption…' : 'Type a message'}
            className="flex-1 min-w-0 resize-none border border-[#e4e9e5] rounded-2xl px-4 py-2.5 text-sm leading-snug focus:outline-none focus:border-[#047246] bg-[#fbfaf8]" />
          {canSend || busy ? (
            <button type="button" onClick={() => void send()} disabled={!canSend} aria-label="Send" className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
          ) : (
            <button type="button" onClick={() => void startRecording()} aria-label="Record a voice note" title="Record a voice note" className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-[#047246] text-white hover:bg-[#26856d] cursor-pointer"><Mic size={18} /></button>
          )}
        </div>
      )}
      {error && <div className="px-4 pb-2.5 -mt-1 text-xs text-[#b42318]">{error}</div>}
    </div>
  );
}
