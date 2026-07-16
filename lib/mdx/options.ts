import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import { createHighlighter, type LanguageRegistration } from "shiki";
import katariGrammarRaw from "@katari-lang/language/grammar";

const katariGrammar: LanguageRegistration = {
  ...(katariGrammarRaw as unknown as LanguageRegistration),
  name: "katari",
};

type MdxCompileOptions = NonNullable<NonNullable<MDXRemoteProps["options"]>["mdxOptions"]>;

export const mdxOptions: MdxCompileOptions = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    rehypeSlug,
    [
      rehypeAutolinkHeadings,
      {
        behavior: "wrap",
        properties: { className: ["heading-anchor"] },
      },
    ],
    [
      rehypePrettyCode,
      {
        theme: { light: "github-light", dark: "github-dark" },
        keepBackground: false,
        getHighlighter: (opts: Parameters<typeof createHighlighter>[0]) =>
          createHighlighter({
            ...opts,
            langs: [...(opts?.langs ?? []), katariGrammar],
          }),
      },
    ],
  ],
};
