import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Levelset — quote levelling co-pilot",
  description: "Draft a request for quotes, read whatever vendors send back, and interrogate the comparison in plain language.",
  openGraph: {
    title: "Levelset — quote levelling co-pilot",
    description: "Turn a pile of vendor quotes into one decision you can defend. Demo with fictional vendors and simulated email.",
    type: "website",
  },
  // A private demo, so search engines are asked to leave it alone.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
