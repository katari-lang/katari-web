"use client";

// The wire view (JSON Schema) of a declaration, collapsed by default. This is a client
// component on purpose: the schema tree is heavy (recursive types arrive deeply expanded),
// and rendering it server-side would bloat the statically generated page with megabytes of
// collapsed-by-default markup — the schema instead crosses to the client once, as compact
// JSON, and the tree renders lazily on first expand.

import { useState } from "react";
import Link from "next/link";
import type { DeclarationSchema } from "@/lib/reference/types";
import { CopyButton } from "./copy-button";
import { DetailSection } from "./detail-section";
import { SchemaViewer } from "./schema-viewer";

type WireViewProps = {
  schema: DeclarationSchema;
  // Hrefs for each entry of schema.requests, resolved server-side against the reference
  // index (null when the request declaration is outside the generated reference).
  requestHrefs: (string | null)[];
};

export function WireView({ schema, requestHrefs }: WireViewProps) {
  // Sticky: once rendered, the tree stays mounted so reopening is instant.
  const [opened, setOpened] = useState(false);
  const genericBindings = Object.entries(schema.genericBindings);

  return (
    <details
      className="mt-4 border border-border"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        Wire view (JSON Schema)
      </summary>
      {opened && (
        <div className="space-y-4 border-t border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-subtle-foreground">
              The wire-facing shape the runtime shows to AI, derived from the type.
            </p>
            <CopyButton value={JSON.stringify(schema, null, 2)} label="Copy full schema JSON" />
          </div>
          <DetailSection label="Input">
            <SchemaViewer schema={schema.input} />
          </DetailSection>
          <DetailSection label="Output">
            <SchemaViewer schema={schema.output} />
          </DetailSection>
          {schema.requests.length > 0 && (
            <DetailSection label="Requests">
              <div className="space-y-4">
                {schema.requests.map((request, index) => (
                  <div key={index} className="border-l border-border pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <RequestName
                        name={request.descriptor.name}
                        href={requestHrefs[index] ?? null}
                      />
                      <span className="bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {request.kind}
                      </span>
                    </div>
                    <div className="mt-2 space-y-3">
                      <DetailSection label="Input">
                        <SchemaViewer schema={request.descriptor.input} />
                      </DetailSection>
                      <DetailSection label="Output">
                        <SchemaViewer schema={request.descriptor.output} />
                      </DetailSection>
                    </div>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}
          {genericBindings.length > 0 && (
            <DetailSection label="Generic bindings">
              <div className="space-y-3">
                {genericBindings.map(([name, binding]) => (
                  <div key={name}>
                    <span className="font-mono text-sm font-medium text-foreground">{name}</span>
                    <div className="mt-1">
                      <SchemaViewer schema={binding} />
                    </div>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}
        </div>
      )}
    </details>
  );
}

/** Request descriptor names are fully qualified declaration names; linked when the
 *  declaration is part of the generated reference. */
function RequestName({ name, href }: { name: string; href: string | null }) {
  if (href !== null) {
    return (
      <Link href={href} className="font-mono text-sm text-highlight hover:underline">
        {name}
      </Link>
    );
  }
  return <span className="font-mono text-sm text-foreground">{name}</span>;
}
