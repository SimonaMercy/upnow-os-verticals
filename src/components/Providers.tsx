"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { installApiFetchCoalescing } from "@/lib/fetchCoalescing";
import { setDocViewerWatermark, setDocViewerCanDownload, canRoleDownloadDocs } from "@/lib/docViewer";

/**
 * Feeds the logged-in user's identity to the document viewer's watermark, and
 * whether their role may download documents. Lives inside <AuthProvider/> because
 * <DocViewerHost/> is mounted outside it (at the app root) and can't read the auth
 * context itself. The tenant magic-link portal has no auth user — it sets its own
 * watermark from the resolved tenant name and never enables downloads.
 */
function DocViewerIdentityBinder() {
  const { user } = useAuth();
  useEffect(() => {
    setDocViewerWatermark(user ? `${user.name} · #${user.id}` : null);
    setDocViewerCanDownload(canRoleDownloadDocs(user?.role));
  }, [user]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    // Install app-wide GET coalescing before any child renders/fetches, so the
    // same /api endpoint requested concurrently by multiple components (or by
    // StrictMode's double-mount) shares a single network request.
    installApiFetchCoalescing();
    return new QueryClient({
      defaultOptions: {
        queries: { staleTime: 60 * 1000, retry: 1 },
      },
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DocViewerIdentityBinder />
        {children}
      </AuthProvider>
      <Toaster position="top-right" richColors closeButton duration={4000} />
    </QueryClientProvider>
  );
}
