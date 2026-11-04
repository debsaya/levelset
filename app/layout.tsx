import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Levelset — quote levelling co-pilot",
  description: "Draft an RFx, read whatever vendors send back, and interrogate the comparison in plain language.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
