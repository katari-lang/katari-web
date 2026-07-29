/**
 * Generate the library reference JSON under content/reference/ from the registry's pinned
 * package set: each pinned package tarball is fetched from codeload, verified against the
 * registry sha256, and run through `katari docs`; the prelude comes from `katari docs --stdlib`.
 *
 * The outputs are committed files, in the same spirit as the pins themselves: the reference
 * describes an explicitly bumped language state, and CI stays pure-node.
 *
 * Environment:
 *   KATARI_REGISTRY_DIR — registry checkout (default: ../katari-registry)
 *   KATARI_BIN          — katari CLI binary (default: "katari" on PATH)
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PackageDocs, ReferenceIndex, ReferenceIndexEntry } from "../lib/reference/types";

const registryDir =
  process.env.KATARI_REGISTRY_DIR ?? path.join(process.cwd(), "..", "katari-registry");
const katariBin = process.env.KATARI_BIN ?? "katari";
const outDir = path.join(process.cwd(), "content", "reference");

// `katari docs` output for a package runs to a few megabytes of JSON on stdout.
const EXEC_OPTIONS = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 } as const;

type PackagePin = { version: string; repo: string; ref: string; sha256: string };

/** Parse the `[packages.<name>]` sections of a package-set TOML. Only the subset the
 *  registry actually writes is supported: sections and `key = "string"` lines. */
function parsePackagePins(source: string, filePath: string): Map<string, Partial<PackagePin>> {
  const pins = new Map<string, Partial<PackagePin>>();
  let current: Partial<PackagePin> | null = null;
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      const packageSection = section[1]!.match(/^packages\.([A-Za-z0-9_-]+)$/);
      current = packageSection ? {} : null;
      if (packageSection) pins.set(packageSection[1]!, current!);
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/);
    if (!pair) {
      // Top-level scalars (katari_compiler) fall here with current === null; inside a
      // package section an unrecognized line means the format moved under us — fail loudly.
      if (current !== null) {
        throw new Error(`${filePath}:${index + 1}: unrecognized line in package section: ${line}`);
      }
      continue;
    }
    if (current !== null) {
      current[pair[1] as keyof PackagePin] = pair[2]!;
    }
  }
  return pins;
}

function requirePin(name: string, partial: Partial<PackagePin>): PackagePin {
  for (const key of ["version", "repo", "ref", "sha256"] as const) {
    if (partial[key] === undefined) {
      throw new Error(`packages.${name} is missing "${key}" in the package set`);
    }
  }
  return partial as PackagePin;
}

function runKatariDocs(cliArguments: string[], label: string): PackageDocs {
  let stdout: string;
  try {
    stdout = execFileSync(katariBin, ["docs", ...cliArguments], EXEC_OPTIONS);
  } catch (error) {
    throw new Error(`katari docs failed for ${label} (KATARI_BIN=${katariBin})`, {
      cause: error,
    });
  }
  const docs = JSON.parse(stdout) as PackageDocs;
  if (docs.katariDocsVersion !== 1) {
    throw new Error(
      `katari docs emitted katariDocsVersion ${docs.katariDocsVersion} for ${label}; this pipeline understands version 1`,
    );
  }
  return docs;
}

async function fetchTarball(name: string, pin: PackagePin): Promise<Buffer> {
  // codeload serves the archive of the pinned commit; derive the host from the pinned repo
  // URL rather than re-assuming the naming convention.
  const url = `${pin.repo.replace("https://github.com/", "https://codeload.github.com/")}/tar.gz/${pin.ref}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} → ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256) {
    throw new Error(
      `sha256 mismatch for ${name}@${pin.version}: registry pins ${pin.sha256}, got ${digest}`,
    );
  }
  return bytes;
}

async function generatePackageDocs(
  name: string,
  pin: PackagePin,
  workDir: string,
): Promise<{ docs: PackageDocs; readme: string | null }> {
  const tarballPath = path.join(workDir, `${name}.tar.gz`);
  const sourceDir = path.join(workDir, name);
  fs.writeFileSync(tarballPath, await fetchTarball(name, pin));
  fs.mkdirSync(sourceDir, { recursive: true });
  // The archive has a single `katari-package-<name>-<ref>/` root; strip it away.
  execFileSync("tar", ["-xzf", tarballPath, "-C", sourceDir, "--strip-components=1"]);
  // A package with registry dependencies ships a lock but not the cache behind it — `docs`
  // resolves offline from the lock, so fetch the closure into the fresh checkout first.
  // (No-op for dependency-free packages; `lock` verifies the existing pins either way.)
  try {
    execFileSync(katariBin, ["lock", "-C", sourceDir], EXEC_OPTIONS);
  } catch (error) {
    throw new Error(`katari lock failed for ${name}@${pin.version} (KATARI_BIN=${katariBin})`, {
      cause: error,
    });
  }
  const docs = runKatariDocs(["-C", sourceDir], `${name}@${pin.version}`);
  if (docs.package.name !== name) {
    throw new Error(`packages.${name} pin produced docs for package "${docs.package.name}"`);
  }
  if (docs.package.version !== pin.version) {
    // The reference states what the pinned source says about itself; the registry entry
    // disagreeing is a registry problem, surfaced but not fatal.
    console.warn(
      `[reference] warning: registry pins ${name}@${pin.version} but its katari.toml says ${docs.package.version}`,
    );
  }
  const readmePath = path.join(sourceDir, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : null;
  return { docs, readme };
}

function writeDocs(docs: PackageDocs): Omit<ReferenceIndexEntry, "hasReadme"> {
  const outPath = path.join(outDir, `${docs.package.name}.json`);
  // Compact JSON: these files are committed, and pretty-printing multiplies them ~4x.
  fs.writeFileSync(outPath, `${JSON.stringify(docs)}\n`);
  const declarationCount = docs.modules.reduce(
    (count, module) => count + module.declarations.length,
    0,
  );
  console.log(
    `[reference] ${docs.package.name}@${docs.package.version}: ${docs.modules.length} modules, ${declarationCount} declarations → ${path.relative(process.cwd(), outPath)}`,
  );
  return {
    name: docs.package.name,
    version: docs.package.version,
    modules: docs.modules.map((module) => module.name),
  };
}

async function main() {
  const packageSetPath = path.join(registryDir, "package-sets", "staging.toml");
  const pins = parsePackagePins(fs.readFileSync(packageSetPath, "utf8"), packageSetPath);

  fs.mkdirSync(outDir, { recursive: true });
  // The readme mirror is rebuilt from scratch, so a package that drops its README on a pin
  // bump also drops its copy here.
  const readmeDir = path.join(outDir, "readme");
  fs.rmSync(readmeDir, { recursive: true, force: true });
  fs.mkdirSync(readmeDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "katari-reference-"));
  try {
    const index: ReferenceIndex = { packages: [] };
    // The prelude leads the index; registry packages follow in name order. The prelude comes
    // from the compiler binary, not a tarball, so it has no README to mirror.
    index.packages.push({ ...writeDocs(runKatariDocs(["--stdlib"], "prelude")), hasReadme: false });
    for (const name of [...pins.keys()].sort()) {
      const pin = requirePin(name, pins.get(name)!);
      const { docs, readme } = await generatePackageDocs(name, pin, workDir);
      if (readme !== null) {
        const readmePath = path.join(readmeDir, `${name}.md`);
        fs.writeFileSync(readmePath, readme);
        console.log(`[reference] ${name}: README.md → ${path.relative(process.cwd(), readmePath)}`);
      }
      index.packages.push({ ...writeDocs(docs), hasReadme: readme !== null });
    }
    const indexPath = path.join(outDir, "index.json");
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    console.log(
      `[reference] index: ${index.packages.length} packages → ${path.relative(process.cwd(), indexPath)}`,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
