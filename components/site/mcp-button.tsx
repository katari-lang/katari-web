"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Clipboard, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { McpIcon } from "./icons";

// The remote MCP endpoint the docs Worker serves (worker/index.ts). Kept here rather than in
// site-config so the copy lives next to the UI that presents it.
const MCP_URL = "https://katari-lang.dev/mcp";

/** Header affordance: a small MCP mark that copies the endpoint URL and opens the connect modal. */
export function McpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Connect via MCP"
        className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:cursor-pointer"
      >
        <McpIcon className="size-5" />
      </button>
      <McpDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function McpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useEscapeKey(() => onOpenChange(false), open);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    // clipboard API is https / localhost only; a failure must not break the modal.
    navigator.clipboard?.writeText(MCP_URL).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, []);

  // Opening the modal copies the URL as a courtesy, so the common "grab the link" path is one click.
  useEffect(() => {
    if (open) copy();
  }, [open, copy]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect via MCP"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 p-4 pt-[15vh] backdrop-blur-sm transition-all"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md overflow-hidden border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <McpIcon className="size-4 text-muted-foreground" />
          <h2 className="flex-1 text-sm font-semibold">Connect via MCP</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-stretch border border-border">
            <code className="flex-1 overflow-x-auto whitespace-nowrap px-3 py-2 font-mono text-sm">
              {MCP_URL}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy MCP URL"
              className="inline-flex shrink-0 items-center gap-1.5 border-l border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground hover:cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="size-4 text-highlight" />
                  Copied
                </>
              ) : (
                <>
                  <Clipboard className="size-4" />
                  Copy
                </>
              )}
            </button>
          </div>

          <p className="text-sm leading-6 text-muted-foreground">
            Add this URL as a remote MCP server in any AI client that supports MCP (Claude and
            others). No authentication is required. It exposes tools to search the docs, browse the
            package API, and onboard to Katari.
          </p>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-8 items-center justify-center border border-border px-4 text-sm transition-all hover:border-border-strong hover:bg-muted hover:cursor-pointer"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
