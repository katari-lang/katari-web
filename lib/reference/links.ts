// Pure helpers for cross-declaration links: a resolved "module.name" string maps to the
// package page that hosts the module, with the declaration anchor `<module>.<name>`.

import type { ReferenceIndexEntry } from "./types";

/** Module name → package name, over every generated package. `prelude.*` modules live in the
 *  prelude package because that is literally how its modules are named. */
export function buildModuleToPackage(packages: ReferenceIndexEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of packages) {
    for (const moduleName of entry.modules) {
      map[moduleName] = entry.name;
    }
  }
  return map;
}

/** Href for a resolved declaration reference, or null when the module is not part of the
 *  generated reference. Module names are dotted, so we take the longest known module prefix
 *  and treat the remainder as the declaration name. */
export function resolveDeclarationHref(
  moduleToPackage: Record<string, string>,
  resolved: string,
): string | null {
  for (
    let splitAt = resolved.lastIndexOf(".");
    splitAt > 0;
    splitAt = resolved.lastIndexOf(".", splitAt - 1)
  ) {
    const moduleName = resolved.slice(0, splitAt);
    const packageName = moduleToPackage[moduleName];
    if (packageName !== undefined) {
      return `/packages/${packageName}#${resolved}`;
    }
  }
  return null;
}
