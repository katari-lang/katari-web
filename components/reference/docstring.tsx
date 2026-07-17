import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Katari docstrings are plain text with two inline-code conventions: `backticks` for code
// spans and @name@ for parameter references (Haddock style). Newlines inside a paragraph
// are source-wrapping artifacts; blank lines separate paragraphs.
export function Docstring({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n[ \t]*\n/);
  return (
    <div className={cn("space-y-2", className)}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-sm font-light leading-relaxed text-muted-foreground">
          {renderInlineCode(paragraph.replaceAll("\n", " "))}
        </p>
      ))}
    </div>
  );
}

function renderInlineCode(text: string): ReactNode[] {
  // Split keeps the delimited spans as their own segments; everything else passes through.
  const segments = text.split(/(`[^`]+`|@[^@\s][^@]*@)/);
  return segments.map((segment, index) => {
    const isCodeSpan =
      segment.length > 2 &&
      ((segment.startsWith("`") && segment.endsWith("`")) ||
        (segment.startsWith("@") && segment.endsWith("@")));
    if (!isCodeSpan) return segment;
    return (
      <code key={index} className="bg-muted px-1 py-0.5 font-mono text-[0.8125em] text-foreground">
        {segment.slice(1, -1)}
      </code>
    );
  });
}
