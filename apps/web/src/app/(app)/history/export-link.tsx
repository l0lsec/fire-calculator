"use client";
// A download link that says it started: downloads give no on-page feedback.
import type { ReactNode } from "react";
import { useToast } from "@/components/toast";

export function ExportLink({ href, what, children }: { href: string; what: string; children: ReactNode }) {
  const toast = useToast();
  return (
    <a
      href={href}
      download
      onClick={() =>
        toast({ message: `Downloading ${what}. It lands in your Downloads folder.`, tone: "info" })
      }
      className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm hover:bg-surface-2 pointer-coarse:min-h-11"
    >
      {children}
    </a>
  );
}
