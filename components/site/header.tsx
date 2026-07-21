import Link from "next/link";
import { resolveSiteHref, siteConfig } from "@/lib/site-config";
import { latestVersion } from "@/lib/content";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { GithubIcon } from "./icons";
import { McpButton } from "./mcp-button";
import { SearchTrigger } from "@/components/docs/search/search-trigger";
import { HeaderShell } from "./header-shell";

export function Header() {
  let version: string | undefined;
  try {
    version = latestVersion();
  } catch {
    version = undefined;
  }
  // version が解決できない場合は redirect ページを通す fallback。
  const resolveHref = (href: string) => (version ? resolveSiteHref(href, version) : "/docs");

  return (
    <header className="sticky top-0 z-40 w-full">
      <HeaderShell>
        <div className="mx-auto flex h-full w-full max-w-380 items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
          <div className="flex h-full items-center gap-4 py-3 sm:gap-8">
            <Logo size="xl" showText={false} className="h-full w-auto" />
            {/* ナビリンクはモバイルでも常時表示する — 検索バーは虫眼鏡アイコンに畳んで場所を空ける。 */}
            <nav className="flex items-center gap-3 font-display-text text-sm text-muted-foreground sm:gap-4">
              {siteConfig.nav.map((item) => (
                <Link
                  key={item.href}
                  href={resolveHref(item.href)}
                  className="transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
            {version && <SearchTrigger version={version} />}
            <McpButton />
            <Link
              href={siteConfig.github}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:cursor-pointer"
            >
              <GithubIcon className="size-5" />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </HeaderShell>
    </header>
  );
}
