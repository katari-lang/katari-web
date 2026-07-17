"use client";

import { useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { cn } from "@/lib/cn";

// Icon-only copy button for dense reference UI (signatures, type nodes, schema JSON).
// The docs pages' CopyMarkdownButton is a labelled variant of the same interaction.
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard が使えない環境では何もしない
    }
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center p-1 text-subtle-foreground transition-colors hover:text-foreground hover:cursor-pointer",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-highlight" /> : <Clipboard className="size-3.5" />}
    </button>
  );
}
