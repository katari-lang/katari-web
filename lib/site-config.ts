export const siteConfig = {
  name: "Katari",
  // ロゴはここで参照されます。public/ 直下の差し替えで切り替え可能。
  // SVG は mask-image として使われ、塗りはテーマトークン (foreground) で行う。
  logo: "/katari.svg",
  description: "A language for orchestrating agents.",
  url: "https://katari-lang.dev",
  // <html lang="..."> に流す BCP 47 言語タグ。i18n は導入していない。
  locale: "en",
  copyright: "yukikurage",
  copyrightYear: 2026,
  github: "https://github.com/katari-lang/katari",
  // ヘッダーのナビ。docs 以外のページが増えたら追記。
  // `{latest}` は render 時に最新バージョンに展開される (Header / Footer 共通)。
  nav: [
    { label: "Docs", href: "/docs/{latest}/getting-started" },
    { label: "Packages", href: "/packages" },
  ],
  // フッターの link 群。
  footerLinks: [
    {
      heading: "Project",
      items: [
        {
          label: "GitHub",
          href: "https://github.com/katari-lang/katari",
          external: true,
        },
        {
          label: "License",
          href: "https://github.com/katari-lang/katari/blob/main/LICENSE",
          external: true,
        },
      ],
    },
    {
      heading: "Docs",
      // `{latest}` は Footer が render 時に最新バージョンに置換する。
      items: [
        { label: "Getting Started", href: "/docs/{latest}/getting-started" },
        { label: "Why Katari", href: "/docs/{latest}/getting-started/why-katari" },
        { label: "Concepts", href: "/docs/{latest}/concepts/effects-and-handlers" },
        { label: "Toolchain", href: "/docs/{latest}/toolchain/cli" },
      ],
    },
    {
      heading: "Community",
      items: [
        {
          label: "Issues",
          href: "https://github.com/katari-lang/katari/issues",
          external: true,
        },
        {
          label: "Discussions",
          href: "https://github.com/katari-lang/katari/discussions",
          external: true,
        },
      ],
    },
  ],
} as const;

export type SiteConfig = typeof siteConfig;

/** `{latest}` プレースホルダを最新バージョンに置換する。Header / Footer 共通。 */
export function resolveSiteHref(href: string, latestVersion: string): string {
  return href.replaceAll("{latest}", latestVersion);
}
