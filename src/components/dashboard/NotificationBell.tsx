'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, CheckCheck, Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { apiGet, apiPatch } from '@/lib/api';

interface Notification {
  id: number;
  title: string;
  body: string | null;
  deepLink: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotifListResponse {
  items: Notification[];
  unreadCount: number;
  total: number;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const POLL_MS = 30_000;

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const data = await apiGet<{ count: number }>('/notifications/unread-count');
      setUnread(data.count);
    } catch {
      // badge failure must not break the page
    }
  }, []);

  useEffect(() => {
    void fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    return () => clearInterval(id);
  }, [fetchCount]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiGet<NotifListResponse>('/notifications?limit=5')
      .then((d) => {
        setItems(d.items);
        setUnread(d.unreadCount);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function markOne(id: number) {
    const notif = items.find((n) => n.id === id);
    if (!notif || notif.isRead) return;
    try {
      await apiPatch<{ id: number }>(`/notifications/${id}/read`, {});
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnread((c) => Math.max(0, c - 1));
    } catch {
      // non-critical
    }
  }

  async function markAllRead() {
    try {
      await apiPatch<{ marked: number }>('/notifications/mark-read', {});
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // non-critical
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="relative text-[var(--color-neutral-500)] hover:text-[var(--color-neutral-900)] transition-colors"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-white font-bold leading-none"
            style={{
              background: 'var(--color-primary)',
              fontSize: '10px',
              minWidth: '16px',
              height: '16px',
              padding: '0 3px',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 z-50 rounded-2xl shadow-xl overflow-hidden"
          style={{
            width: '340px',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            top: 'calc(100% + 8px)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid #e5e7eb' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
              Notifications
              {unread > 0 && (
                <span
                  className="ml-2 rounded-full text-white text-xs font-bold px-1.5 py-0.5"
                  style={{ background: 'var(--color-primary)', fontSize: '10px' }}
                >
                  {unread}
                </span>
              )}
            </span>
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs font-medium transition-opacity"
              style={{
                color: unread > 0 ? 'var(--color-primary)' : '#9ca3af',
                cursor: unread > 0 ? 'pointer' : 'default',
              }}
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-sm" style={{ color: '#9ca3af' }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-sm" style={{ color: '#9ca3af' }}>
                No notifications yet
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className="px-4 py-3 flex gap-3"
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    background: n.isRead ? '#ffffff' : 'color-mix(in srgb, var(--color-primary) 8%, white)',
                  }}
                >
                  {/* Unread dot */}
                  <div className="mt-1.5 flex-shrink-0" style={{ width: 7 }}>
                    {!n.isRead && (
                      <span
                        className="block rounded-full"
                        style={{ width: 7, height: 7, background: 'var(--color-primary)' }}
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm leading-snug"
                      style={{
                        color: 'var(--color-neutral-900)',
                        fontWeight: n.isRead ? 400 : 600,
                      }}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#6b7280' }}>
                        {n.body}
                      </p>
                    )}
                    <p className="text-xs mt-1" style={{ color: '#9ca3af' }}>
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0 mt-0.5">
                    {/* Mark as read button — only on unread */}
                    {!n.isRead && (
                      <button
                        onClick={() => void markOne(n.id)}
                        title="Mark as read"
                        className="rounded-full flex items-center justify-center transition-colors hover:opacity-80"
                        style={{
                          width: 20, height: 20,
                          background: 'color-mix(in srgb, var(--color-primary) 15%, white)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        <Check size={11} strokeWidth={2.5} />
                      </button>
                    )}
                    {n.deepLink && (
                      <Link
                        href={n.deepLink}
                        className="hover:opacity-70"
                        style={{ color: '#9ca3af' }}
                        onClick={() => setOpen(false)}
                      >
                        <ExternalLink size={13} />
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <Link
            href="/dashboard/customer/notifications"
            className="block text-center py-3 text-xs font-medium hover:underline"
            style={{
              color: 'var(--color-primary)',
              borderTop: '1px solid #e5e7eb',
              background: '#ffffff',
            }}
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
