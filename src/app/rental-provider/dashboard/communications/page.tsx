'use client';

import { useState } from 'react';
import { MessageSquare, Search, Send, Plus } from 'lucide-react';

type ThreadStatus = 'open' | 'resolved' | 'pending';

type Message = {
  id: string;
  from: string;
  text: string;
  timestamp: string;
  isMe: boolean;
};

type Thread = {
  id: string;
  subject: string;
  tenant: string;
  unit: string;
  asset: string;
  lastMessage: string;
  lastAt: string;
  status: ThreadStatus;
  unread: number;
  messages: Message[];
};

/* Placeholder — will be replaced by /api/communications (Sprint 6) */
const DEMO_THREADS: Thread[] = [];

const STATUS_STYLE: Record<ThreadStatus, string> = {
  open: 'bg-[#d8f2e8] text-[#1a7a5a]',
  resolved: 'bg-[#f4f3ef] text-[#6b6860]',
  pending: 'bg-[#fef3c7] text-[#92400e]',
};

export default function CommunicationsPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');

  const filtered = DEMO_THREADS.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.tenant.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.unit.toLowerCase().includes(q);
  });

  const selectedThread = selectedId ? DEMO_THREADS.find(t => t.id === selectedId) : null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    setNewMessage('');
    // Will call API in Sprint 6
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Communications</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Messaging threads with customers and managers.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
            <span className="font-semibold">Sprint 6</span> — Messaging API coming (SCRUM-601)
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer"
            style={{ background: '#2e9f82' }}
          >
            <Plus size={15} /> New Thread
          </button>
        </div>
      </div>

      {DEMO_THREADS.length === 0 ? (
        /* Empty state */
        <div className="bg-white rounded-2xl p-16 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
            <MessageSquare size={24} className="text-[#2e9f82]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No messages yet</h3>
          <p className="text-sm text-[#6b6860] max-w-xs">
            Communication threads with customers and asset managers will appear here once the messaging feature launches in Sprint 6.
          </p>
        </div>
      ) : (
        /* Split pane layout */
        <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[500px]">
          {/* Thread list */}
          <div className="w-80 flex flex-col shrink-0">
            {/* Search */}
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
              <input
                type="text"
                placeholder="Search threads…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl cursor-pointer transition-colors ${selectedId === t.id ? 'bg-[#d8f2e8]' : 'bg-white hover:bg-[#f4f3ef]'}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-[#1a1916] truncate">{t.tenant}</span>
                    {t.unread > 0 && (
                      <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white shrink-0" style={{ background: '#2e9f82' }}>
                        {t.unread}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#6b6860] truncate">{t.subject}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center rounded-full text-[10px] font-medium px-1.5 py-0.5 ${STATUS_STYLE[t.status]}`}>
                      {t.status}
                    </span>
                    <span className="text-[10px] text-[#9b9890]">{t.lastAt}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Message pane */}
          <div className="flex-1 bg-white rounded-2xl shadow-sm flex flex-col overflow-hidden">
            {selectedThread ? (
              <>
                {/* Thread header */}
                <div className="px-5 py-4 border-b border-[#e8e6e0]">
                  <h3 className="font-semibold text-[#1a1916]">{selectedThread.subject}</h3>
                  <p className="text-xs text-[#6b6860]">{selectedThread.tenant} · {selectedThread.unit} · {selectedThread.asset}</p>
                </div>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {selectedThread.messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${msg.isMe ? 'text-white' : 'bg-[#f4f3ef] text-[#1a1916]'}`}
                        style={msg.isMe ? { background: '#2e9f82' } : {}}>
                        {!msg.isMe && <p className="text-xs font-medium text-[#2e9f82] mb-1">{msg.from}</p>}
                        <p>{msg.text}</p>
                        <p className={`text-[10px] mt-1 ${msg.isMe ? 'text-white/70' : 'text-[#9b9890]'}`}>{msg.timestamp}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Compose bar */}
                <form onSubmit={handleSend} className="px-5 py-3 border-t border-[#e8e6e0] flex gap-3">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    placeholder="Type a message…"
                    className="flex-1 border border-[#e8e6e0] rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white cursor-pointer disabled:opacity-40 shrink-0"
                    style={{ background: '#2e9f82' }}
                  >
                    <Send size={16} />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-[#9b9890]">
                <MessageSquare size={32} className="mb-3" />
                <p className="text-sm">Select a thread to view messages</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
