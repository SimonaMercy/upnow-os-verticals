import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { DocViewerHost } from "@/components/upnow/DocViewerHost";

// Type: MarketSpace's Plus Jakarta Sans (UI) + Roboto Serif (display), self-hosted
// from /public/fonts/marketspace via the @font-face rules at the end of globals.css.
// --font-sans / --font-serif are defined there, so nothing is fetched at build time.

export const metadata: Metadata = {
  title: "UpNow — UAE Property & Services Marketplace",
  description: "Find and book rental spaces, home services and more across UAE.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
        <DocViewerHost />
      </body>
    </html>
  );
}
