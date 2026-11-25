import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Every page renders per request so it can carry this request's CSP nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FIRE Planner",
  description: "Financial independence planner with debt paydown and connected accounts.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
