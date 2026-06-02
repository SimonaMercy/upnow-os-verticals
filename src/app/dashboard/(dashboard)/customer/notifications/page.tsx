'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, Check, CheckCheck, ExternalLink, Loader2 } from 'lucide-react';
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
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PAGE_SIZE = 20;

export default function CustomerNotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = items.length < total;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<NotifListResponse>(
        `/notifications?page=${p}&limit=${PAGE_SIZE}`,
      );
      setItems((prev) => (p === 1 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setUnreadCount(data.unreadCount);
      setPage(p);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { void load(1); }, [load]);

  // Infinite scroll via IntersectionObserver on sentinel div
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          void load(page + 1);
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, load, page]);

  async function markOne(id: number) {
    const notif = items.find((n) => n.id === id);
    if (!notif || notif.isRead) return;
    try {
      await apiPatch<{ id: number }>(`/notifications/${id}/read`, {});
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // non-critical
    }
  }

  async function markAllRead() {
    setMarking(true);
    try {
      await apiPatch<{ marked: number }>('/notifications/mark-read', {});
      setUnreadCount(0);
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // non-critical
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}
          >
            <Bell size={20} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-neutral-900)' }}>
              Notifications
            </h1>
            <p className="text-xs" style={{ color: '#6b7280' }}>
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
        </div>

        {/* Mark all read — always visible, greyed out when nothing to mark */}
        <button
          onClick={markAllRead}
          disabled={marking || unreadCount === 0}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
          style={{
            background: unreadCount > 0
              ? 'color-mix(in srgb, var(--color-primary) 10%, white)'
              : '#f3f4f6',
            color: unreadCount > 0 ? 'var(--color-primary)' : '#9ca3af',
          }}
        >
          {marking ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
          Mark all read
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
        {/* Skeleton while initial load */}
        {loading && items.length === 0 &&
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-3 px-5 py-4 animate-pulse"
              style={{ borderBottom: i < 4 ? '1px solid #f3f4f6' : undefined, background: '#fff' }}
            >
              <div className="mt-2 flex-shrink-0 w-2 h-2 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded bg-gray-200" style={{ width: '60%' }} />
                <div className="h-3 rounded bg-gray-200" style={{ width: '80%' }} />
                <div className="h-3 rounded bg-gray-200" style={{ width: '30%' }} />
              </div>
            </div>
          ))
        }

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="py-16 text-center" style={{ background: '#fff' }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-gray-50">
              <Bell size={24} style={{ color: '#d1d5db' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#6b7280' }}>No notifications yet</p>
            <p className="text-xs mt-1" style={{ color: '#9ca3af' }}>
              Updates about your viewings, contracts, and documents will appear here.
            </p>
          </div>
        )}

        {/* Notification rows */}
        {items.map((n, idx) => (
          <div
            key={n.id}
            className="flex gap-3 px-5 py-4 cursor-pointer transition-colors"
            style={{
              borderBottom: idx < items.length - 1 ? '1px solid #f3f4f6' : undefined,
              // white for read, light green tint for unread
              background: n.isRead
                ? '#ffffff'
                : 'color-mix(in srgb, var(--color-primary) 8%, white)',
            }}
            onClick={() => void markOne(n.id)}
          >
            {/* Unread dot */}
            <div className="mt-2 flex-shrink-0" style={{ width: 8 }}>
              {!n.isRead && (
                <span
                  className="block rounded-full"
                  style={{ width: 8, height: 8, background: 'var(--color-primary)' }}
                />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p
                className="text-sm leading-snug"
                style={{
                  color: '#111827',
                  fontWeight: n.isRead ? 400 : 600,
                }}
              >
                {n.title}
              </p>
              {n.body && (
                <p className="text-sm mt-0.5 leading-relaxed" style={{ color: '#6b7280' }}>
                  {n.body}
                </p>
              )}
              <p className="text-xs mt-1.5" style={{ color: '#9ca3af' }}>
                {timeAgo(n.createdAt)}
              </p>
            </div>

            {/* Per-row actions */}
            <div className="flex flex-col items-end gap-2 flex-shrink-0 mt-0.5">
              {!n.isRead && (
                <button
                  onClick={(e) => { e.stopPropagation(); void markOne(n.id); }}
                  title="Mark as read"
                  className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors hover:opacity-80"
                  style={{
                    background: 'color-mix(in srgb, var(--color-primary) 10%, white)',
                    color: 'var(--color-primary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Check size={11} strokeWidth={2.5} />
                  Mark read
                </button>
              )}
              {n.deepLink && (
                <Link
                  href={n.deepLink}
                  className="flex items-center gap-1 text-xs font-medium hover:underline"
                  style={{ color: '#9ca3af', whiteSpace: 'nowrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={12} />
                  View
                </Link>
              )}
            </div>
          </div>
        ))}

        {/* Scroll sentinel — triggers next page load */}
        <div ref={sentinelRef} />

        {/* Loading spinner for subsequent pages */}
        {loading && items.length > 0 && (
          <div className="flex justify-center py-4" style={{ background: '#fff' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: '#9ca3af' }} />
          </div>
        )}
      </div>
    </div>
  );
}
