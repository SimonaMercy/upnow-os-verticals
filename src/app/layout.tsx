import type { Metadata } from "next";
import { Manrope, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { DocViewerHost } from "@/components/upnow/DocViewerHost";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

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
    <html lang="en" className={`${manrope.className} ${instrumentSerif.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
        <DocViewerHost />
      </body>
    </html>
  );
}
