import { describe, expect, it } from "vitest";
import { prepareReadme } from "../readme";

describe("prepareReadme", () => {
  it("demotes every heading one level", () => {
    const input = "# Title\n\nbody\n\n## Section\n\n### Sub";
    expect(prepareReadme(input)).toBe("## Title\n\nbody\n\n### Section\n\n#### Sub");
  });

  it("caps the demotion at h6", () => {
    expect(prepareReadme("###### deep")).toBe("###### deep");
  });

  it("leaves fenced code blocks untouched", () => {
    const input = "# Title\n\n```sh\n# a shell comment\n```\n\n## After";
    expect(prepareReadme(input)).toBe(
      "## Title\n\n```sh\n# a shell comment\n```\n\n### After",
    );
  });

  it("ignores hash marks that are not headings", () => {
    expect(prepareReadme("#no-space")).toBe("#no-space");
  });
});

it("rewrites autolinks to explicit links outside fences, not inside", () => {
  const input = "See <https://api.slack.com/apps> now.\n```\nkeep <https://x.test> verbatim\n```";
  const output = prepareReadme(input);
  expect(output).toContain("[https://api.slack.com/apps](https://api.slack.com/apps)");
  expect(output).toContain("keep <https://x.test> verbatim");
});
