import type { Metadata } from "next";
import Link from "next/link";
import { listReferencePackages } from "@/lib/reference/data";

export const metadata: Metadata = {
  title: "Packages",
  description:
    "API reference for the Katari prelude and every package in the registry package set.",
};

// カードに載せる module 名プレビューの上限。それ以上は "+n more" に畳む。
const MODULE_PREVIEW_LIMIT = 5;

export default function PackagesIndexPage() {
  const packages = listReferencePackages();

  return (
    <div className="mx-auto w-full max-w-380 px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl space-y-4 border-b border-border pb-6">
        <h1 className="text-4xl font-display-text font-bold tracking-tight text-highlight">
          Packages
        </h1>
        <p className="text-base text-muted-foreground">
          Every declaration of the Katari prelude and the registry package set — surface types,
          effects, and the wire-facing schemas the runtime shows to AI.
        </p>
      </header>
      {packages.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          No reference data found. Run{" "}
          <code className="font-mono">pnpm run generate:reference</code> to generate it.
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((entry) => (
            <Link
              key={entry.name}
              href={`/packages/${entry.name}`}
              className="flex flex-col gap-3 border border-border p-6 transition-colors hover:border-border-strong hover:bg-muted"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-mono text-lg font-medium text-foreground">{entry.name}</h2>
                <span className="font-mono text-xs text-muted-foreground">v{entry.version}</span>
              </div>
              <ul className="space-y-1 border-l border-border pl-3">
                {entry.modules.slice(0, MODULE_PREVIEW_LIMIT).map((moduleName) => (
                  <li key={moduleName} className="font-mono text-xs text-muted-foreground">
                    {moduleName}
                  </li>
                ))}
                {entry.modules.length > MODULE_PREVIEW_LIMIT && (
                  <li className="text-xs text-subtle-foreground">
                    +{entry.modules.length - MODULE_PREVIEW_LIMIT} more
                  </li>
                )}
              </ul>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
