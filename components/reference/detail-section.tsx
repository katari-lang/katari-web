import type { ReactNode } from "react";

// Labeled subsection of a declaration card (Parameters, Returns, wire-view Input, ...).
// Shared by server and client reference components, so it carries no directive.
export function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
