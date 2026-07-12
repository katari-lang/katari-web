import { getDoc } from "@/lib/content";
import { extractDocSlug, resolveDocHref, type MdxBuildContext } from "@/lib/mdx/resolve-href";
import { FeatureCard } from "@/components/site/feature-card";

type DocCardProps = {
  href: string;
  title?: string;
  description?: string;
};

// `<DocCard>` をビルドするファクトリ。MDX compile 側で ctx を bind して components map に渡す。
// 同 doc 内の参照では title / description を frontmatter から自動取得する。
export function makeDocCard(ctx: MdxBuildContext) {
  return function DocCard({ href, title, description }: DocCardProps) {
    const resolved = resolveDocHref(href, ctx);
    const docRef = extractDocSlug(resolved);

    let resolvedTitle = title;
    let resolvedDescription = description;

    if (docRef && (resolvedTitle === undefined || resolvedDescription === undefined)) {
      const doc = getDoc(docRef.version, docRef.slug);
      if (doc) {
        resolvedTitle ??= doc.frontmatter.title;
        resolvedDescription ??= doc.frontmatter.description;
      } else {
        console.warn(`[DocCard] href "${href}" → "${resolved}" not found`);
      }
    }

    if (!resolvedTitle) {
      // フォールバック: タイトルが解決できない (リンク切れ + props 未指定) → 素朴なリンク
      return (
        <a href={resolved} className="font-medium text-foreground underline underline-offset-4">
          {href}
        </a>
      );
    }

    return <FeatureCard href={resolved} title={resolvedTitle} description={resolvedDescription} />;
  };
}

export function DocCards({ children }: { children: React.ReactNode }) {
  return <div className="my-6 grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}
