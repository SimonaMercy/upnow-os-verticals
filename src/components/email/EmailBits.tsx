'use client';

/** The small pieces the email screens share: the avatar, the kind chip, a file card, a list row. */
import { FileImage, FileSpreadsheet, FileText, File as FileIcon, Paperclip, User } from 'lucide-react';
import { emailApi, emailKindOf, emailWhen, fileSize, type EmailAttachmentRow, type EmailKind, type EmailThreadRow, type Rp } from '@/lib/emailApi';
import { bareSubject, initialsOf, tidySnippet } from '@/lib/emailText';

export const KIND_LABEL: Record<EmailKind, string> = { customer: 'Customer', lead: 'Lead', vendor: 'Vendor', finance: 'Finance', legal: 'Legal', promotions: 'Promotions', other: 'Other' };
export const KIND_CHIP: Record<EmailKind, string> = {
  customer: 'text-[#1a7a5a] bg-[#eef9f4]', lead: 'text-[#1d5f8a] bg-[#e8f2fb]', vendor: 'text-[#8a6d1d] bg-[#fdf3e3]',
  finance: 'text-[#5b3fa0] bg-[#f1ecfb]', legal: 'text-[#9a2f2f] bg-[#fbecea]', promotions: 'text-[#9a3b6b] bg-[#fbecf4]', other: 'text-[#6b6860] bg-[#f0eee9]',
};

export function KindChip({ kind }: { kind: EmailKind }) {
  return <span className={`text-[9.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-px shrink-0 ${KIND_CHIP[kind]}`}>{KIND_LABEL[kind]}</span>;
}

export function Avatar({ name, tone = 'record', size = 44 }: { name: string | null | undefined; tone?: 'record' | 'other' | 'you'; size?: number }) {
  const cls = tone === 'you' ? 'bg-[#2e9f82] text-white' : tone === 'other' ? 'bg-[#f4f3ef] text-[#6b6860]' : 'bg-[#e8f3ef] text-[#1a7a5a]';
  const initials = tone === 'you' ? 'You' : initialsOf(name);
  return (
    <span className={`shrink-0 rounded-full grid place-items-center font-semibold ${cls}`} style={{ width: size, height: size, fontSize: tone === 'you' ? size * 0.27 : size * 0.32 }} aria-hidden>
      {initials || <User size={size * 0.4} />}
    </span>
  );
}

function fileLook(mime: string, name: string): { Icon: typeof FileIcon; tone: string; label: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return { Icon: FileText, tone: 'bg-red-50 text-[#b42318]', label: 'PDF' };
  if (mime.startsWith('image/')) return { Icon: FileImage, tone: 'bg-[#e8f2fb] text-[#1d5f8a]', label: ext.toUpperCase() || 'IMG' };
  if (/sheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'csv'].includes(ext)) return { Icon: FileSpreadsheet, tone: 'bg-[#eef9f4] text-[#1a7a5a]', label: ext.toUpperCase() };
  if (/word|document/.test(mime) || ['doc', 'docx'].includes(ext)) return { Icon: FileText, tone: 'bg-[#e8f2fb] text-[#1d5f8a]', label: ext.toUpperCase() };
  return { Icon: FileIcon, tone: 'bg-[#f4f3ef] text-[#6b6860]', label: ext.slice(0, 4).toUpperCase() || 'FILE' };
}

/** One attachment — opens in a new tab through a short-lived link. */
export function FileCard({ rp, file, sub, compact = false }: { rp: Rp; file: EmailAttachmentRow; sub?: string; compact?: boolean }) {
  const { Icon, tone, label } = fileLook(file.mimeType, file.fileName);
  const open = async () => {
    try { const { url } = await emailApi.attachmentUrl(rp, file.id); window.open(url, '_blank', 'noopener'); } catch { /* the link simply does not open */ }
  };
  return (
    <button type="button" onClick={open} title={file.fileName}
      className={`group flex items-center gap-2.5 text-left rounded-xl border border-[#e8e6e0] bg-white hover:border-[#2e9f82] cursor-pointer min-w-0 ${compact ? 'px-2.5 py-2 w-full' : 'px-3 py-2 w-[232px] max-w-full'}`}>
      <span className={`w-9 h-9 shrink-0 rounded-lg grid place-items-center ${tone}`}><Icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-[#1a1916] truncate group-hover:text-[#1a7a5a]">{file.fileName}</span>
        <span className="block text-[11px] text-[#9b9890] truncate">{label} · {fileSize(file.sizeBytes)}{sub ? ` · ${sub}` : ''}</span>
      </span>
    </button>
  );
}

/**
 * One conversation in a list. In the inbox it leads with WHO (avatar, name, kind,
 * unit); on a customer's own page the who is already known, so it leads with the
 * subject.
 */
export function EmailRow({ t, active = false, showWho = true, showKind = true, mailboxLabel, onOpen }: {
  t: EmailThreadRow; active?: boolean; showWho?: boolean; showKind?: boolean;
  /** Which of the landlord's mailboxes it is on — given only when they have more than one. */
  mailboxLabel?: string | null;
  onOpen: () => void;
}) {
  const kind = emailKindOf(t);
  const unread = t.unreadCount > 0;
  const who = t.recordName ?? t.counterpartName ?? t.counterpartEmail;
  const said = t.lastDirection === 'out' ? 'You: ' : t.lastFrom && t.lastFrom !== who && !t.lastFrom.includes('@') ? `${t.lastFrom.split(/\s+/)[0]}: ` : '';
  return (
    <button type="button" onClick={onOpen} className={`w-full min-w-0 text-left px-3.5 py-3 flex gap-3 cursor-pointer ${active ? 'bg-[#eef9f4]' : 'hover:bg-[#fbfaf8]'}`}>
      {showWho && <Avatar name={who} tone={kind === 'other' ? 'other' : 'record'} />}
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={`text-sm truncate flex-1 ${unread ? 'font-bold text-[#1a1916]' : 'font-medium text-[#2b2a27]'}`}>{showWho ? who : bareSubject(t.subject)}</span>
          <span className={`text-[11px] shrink-0 tabular-nums ${unread ? 'text-[#1a7a5a] font-semibold' : 'text-[#9b9890]'}`}>{emailWhen(t.lastMessageAt)}</span>
        </span>
        {showWho && (
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[13px] truncate flex-1 ${unread ? 'font-semibold text-[#1a1916]' : 'text-[#2b2a27]'}`}>{bareSubject(t.subject)}</span>
            {t.messageCount > 1 && <span className="shrink-0 text-[10.5px] tabular-nums text-[#6b6860] border border-[#e8e6e0] rounded-full px-1.5 leading-[16px]" aria-label={`${t.messageCount} emails`}>{t.messageCount}</span>}
          </span>
        )}
        <span className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs truncate flex-1 ${unread ? 'text-[#1a1916]' : 'text-[#6b6860]'}`} dir="auto"><span className="text-[#9b9890]">{said}</span>{tidySnippet(t.lastSnippet) || (t.fileCount > 0 ? 'Files attached' : '—')}</span>
          {t.fileCount > 0 && <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-[#9b9890] tabular-nums" aria-label={`${t.fileCount} files`}><Paperclip size={11} />{t.fileCount}</span>}
          {!showWho && t.messageCount > 1 && <span className="shrink-0 text-[11px] text-[#9b9890] tabular-nums">{t.messageCount} emails</span>}
          {unread && <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold grid place-items-center tabular-nums" aria-label={`${t.unreadCount} unread`}>{t.unreadCount}</span>}
        </span>
        {((showWho && ((showKind && kind !== 'other') || t.unitLabel)) || mailboxLabel) && (
          <span className="flex items-center gap-1.5 mt-1 min-w-0">
            {showWho && showKind && kind !== 'other' && <KindChip kind={kind} />}
            {showWho && t.unitLabel && <span className="text-[10.5px] text-[#9b9890] truncate">{t.unitLabel}</span>}
            {mailboxLabel && <span className="text-[10.5px] text-[#9b9890] truncate ml-auto shrink-0">{mailboxLabel}</span>}
          </span>
        )}
      </span>
    </button>
  );
}
