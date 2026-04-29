import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
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
    <html lang="en" className={dmSans.className}>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
