// One declaration of a module: kind badge, anchored name, highlighted signature, docstring,
// and the structured views (generics, parameters, return type, effects, definition, inferred
// type, wire-view schema).

import type { ReactNode } from "react";
import Link from "next/link";
import type {
  Declaration,
  DeclarationKind,
  GenericParameter,
  ParameterDoc,
} from "@/lib/reference/types";
import { resolveDeclarationHref } from "@/lib/reference/links";
import { highlightKatari } from "@/lib/reference/highlight";
import { CopyButton } from "./copy-button";
import { DetailSection } from "./detail-section";
import { Docstring } from "./docstring";
import { TypeNodeView } from "./type-node";
import { WireView } from "./wire-view";

const KIND_LABELS: Record<DeclarationKind, string> = {
  agent: "agent",
  external_agent: "external agent",
  primitive_agent: "primitive agent",
  request: "request",
  marker_effect: "effect",
  data: "data",
  type_synonym: "type",
};

type DeclarationCardProps = {
  moduleName: string;
  declaration: Declaration;
  moduleToPackage: Record<string, string>;
};

export async function DeclarationCard({
  moduleName,
  declaration,
  moduleToPackage,
}: DeclarationCardProps) {
  const anchorId = `${moduleName}.${declaration.name}`;
  const signatureHtml = await highlightKatari(declaration.signature);

  return (
    <section id={anchorId} className="scroll-mt-24 border border-border bg-background/40 p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="font-mono text-base font-medium">
          <Link
            href={`#${anchorId}`}
            className="group/anchor text-foreground transition-colors hover:text-highlight"
          >
            {declaration.name}
            <span className="ml-1.5 text-border-strong opacity-0 transition-opacity group-hover/anchor:opacity-100">
              #
            </span>
          </Link>
        </h3>
        <Badge>{KIND_LABELS[declaration.kind]}</Badge>
        {declaration.private === true && <Badge variant="accent">private</Badge>}
        {declaration.reactor !== null && <Badge>reactor: {declaration.reactor}</Badge>}
      </header>

      <div className="reference-code mt-3 flex items-start gap-2">
        <div
          className="min-w-0 flex-1"
          // Trusted build-time output of our own shiki highlighter.
          dangerouslySetInnerHTML={{ __html: signatureHtml }}
        />
        <CopyButton value={declaration.signature} label="Copy signature" className="mt-2" />
      </div>

      {declaration.documentation !== null && (
        <Docstring text={declaration.documentation} className="mt-3" />
      )}

      {declaration.generics.length > 0 && (
        <DetailSection label="Generics">
          <div className="space-y-2">
            {declaration.generics.map((generic) => (
              <GenericRow key={generic.name} generic={generic} moduleToPackage={moduleToPackage} />
            ))}
          </div>
        </DetailSection>
      )}

      {declaration.parameters.length > 0 && (
        <DetailSection label="Parameters">
          <div className="space-y-4">
            {declaration.parameters.map((parameter) => (
              <ParameterRow
                key={parameter.label}
                parameter={parameter}
                moduleToPackage={moduleToPackage}
              />
            ))}
          </div>
        </DetailSection>
      )}

      {declaration.returnType !== null && (
        <DetailSection label="Returns">
          <TypeNodeView node={declaration.returnType} moduleToPackage={moduleToPackage} />
        </DetailSection>
      )}

      {declaration.effects !== null && (
        <DetailSection label="Effects">
          <TypeNodeView node={declaration.effects} moduleToPackage={moduleToPackage} />
        </DetailSection>
      )}

      {declaration.definition !== null && (
        <DetailSection label="Definition">
          <TypeNodeView node={declaration.definition} moduleToPackage={moduleToPackage} />
        </DetailSection>
      )}

      {showInferredType(declaration) && (
        <DetailSection label="Inferred type">
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
              {declaration.checkedType}
            </pre>
            <CopyButton value={declaration.checkedType ?? ""} label="Copy inferred type" />
          </div>
        </DetailSection>
      )}

      {declaration.schema !== null ? (
        <WireView
          schema={declaration.schema}
          requestHrefs={declaration.schema.requests.map((request) =>
            resolveDeclarationHref(moduleToPackage, request.descriptor.name),
          )}
        />
      ) : (
        showWireViewHint(declaration) && (
          <p className="mt-4 text-xs italic text-subtle-foreground">
            Wire view — the wire shape is fixed at the call site, where the generic parameters are
            instantiated.
          </p>
        )
      )}
    </section>
  );
}

/** A wire view is attached only to monomorphic declarations, so for a generic one its absence
 *  is by design, not a generation gap — say so instead of silently omitting the section. Type
 *  synonyms and marker effects are not wire-callable values at all and stay silent. */
function showWireViewHint(declaration: Declaration): boolean {
  if (declaration.generics.length === 0) return false;
  return declaration.kind !== "type_synonym" && declaration.kind !== "marker_effect";
}

/** The signature is surface syntax; `checkedType` is the semantic truth (inference and
 *  synonym expansion). Show it only when it says something the signature does not — the
 *  comparison strips the declaration name, which the semantic rendering never carries. */
function showInferredType(declaration: Declaration): boolean {
  if (declaration.checkedType === null) return false;
  const surface = declaration.signature
    .replace(/^private\s+/, "")
    .replace(/^agent\s+[A-Za-z0-9_.]+/, "agent");
  return surface !== declaration.checkedType;
}

function Badge({ children, variant }: { children: ReactNode; variant?: "accent" }) {
  return (
    <span
      className={
        variant === "accent"
          ? "border border-highlight px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-highlight"
          : "border border-border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}

function GenericRow({
  generic,
  moduleToPackage,
}: {
  generic: GenericParameter;
  moduleToPackage: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm font-medium text-foreground">{generic.name}</span>
      <span className="bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
        {generic.kind}
      </span>
      {generic.bindsLiteral && (
        <span className="bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          literal
        </span>
      )}
      {generic.upperBound !== null && (
        <>
          <span className="text-xs text-subtle-foreground">extends</span>
          <TypeNodeView node={generic.upperBound} moduleToPackage={moduleToPackage} />
        </>
      )}
    </div>
  );
}

function ParameterRow({
  parameter,
  moduleToPackage,
}: {
  parameter: ParameterDoc;
  moduleToPackage: Record<string, string>;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm font-medium text-foreground">{parameter.label}</span>
        {parameter.default !== null && (
          <span
            className="bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
            title="default value"
          >
            ?= {parameter.default.rendered}
          </span>
        )}
      </div>
      {parameter.documentation !== null && (
        <Docstring text={parameter.documentation} className="mt-1" />
      )}
      <div className="mt-1">
        {parameter.type !== null ? (
          <TypeNodeView node={parameter.type} moduleToPackage={moduleToPackage} />
        ) : (
          <span className="text-xs italic text-subtle-foreground">
            unannotated — see the inferred type
          </span>
        )}
      </div>
    </div>
  );
}
