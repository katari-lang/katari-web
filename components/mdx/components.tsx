import Link from "next/link";
import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";
import { CodeBlockPre } from "@/components/mdx/code-block-figure";
import { DocCards, makeDocCard } from "@/components/mdx/doc-card";
import { resolveDocHref, type MdxBuildContext } from "@/lib/mdx/resolve-href";

// ルートではなく静的アセットを指すパス (`/llms.txt` 等)。next/link に渡すと
// クライアントルーターがルートとして解決しようとして壊れるので、素の <a> で出す。
// 判定は「最後のセグメントに拡張子があるか」。ルートの slug に `.` は使っていない。
function isStaticAssetHref(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  return /\.[a-z0-9]+$/i.test(lastSegment);
}

function isInternalHref(href: string): boolean {
  // `/`, `./`, `../`, `#` で始まるものを内部リンク扱い (next/link 経由)。
  // それ以外 (http://, mailto:, tel: 等) は外部リンク。
  return (
    href.startsWith("/") || href.startsWith("#") || href.startsWith("./") || href.startsWith("../")
  );
}

function makeMdxLink(ctx: MdxBuildContext) {
  return function MdxLink({ href = "", ...rest }: ComponentProps<"a">) {
    const resolved = resolveDocHref(href, ctx);
    if (isInternalHref(resolved)) {
      // 同一オリジンの静的ファイルは新規タブに飛ばさず、素の <a> で普通に開かせる。
      if (isStaticAssetHref(resolved)) {
        return <a href={resolved} {...rest} />;
      }
      return <Link href={resolved} {...rest} />;
    }
    return <a href={resolved} target="_blank" rel="noopener noreferrer" {...rest} />;
  };
}

// MDX に渡す components map を ctx 込みで構築する。
// MdxLink / DocCard は現在 doc の (version, slug) を closure で保持し、`{name}` 変数を解決する。
export function buildMdxComponents(ctx: MdxBuildContext): MDXComponents {
  const MdxLink = makeMdxLink(ctx);
  const DocCard = makeDocCard(ctx);
  return {
    h1: (props) => (
      <h1
        className="mt-8 scroll-mt-24 text-3xl font- font-bold tracking-tight first:mt-0"
        {...props}
      />
    ),
    h2: (props) => (
      <h2 className="mt-10 scroll-mt-24 pb-2 text-2xl font-semibold tracking-tight" {...props} />
    ),
    h3: (props) => (
      <h3 className="mt-8 scroll-mt-24 text-xl font-semibold tracking-tight" {...props} />
    ),
    h4: (props) => (
      <h4 className="mt-6 scroll-mt-24 text-lg font-semibold tracking-tight" {...props} />
    ),
    p: (props) => <p className="mt-4 leading-7" {...props} />,
    a: (props) => (
      <MdxLink className="font-medium text-foreground underline underline-offset-4" {...props} />
    ),
    ul: (props) => <ul className="mt-4 ml-6 list-disc space-y-1.5" {...props} />,
    ol: (props) => <ol className="mt-4 ml-6 list-decimal space-y-1.5" {...props} />,
    li: (props) => <li className="leading-7" {...props} />,
    blockquote: (props) => (
      <blockquote className="mt-6 border-l border-border-strong pl-4 italic" {...props} />
    ),
    hr: (props) => <hr className="my-8 border-border" {...props} />,
    table: (props) => (
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm" {...props} />
      </div>
    ),
    th: (props) => (
      <th className="border border-border bg-muted px-3 py-2 text-left font-semibold" {...props} />
    ),
    td: (props) => <td className="border border-border px-3 py-2" {...props} />,
    // rehype-pretty-code が生成する <pre> (data-language 付き) は CodeBlockPre で
    // wrap してコピーボタンを右上に表示する。素の <pre> は素通し。
    pre: (props) => {
      const isCodeBlock = "data-language" in (props as Record<string, unknown>);
      if (isCodeBlock) {
        return <CodeBlockPre {...props} />;
      }
      return <pre {...props} />;
    },
    // インラインコード。コードブロック (language-* クラス付き) には何もしない。
    code: ({ className, ...rest }) => {
      const isBlock = "data-language" in (rest as Record<string, unknown>);
      if (isBlock) {
        return <code className={className} {...rest} />;
      }
      return (
        <code
          className={`px-1.5 py-0.5 font-mono text-sm bg-muted/50 border border-border ${className ?? ""}`}
          {...rest}
        />
      );
    },
    DocCard,
    DocCards,
  };
}
