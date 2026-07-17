// Graphical renderer for the structured surface-type tree (TypeNode). The visual grammar
// follows admin-web's SchemaViewer: a font-mono badge per node, children behind a border-l
// indent. Every node's `rendered` (its own source syntax) is one hover-copy away, and name
// nodes with a resolution link to the declaration they point at.

import type { ReactNode } from "react";
import Link from "next/link";
import type { TypeNode } from "@/lib/reference/types";
import { resolveDeclarationHref } from "@/lib/reference/links";
import { CopyButton } from "./copy-button";

type TypeNodeViewProps = {
  node: TypeNode;
  moduleToPackage: Record<string, string>;
};

export function TypeNodeView({ node, moduleToPackage }: TypeNodeViewProps): ReactNode {
  switch (node.node) {
    case "primitive":
      return <NodeRow rendered={node.rendered} badge={node.name} />;
    case "string_literal":
      return (
        <NodeRow
          rendered={node.rendered}
          inline={<span className="font-mono text-xs text-foreground">{node.rendered}</span>}
        />
      );
    case "never":
    case "unknown":
    case "all":
    case "io":
    case "pure":
    case "array":
    case "record":
      return <NodeRow rendered={node.rendered} badge={node.node} />;
    case "name":
      return (
        <NodeRow
          rendered={node.rendered}
          inline={<NameInline node={node} moduleToPackage={moduleToPackage} />}
        />
      );
    case "agent":
      return (
        <NodeRow rendered={node.rendered} badge="agent">
          <LabeledChild label="input">
            <TypeNodeView node={node.parameter} moduleToPackage={moduleToPackage} />
          </LabeledChild>
          <LabeledChild label="output">
            <TypeNodeView node={node.return} moduleToPackage={moduleToPackage} />
          </LabeledChild>
          {node.effects !== null && (
            <LabeledChild label="effects">
              <TypeNodeView node={node.effects} moduleToPackage={moduleToPackage} />
            </LabeledChild>
          )}
        </NodeRow>
      );
    case "application":
      return (
        <NodeRow
          rendered={node.rendered}
          inline={<HeadInline node={node.head} moduleToPackage={moduleToPackage} />}
        >
          {node.arguments.map((argument, index) => (
            <TypeNodeView key={index} node={argument} moduleToPackage={moduleToPackage} />
          ))}
        </NodeRow>
      );
    case "tuple":
      return (
        <NodeRow rendered={node.rendered} badge="tuple">
          {node.elements.map((element, index) => (
            <div key={index}>
              <span className="mb-1 inline-flex items-center bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {index}
              </span>
              <div className="mt-1">
                <TypeNodeView node={element} moduleToPackage={moduleToPackage} />
              </div>
            </div>
          ))}
        </NodeRow>
      );
    case "union":
      return (
        <NodeRow rendered={node.rendered} badge="one of" badgeVariant="structure">
          {node.branches.map((branch, index) => (
            <TypeNodeView key={index} node={branch} moduleToPackage={moduleToPackage} />
          ))}
        </NodeRow>
      );
    case "object":
      return (
        <NodeRow rendered={node.rendered} badge="object">
          {node.fields.map((field) => (
            <div key={field.name}>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-sm font-medium text-foreground">{field.name}</span>
                {field.optional && <span className="text-xs text-subtle-foreground">optional</span>}
              </div>
              <TypeNodeView node={field.type} moduleToPackage={moduleToPackage} />
            </div>
          ))}
        </NodeRow>
      );
    case "attributed":
      return (
        <NodeRow
          rendered={node.rendered}
          inline={
            <span className="inline-flex items-center bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              of {node.attribute.rendered}
            </span>
          }
        >
          <TypeNodeView node={node.base} moduleToPackage={moduleToPackage} />
        </NodeRow>
      );
    case "attribute_literal":
      return <NodeRow rendered={node.rendered} badge={node.kind} />;
    case "override":
      return (
        <NodeRow rendered={node.rendered} badge="override">
          <LabeledChild label="base">
            <TypeNodeView node={node.base} moduleToPackage={moduleToPackage} />
          </LabeledChild>
          <LabeledChild label="overrides">
            {node.overrides.map((override, index) => (
              <TypeNodeView key={index} node={override} moduleToPackage={moduleToPackage} />
            ))}
          </LabeledChild>
        </NodeRow>
      );
  }
}

/** One tree node: a header row (badge and/or inline content, hover-copy of `rendered`)
 *  and optionally indented children. */
function NodeRow({
  rendered,
  badge,
  badgeVariant,
  inline,
  children,
}: {
  rendered: string;
  badge?: string;
  // "structure" marks connectives (one of) that are not type heads themselves.
  badgeVariant?: "type" | "structure";
  inline?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="group/row flex min-w-0 items-center gap-1.5">
        {badge !== undefined &&
          (badgeVariant === "structure" ? (
            <span className="text-xs font-medium text-muted-foreground">{badge}</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">{badge}</span>
          ))}
        {inline}
        <CopyButton
          value={rendered}
          label={`Copy type: ${rendered}`}
          className="opacity-0 group-hover/row:opacity-100"
        />
      </div>
      {children !== undefined && (
        <div className="mt-1 border-l border-border">
          <div className="space-y-2 pl-3">{children}</div>
        </div>
      )}
    </div>
  );
}

function LabeledChild({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="text-xs text-subtle-foreground">{label}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** A name occurrence: linked when resolution points into the generated reference, italic
 *  when it is a generic parameter, plain text otherwise (e.g. the Parsed-phase stdlib). */
function NameInline({
  node,
  moduleToPackage,
}: {
  node: Extract<TypeNode, { node: "name" }>;
  moduleToPackage: Record<string, string>;
}) {
  if (typeof node.resolved === "string") {
    const href = resolveDeclarationHref(moduleToPackage, node.resolved);
    if (href !== null) {
      return (
        <Link
          href={href}
          title={node.resolved}
          className="font-mono text-xs text-highlight underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
        >
          {node.rendered}
        </Link>
      );
    }
    return (
      <span title={node.resolved} className="font-mono text-xs text-foreground">
        {node.rendered}
      </span>
    );
  }
  if (node.resolved !== null) {
    return (
      <span
        title={`generic parameter ${node.resolved.generic}`}
        className="font-mono text-xs italic text-muted-foreground"
      >
        {node.rendered}
      </span>
    );
  }
  return <span className="font-mono text-xs text-foreground">{node.rendered}</span>;
}

/** Application heads are names or bare heads (record, array, ...). Names keep their link;
 *  anything else renders as its source text in badge style. */
function HeadInline({
  node,
  moduleToPackage,
}: {
  node: TypeNode;
  moduleToPackage: Record<string, string>;
}) {
  if (node.node === "name") {
    return <NameInline node={node} moduleToPackage={moduleToPackage} />;
  }
  return <span className="font-mono text-xs text-muted-foreground">{node.rendered}</span>;
}
