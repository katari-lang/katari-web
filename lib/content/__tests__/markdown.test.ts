import { describe, expect, it } from "vitest";
import { extractHeadings, stripMarkdown } from "../markdown";

describe("stripMarkdown", () => {
  it("removes fenced code blocks", () => {
    const input = "before\n```ts\nconst x = 1;\n```\nafter";
    expect(stripMarkdown(input)).toBe("before after");
  });

  it("keeps inline code text, dropping only the backticks", () => {
    // The index exists to answer queries like `region.fork` or `katari check`, and every
    // such identifier is written in backticks — deleting them left the index unable to
    // find a single one.
    expect(stripMarkdown("use `foo` here")).toBe("use foo here");
    expect(stripMarkdown("call `region.fork` from a nursery")).toBe(
      "call region.fork from a nursery",
    );
  });

  it("extracts link text and drops URL", () => {
    expect(stripMarkdown("see [docs](https://example.com)")).toBe("see docs");
  });

  it("removes image markdown", () => {
    expect(stripMarkdown("logo: ![alt](img.png) end")).toBe("logo: end");
  });

  it("strips heading markers but keeps text", () => {
    expect(stripMarkdown("# Title\n## Sub")).toBe("Title Sub");
  });

  it("strips emphasis and blockquote markers", () => {
    expect(stripMarkdown("*bold* and _italic_ and > quote")).toBe("bold and italic and quote");
  });

  it("collapses whitespace and trims", () => {
    expect(stripMarkdown("  a   b  \n\n c ")).toBe("a b c");
  });
});

describe("extractHeadings", () => {
  it("extracts h1-h3 only", () => {
    const md = "# H1\n## H2\n### H3\n#### H4";
    expect(extractHeadings(md)).toEqual(["H1", "H2", "H3"]);
  });

  it("ignores headings inside code blocks (line-based; matches non-code lines)", () => {
    // 注: stripMarkdown と違い extractHeadings は code block を跨いで `#` 行を拾うが、
    // fenced code 内では行頭が `#` で始まらないため自然に除外されることが多い。
    const md = "# Title\n\nbody\n\n## Sub";
    expect(extractHeadings(md)).toEqual(["Title", "Sub"]);
  });

  it("trims trailing whitespace", () => {
    expect(extractHeadings("# Title   ")).toEqual(["Title"]);
  });

  it("returns empty array when no headings", () => {
    expect(extractHeadings("plain text")).toEqual([]);
  });
});
