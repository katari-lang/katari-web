import { describe, expect, it } from "vitest";
import { buildModuleToPackage, resolveDeclarationHref } from "../links";

const moduleToPackage = buildModuleToPackage([
  {
    name: "prelude",
    version: "0.1.0",
    modules: ["prelude", "prelude.json", "prelude.reflection"],
  },
  { name: "ai", version: "0.1.0", modules: ["ai", "ai.types"] },
]);

describe("buildModuleToPackage", () => {
  it("maps every module of every package", () => {
    expect(moduleToPackage["prelude.json"]).toBe("prelude");
    expect(moduleToPackage["ai.types"]).toBe("ai");
  });
});

describe("resolveDeclarationHref", () => {
  it("splits a resolved name into the longest known module prefix and the declaration", () => {
    expect(resolveDeclarationHref(moduleToPackage, "prelude.json.parse_error")).toBe(
      "/reference/prelude#prelude.json.parse_error",
    );
    expect(resolveDeclarationHref(moduleToPackage, "ai.types.message")).toBe(
      "/reference/ai#ai.types.message",
    );
  });

  it("resolves declarations of a root module whose name prefixes its submodules", () => {
    // "prelude.json" is both a module and a declaration (prelude.json.json the type lives
    // beside it); the declaration "json" in module "prelude" must still resolve.
    expect(resolveDeclarationHref(moduleToPackage, "prelude.throw")).toBe(
      "/reference/prelude#prelude.throw",
    );
  });

  it("returns null for modules outside the generated reference", () => {
    expect(resolveDeclarationHref(moduleToPackage, "somewhere.else")).toBeNull();
    expect(resolveDeclarationHref(moduleToPackage, "nodots")).toBeNull();
  });
});
