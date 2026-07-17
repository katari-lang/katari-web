// Visual display for a JSON Schema (Draft 2020-12 canonical shapes, as the compiler emits
// them): a structured tree with type badges and border-l indentation. Ported from admin-web's
// SchemaViewer onto katari-web's theme tokens; the Katari extensions ($constructor / $agent /
// $ref) get the same semantic-name treatment.

import type { ReactNode } from "react";
import type { JsonObject, JsonValue } from "@/lib/reference/types";
import { CopyButton } from "./copy-button";

export function SchemaViewer({ schema }: { schema: JsonValue }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <SchemaNode schema={schema} />
      </div>
      <CopyButton value={JSON.stringify(schema, null, 2)} label="Copy schema JSON" />
    </div>
  );
}

function TypeBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-xs text-muted-foreground ${className ?? ""}`}>{children}</span>
  );
}

function RequiredBadge() {
  return (
    <span className="text-xs font-medium uppercase tracking-wider text-highlight">required</span>
  );
}

function Description({ text }: { text: string }) {
  return <p className="mt-0.5 text-xs text-subtle-foreground">{text}</p>;
}

/** Narrow a `JsonValue` to a schema object (the keyed shape), or null for a scalar / array. */
function asObject(value: JsonValue | undefined): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function SchemaNode({ schema }: { schema: JsonValue }): ReactNode {
  const node = asObject(schema);
  if (node === null) {
    return <span className="font-mono text-xs text-foreground">{JSON.stringify(schema)}</span>;
  }
  const description = typeof node.description === "string" ? node.description : null;

  // never: `not: {}` or an empty anyOf / oneOf.
  if (isNeverSchema(node)) {
    return (
      <div>
        {description !== null && <Description text={description} />}
        <TypeBadge className="text-highlight">never</TypeBadge>
      </div>
    );
  }

  // anyOf / oneOf union.
  const branches = Array.isArray(node.anyOf)
    ? node.anyOf
    : Array.isArray(node.oneOf)
      ? node.oneOf
      : null;
  if (branches !== null && branches.length > 0) {
    return (
      <div>
        {description !== null && <Description text={description} />}
        <span className="text-xs font-medium text-muted-foreground">one of</span>
        <div className="mt-2 border-l border-border">
          <div className="space-y-2 pl-3">
            {branches.map((branch, index) => (
              <SchemaNode key={index} schema={branch} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // enum.
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return (
      <div>
        <span className="mr-1.5 text-xs font-medium text-muted-foreground">enum</span>
        {description !== null && <Description text={description} />}
        <span className="inline-flex flex-wrap items-center gap-1">
          {node.enum.map((value, index) => (
            <TypeBadge key={index}>{JSON.stringify(value)}</TypeBadge>
          ))}
        </span>
      </div>
    );
  }

  // const.
  if (node.const !== undefined) {
    return (
      <div>
        <span className="mr-1.5 text-xs font-medium text-muted-foreground">const</span>
        {description !== null && <Description text={description} />}
        <TypeBadge>{JSON.stringify(node.const)}</TypeBadge>
      </div>
    );
  }

  const type = singleType(node);

  if (type === "object") {
    return <ObjectNode node={node} description={description} />;
  }

  if (type === "array") {
    const items = asObject(node.items);
    const prefixItems = Array.isArray(node.prefixItems) ? node.prefixItems : null;
    return (
      <div>
        {description !== null && <Description text={description} />}
        <TypeBadge>array</TypeBadge>
        {prefixItems !== null && prefixItems.length > 0 && (
          <div className="mt-2 border-l border-border">
            <div className="space-y-2 pl-3">
              {prefixItems.map((itemSchema, index) => (
                <div key={index}>
                  <span className="mb-1 inline-flex items-center bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {index}
                  </span>
                  <div className="mt-1">
                    <SchemaNode schema={itemSchema} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {items !== null && prefixItems === null && (
          <div className="mt-1 border-l border-border pl-3">
            <span className="text-xs text-muted-foreground">items</span>
            <SchemaNode schema={items} />
          </div>
        )}
      </div>
    );
  }

  // Primitive types: string, number, integer, boolean, null.
  if (type !== undefined) {
    return (
      <div>
        {description !== null && <Description text={description} />}
        <TypeBadge>{type}</TypeBadge>
      </div>
    );
  }

  // Empty schema is `unknown`.
  const meaningfulKeys = Object.keys(node).filter(
    (key) => key !== "description" && key !== "title" && key !== "default",
  );
  if (meaningfulKeys.length === 0) {
    return (
      <div>
        {description !== null && <Description text={description} />}
        <TypeBadge className="text-subtle-foreground">unknown</TypeBadge>
      </div>
    );
  }

  // Fallback: render the raw schema.
  return (
    <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
      {JSON.stringify(node, null, 2)}
    </pre>
  );
}

function ObjectNode({
  node,
  description,
}: {
  node: JsonObject;
  description: string | null;
}): ReactNode {
  const properties = asObject(node.properties);
  const requiredSet = new Set(Array.isArray(node.required) ? node.required.filter(isString) : []);

  // Katari reference shapes: surface the semantic type name rather than the wire machinery.
  const referenceType = referenceTypeOf(properties);
  if (referenceType !== null) {
    return (
      <div>
        {description !== null && <Description text={description} />}
        <TypeBadge>{referenceType}</TypeBadge>
      </div>
    );
  }

  // A `data` constructor carries a `$constructor` const with the constructor name.
  const constructorSchema = asObject(properties?.$constructor);
  const constructorName =
    constructorSchema !== null && typeof constructorSchema.const === "string"
      ? constructorSchema.const
      : null;

  const displayProperties =
    properties !== null
      ? Object.entries(properties).filter(
          ([key]) => constructorName === null || key !== "$constructor",
        )
      : [];
  const additionalSchema = asObject(node.additionalProperties);
  const hasAdditional =
    node.additionalProperties !== undefined && node.additionalProperties !== false;
  const isRecord = displayProperties.length === 0 && hasAdditional;
  const typeLabel = constructorName ?? (isRecord ? "record" : "object");

  return (
    <div>
      {description !== null && <Description text={description} />}
      <TypeBadge>{typeLabel}</TypeBadge>
      {displayProperties.length > 0 && (
        <div className="mt-1 border-l border-border">
          <div className="space-y-2 pl-3">
            {displayProperties.map(([key, propertySchema]) => (
              <div key={key}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-medium text-foreground">{key}</span>
                  {requiredSet.has(key) && <RequiredBadge />}
                </div>
                <SchemaNode schema={propertySchema} />
              </div>
            ))}
          </div>
        </div>
      )}
      {isRecord && additionalSchema !== null && (
        <div className="mt-2 border-l border-border pl-3">
          <span className="text-xs text-muted-foreground">values</span>
          <div className="mt-1">
            <SchemaNode schema={additionalSchema} />
          </div>
        </div>
      )}
      {displayProperties.length === 0 && !isRecord && (
        <span className="ml-1.5 text-xs italic text-subtle-foreground">empty object</span>
      )}
    </div>
  );
}

function isString(value: JsonValue): value is string {
  return typeof value === "string";
}

/** The semantic type name for a Katari reference-object schema, or null. `{$agent}` → "agent";
 *  `{$ref, as:{const:"file"}}` → "file"; a bare `{$ref}` → "ref". */
function referenceTypeOf(properties: JsonObject | null): string | null {
  if (properties === null) return null;
  if (properties.$agent !== undefined) return "agent";
  if (properties.$ref !== undefined) {
    const as = asObject(properties.as);
    return as?.const === "file" ? "file" : "ref";
  }
  return null;
}

function singleType(node: JsonObject): string | undefined {
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.type)) {
    const nonNull = node.type.filter(
      (entry): entry is string => isString(entry) && entry !== "null",
    );
    if (nonNull.length === 1) return nonNull[0];
  }
  return undefined;
}

function isNeverSchema(node: JsonObject): boolean {
  const not = asObject(node.not);
  if (not !== null && Object.keys(not).length === 0) return true;
  if (Array.isArray(node.anyOf) && node.anyOf.length === 0) return true;
  if (Array.isArray(node.oneOf) && node.oneOf.length === 0) return true;
  return false;
}
