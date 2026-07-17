import { describe, expect, it } from "vitest";
import { demoteReadmeHeadings } from "../readme";

describe("demoteReadmeHeadings", () => {
  it("demotes every heading one level", () => {
    const input = "# Title\n\nbody\n\n## Section\n\n### Sub";
    expect(demoteReadmeHeadings(input)).toBe("## Title\n\nbody\n\n### Section\n\n#### Sub");
  });

  it("caps the demotion at h6", () => {
    expect(demoteReadmeHeadings("###### deep")).toBe("###### deep");
  });

  it("leaves fenced code blocks untouched", () => {
    const input = "# Title\n\n```sh\n# a shell comment\n```\n\n## After";
    expect(demoteReadmeHeadings(input)).toBe(
      "## Title\n\n```sh\n# a shell comment\n```\n\n### After",
    );
  });

  it("ignores hash marks that are not headings", () => {
    expect(demoteReadmeHeadings("#no-space")).toBe("#no-space");
  });
});
