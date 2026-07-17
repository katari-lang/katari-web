// Types for the `katari docs` JSON contract (katariDocsVersion = 1) and the generated
// reference index. The shape is documented in the katari repo:
// docs/2026-07-17-library-api-reference.md — this file mirrors it 1:1.

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** Structured surface-type tree. Every node carries `rendered`, its own source-syntax text,
 *  so any subtree is copyable without client-side string synthesis. */
export type TypeNode =
  | { node: "primitive"; rendered: string; name: string }
  | { node: "string_literal"; rendered: string; value: string }
  // Bare heads without extra structure.
  | { node: "never" | "unknown" | "all" | "io" | "pure" | "array" | "record"; rendered: string }
  | {
      node: "name";
      rendered: string;
      qualifier: string | null;
      name: string;
      // A fully-qualified "module.name" string for resolved declarations, a generic marker
      // for type parameters, or null when the phase carries no resolution (stdlib is Parsed).
      resolved: string | { generic: string } | null;
    }
  | {
      node: "agent";
      rendered: string;
      parameter: TypeNode;
      return: TypeNode;
      effects: TypeNode | null;
    }
  | { node: "application"; rendered: string; head: TypeNode; arguments: TypeNode[] }
  | { node: "tuple"; rendered: string; elements: TypeNode[] }
  | { node: "union"; rendered: string; branches: TypeNode[] }
  | { node: "object"; rendered: string; fields: ObjectField[] }
  | { node: "attributed"; rendered: string; base: TypeNode; attribute: TypeNode }
  | { node: "attribute_literal"; rendered: string; kind: "public" | "private" }
  | { node: "override"; rendered: string; base: TypeNode; overrides: TypeNode[] };

export type ObjectField = { name: string; optional: boolean; type: TypeNode };

export type DeclarationKind =
  | "agent"
  | "external_agent"
  | "primitive_agent"
  | "request"
  | "marker_effect"
  | "data"
  | "type_synonym";

export type GenericParameter = {
  name: string;
  kind: string;
  bindsLiteral: boolean;
  upperBound: TypeNode | null;
};

export type ParameterDoc = {
  label: string;
  documentation: string | null;
  // Null when the surface syntax has no annotation — `checkedType` carries the inferred truth.
  type: TypeNode | null;
  default: { rendered: string; value: JsonValue } | null;
};

export type RequestSchema = {
  kind: string;
  descriptor: { name: string; input: JsonValue; output: JsonValue };
};

/** Wire view derived from the lowered IR — what the runtime shows to AI. Attached only to
 *  monomorphic agents. */
export type DeclarationSchema = {
  input: JsonValue;
  output: JsonValue;
  requests: RequestSchema[];
  genericBindings: Record<string, JsonValue>;
};

export type Declaration = {
  kind: DeclarationKind;
  name: string;
  // Handle privacy, present on `agent` declarations only.
  private?: boolean;
  documentation: string | null;
  signature: string;
  generics: GenericParameter[];
  parameters: ParameterDoc[];
  returnType: TypeNode | null;
  effects: TypeNode | null;
  // Semantic type with inference and synonym expansion applied — agents only.
  checkedType: string | null;
  // external_agent only.
  reactor: string | null;
  // type_synonym only.
  definition: TypeNode | null;
  schema: DeclarationSchema | null;
};

export type DocsModule = { name: string; declarations: Declaration[] };

export type PackageDocs = {
  katariDocsVersion: number;
  compiler: string;
  package: { name: string; version: string };
  modules: DocsModule[];
};

export type ReferenceIndexEntry = { name: string; version: string; modules: string[] };
export type ReferenceIndex = { packages: ReferenceIndexEntry[] };
