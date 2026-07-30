/**
 * 検索インデックス生成のためにマークダウンをプレーンテキスト化する。
 * 完璧な markdown parser ではなく、検索索引に乗せて困らないノイズ除去が目的。
 */
export function stripMarkdown(md: string): string {
  return (
    md
      // fenced code
      .replace(/```[\s\S]*?```/g, " ")
      // inline code: KEEP the text, drop only the backticks. Every identifier a reader
      // searches for — `region.fork`, `use handler`, `katari check`, a K-code — is written
      // in backticks, so deleting these made the index unable to answer the queries it
      // exists for.
      .replace(/`([^`]*)`/g, "$1")
      // images
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      // links: [text](url) → text
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      // headings markers / emphasis / blockquote / hr
      .replace(/^#+\s+/gm, "")
      .replace(/[*_~>]+/g, "")
      .replace(/^---+$/gm, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** 見出しレベル 1-3 のテキストを抽出する (検索インデックス用)。 */
export function extractHeadings(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      out.push(match[2]!.trim());
    }
  }
  return out;
}
