'use client';

import { Heart } from 'lucide-react';

export default function CustomerWishlistPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}
        >
          <Heart size={28} style={{ color: 'var(--color-primary)' }} />
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-neutral-900)' }}>
          Wishlist & Saved Searches
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-neutral-500)' }}>
          Save properties you love and keep tabs on searches that matter.
        </p>
        <p className="text-xs mt-5 inline-block px-3 py-1 rounded-full font-semibold uppercase tracking-wide"
           style={{ background: 'var(--color-base-100, #fafafa)', color: 'var(--color-neutral-400)', border: '1px solid var(--color-base-200)' }}>
          Coming soon
        </p>
      </div>
    </div>
  );
}
