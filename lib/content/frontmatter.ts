import { z } from "zod";

// ドキュメント frontmatter のスキーマ。title は必須・description は任意。
// 余分なキーは strip して許容する。
const docFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

export type DocFrontmatter = z.infer<typeof docFrontmatterSchema>;

const versionMetaSchema = z.object({
  label: z.string().optional(),
  order: z.array(z.string()).optional(),
});

export type VersionMeta = z.infer<typeof versionMetaSchema>;

const categoryMetaSchema = z.object({
  label: z.string().optional(),
  order: z.array(z.string()).optional(),
});

export type CategoryMeta = z.infer<typeof categoryMetaSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * 厳格な frontmatter パース — 失敗時は filePath を含む Error を投げる。
 * build 時に確実に止めたい経路 (getDoc / buildSearchEntries) で使用する。
 */
export function parseDocFrontmatter(raw: unknown, filePath: string): DocFrontmatter {
  const result = docFrontmatterSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid frontmatter in ${filePath}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * 緩い frontmatter パース — 失敗時は undefined を返す。
 * getNavigation のタイトル抽出のように、欠損時は humanize fallback したい場面で使う。
 */
export function tryParseDocFrontmatter(raw: unknown): DocFrontmatter | undefined {
  return docFrontmatterSchema.safeParse(raw).data;
}

export function parseVersionMeta(raw: unknown, filePath: string): VersionMeta {
  const result = versionMetaSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid _meta.json at ${filePath}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export function parseCategoryMeta(raw: unknown, filePath: string): CategoryMeta {
  const result = categoryMetaSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid _meta.json at ${filePath}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}
