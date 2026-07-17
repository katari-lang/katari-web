import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { compileMDX } from "next-mdx-remote/rsc";
import { latestVersion } from "@/lib/content";
import { mdxOptions } from "@/lib/mdx/options";
import { getPackageDocs, getPackageReadme, listReferencePackages } from "@/lib/reference/data";
import { buildModuleToPackage } from "@/lib/reference/links";
import { prepareReadme } from "@/lib/reference/readme";
import { buildMdxComponents } from "@/components/mdx/components";
import { SidebarScrollContainer } from "@/components/docs/sidebar-scroll-container";
import { DeclarationCard } from "@/components/reference/declaration-card";

type Props = {
  params: Promise<{ package: string }>;
};

export function generateStaticParams() {
  return listReferencePackages().map((entry) => ({ package: entry.name }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { package: packageName } = await params;
  const docs = getPackageDocs(packageName);
  if (!docs) return {};
  const title = `${docs.package.name} ${docs.package.version} — Reference`;
  const description = `API reference for the ${docs.package.name} package: ${docs.modules
    .map((module) => module.name)
    .join(", ")}.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
  };
}

export default async function ReferencePackagePage({ params }: Props) {
  const { package: packageName } = await params;
  const docs = getPackageDocs(packageName);
  if (!docs) notFound();

  // 全パッケージの module 一覧から解決マップを作る — 宣言リンクはパッケージ横断。
  const moduleToPackage = buildModuleToPackage(listReferencePackages());

  // パッケージ tarball の README を docs と同じ MDX パイプラインで冒頭の Overview に描く。
  // katari コードブロックのハイライトも同じ経路で効く。ctx の (version, slug) は `{docs}`
  // 変数リンクの解決用で、README がそれを使うことは想定しない — 最新 docs version を既定にする。
  const readme = getPackageReadme(packageName);
  const overview =
    readme === undefined
      ? null
      : (
          await compileMDX({
            source: prepareReadme(readme),
            components: buildMdxComponents({ version: latestVersion(), slug: [] }),
            options: { mdxOptions },
          })
        ).content;

  const sidebar = (
    <nav aria-label="Module navigation" className="space-y-6">
      <Link
        href="/reference"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All packages
      </Link>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Package
        </p>
        <p className="font-mono text-sm text-foreground">
          {docs.package.name} <span className="text-muted-foreground">v{docs.package.version}</span>
        </p>
      </div>
      {overview !== null && (
        <a
          href="#overview"
          className="block text-sm font-display-text font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Overview
        </a>
      )}
      <div className="space-y-2">
        <p className="text-sm font-display-text font-semibold">Modules</p>
        <ul className="space-y-1 border-l border-border">
          {docs.modules.map((module) => (
            <li key={module.name}>
              <a
                href={`#${module.name}`}
                className="-ml-px block border-l border-transparent py-1 pl-4 font-mono text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {module.name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );

  return (
    <div className="mx-auto w-full max-w-380 px-4 sm:px-6 lg:px-8">
      <div aria-hidden className="fixed inset-0 -z-4 bg-background/80" />
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden py-10 lg:block">
          <SidebarScrollContainer>{sidebar}</SidebarScrollContainer>
        </aside>
        <div className="py-8 lg:py-10">
          <details className="mb-6 lg:hidden">
            <summary className="cursor-pointer bg-muted px-3 py-2 text-sm font-medium">
              Browse modules
            </summary>
            <div className="mt-3 p-4">{sidebar}</div>
          </details>
          <article className="mx-auto max-w-4xl">
            <header className="mb-8 space-y-4 border-b border-border pb-4">
              <h1 className="font-mono text-4xl font-bold tracking-tight text-highlight">
                {docs.package.name}
              </h1>
              <p className="text-base text-muted-foreground">
                v{docs.package.version} · compiled with katari {docs.compiler}
              </p>
            </header>
            <div className="space-y-12">
              {overview !== null && (
                <section id="overview" className="scroll-mt-24">
                  <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
                    <h2 className="text-2xl font-display-text font-semibold text-foreground">
                      Overview
                    </h2>
                    <span className="text-xs text-subtle-foreground">from the package README</span>
                  </div>
                  <div className="prose-content mt-4">{overview}</div>
                </section>
              )}
              {docs.modules.map((module) => (
                <section key={module.name} id={module.name} className="scroll-mt-24">
                  <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2">
                    <h2 className="font-mono text-2xl font-semibold text-foreground">
                      {module.name}
                    </h2>
                    <span className="text-xs text-subtle-foreground">
                      {module.declarations.length} declarations
                    </span>
                  </div>
                  <div className="mt-4 space-y-4">
                    {module.declarations.map((declaration) => (
                      <DeclarationCard
                        key={declaration.name}
                        moduleName={module.name}
                        declaration={declaration}
                        moduleToPackage={moduleToPackage}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
