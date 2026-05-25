import { getNavigation, latestVersion, listVersions } from "@/lib/content";
import { Sidebar } from "@/components/docs/sidebar";
import { SidebarScrollContainer } from "@/components/docs/sidebar-scroll-container";
import { VersionFallbackRedirect } from "@/components/docs/version-fallback-redirect";

type Props = {
  children: React.ReactNode;
  params: Promise<{ version: string }>;
};

export default async function DocsVersionLayout({ children, params }: Props) {
  const { version } = await params;
  const versions = listVersions();
  if (!versions.includes(version)) {
    return <VersionFallbackRedirect latestVersion={latestVersion()} />;
  }
  const nav = getNavigation(version);

  return (
    <div className="mx-auto w-full max-w-380 px-4 sm:px-6 lg:px-8">
      <div aria-hidden className="fixed inset-0 -z-4 bg-background/80" />
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden py-10 lg:block">
          <SidebarScrollContainer>
            <Sidebar versions={versions} nav={nav} />
          </SidebarScrollContainer>
        </aside>
        <div className="py-8 lg:py-10">
          <details className="mb-6 lg:hidden">
            <summary className="cursor-pointer bg-muted px-3 py-2 text-sm font-medium">
              Browse documentation
            </summary>
            <div className="mt-3 p-4">
              <Sidebar versions={versions} nav={nav} />
            </div>
          </details>
          {children}
        </div>
      </div>
    </div>
  );
}
