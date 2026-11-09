import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BILA — Your agents. Your money. Your rules.",
  description: "Financial governance for AI agents on NEAR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
