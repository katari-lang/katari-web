import { latestVersion } from "@/lib/content";

export type MdxBuildContext = {
  version: string;
  slug: string[];
};

// 拡張可能な変数マップ。キー = 変数名、値 = 現在の ctx を見て展開する関数。
// 将来 `{blog}` 等を足したくなったらここに追加する。
const VARIABLES: Record<string, (ctx: MdxBuildContext) => string> = {
  docs: () => "/docs",
  currentVersion: (ctx) => ctx.version,
  latestVersion: () => latestVersion(),
};

// `{name}` と URL-encoded 形 `%7Bname%7D` の両方を受け入れる。
// MDX/rehype は href を React に渡す前に `{` `}` を percent-encode するため、
// MdxLink から呼ばれた時点では encoded 形になっている。
const VARIABLE_PATTERN = /(?:\{|%7B)([a-zA-Z][a-zA-Z0-9_]*)(?:\}|%7D)/gi;

/**
 * MDX link href の `{name}` 変数を展開する (RFC 6570 風)。
 *
 * 例: `{docs}/{currentVersion}/foo` → `/docs/v0.1/foo`
 *
 * 未定義変数は warn を出して原文のまま残す (build を止めない)。
 * `./` `../` 等の相対パスや `/foo/bar` の bare 絶対パスは **rewrite しない** —
 * 将来 `/blog/...` 等が増えたときの衝突を避けるため。
 */
export function resolveDocHref(href: string, ctx: MdxBuildContext): string {
  return href.replace(VARIABLE_PATTERN, (match, name: string) => {
    const fn = VARIABLES[name];
    if (!fn) {
      console.warn(`[resolveDocHref] unknown variable {${name}} in href "${href}"`);
      return match;
    }
    return fn(ctx);
  });
}

/** 解決後 href が `/docs/<version>/<slug...>` 形式なら slug を抜き出す。 */
export function extractDocSlug(resolved: string): { version: string; slug: string[] } | undefined {
  const match = /^\/docs\/([^/]+)\/(.+?)\/?$/.exec(resolved);
  if (!match) return undefined;
  return { version: match[1]!, slug: match[2]!.split("/") };
}
