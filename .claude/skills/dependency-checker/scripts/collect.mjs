#!/usr/bin/env node
// Deterministic data collector for the dependency-checker skill. Offline,
// read-only. Prints one JSON document to stdout; the skill turns it into the
// report. Usage: node collect.mjs [repoRoot] [--pkg=server,client]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());
const only = (args.find((a) => a.startsWith("--pkg=")) ?? "").slice(6).split(",").filter(Boolean);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "clones", ".claude", "docs", "specs"]);
const SRC_EXT = /\.(?:[cm]?[jt]sx?)$/;

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
};

// tsconfig allows comments; strip only unambiguous ones (a `/*` inside a
// "paths" string like "./src/*" must survive).
const readTsconfig = (p) => {
  try {
    const raw = fs.readFileSync(p, "utf8")
      .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw);
  } catch { return null; }
};

// --- discovery -------------------------------------------------------------
const packages = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith("."))
  .map((d) => ({ dir: path.join(root, d.name), folder: d.name, manifest: readJson(path.join(root, d.name, "package.json")) }))
  .filter((p) => p.manifest && (!only.length || only.includes(p.folder)));

// --- size helpers ----------------------------------------------------------
const sizeCache = new Map();
function dirBytes(dir) {
  if (sizeCache.has(dir)) return sizeCache.get(dir);
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      // pnpm: sibling deps live next to the package as symlinks — never follow.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue; // nested copies counted when resolved
        stack.push(full);
      } else {
        try { total += fs.statSync(full).size; } catch { /* ignore */ }
      }
    }
  }
  sizeCache.set(dir, total);
  return total;
}

// Node-style resolution from a package's *real* path, so it works for npm's
// hoisted layout and pnpm's symlinked .pnpm store alike.
function resolvePkg(name, fromDir) {
  let cur = fromDir;
  for (;;) {
    const cand = path.join(cur, "node_modules", name);
    if (fs.existsSync(path.join(cand, "package.json"))) return fs.realpathSync(cand);
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function closure(name, fromDir) {
  // returns Map<realDir, {name, version, bytes}> for name and all transitive deps
  const seen = new Map();
  const walk = (n, from) => {
    const real = resolvePkg(n, from);
    if (!real || seen.has(real)) return;
    const m = readJson(path.join(real, "package.json")) ?? {};
    seen.set(real, { name: m.name ?? n, version: m.version ?? "?", bytes: dirBytes(real) });
    for (const dep of Object.keys({ ...m.dependencies, ...m.optionalDependencies })) walk(dep, real);
  };
  walk(name, fromDir);
  return seen;
}

// --- usage scan (heuristic) ------------------------------------------------
function importedSpecifiers(pkgDir) {
  const found = new Map(); // specifier root -> count of files
  const texts = [];
  const stack = [pkgDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(path.join(cur, e.name)); continue; }
      if (!SRC_EXT.test(e.name)) continue;
      const text = fs.readFileSync(path.join(cur, e.name), "utf8");
      texts.push(text);
      // statement-anchored so prose inside comments/strings is not mistaken for an import
      const re = /(?:^\s*(?:import|export)\b[^"'`;]*?\bfrom\s+|^\s*import\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([a-z@][\w@.\-]*(?:\/[\w.\-]+)*)["']/gm;
      const mine = new Set();
      for (let m; (m = re.exec(text));) {
        const s = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
        mine.add(s);
      }
      for (const s of mine) found.set(s, (found.get(s) ?? 0) + 1);
    }
  }
  found.texts = texts;
  return found;
}

// tools that are driven by a CLI, a framework or a string name, never imported
const IMPLICIT = new Set(["typescript", "tsx", "react-dom", "pino-pretty", "drizzle-kit", "vitest", "@vitest/coverage-v8", "tailwindcss", "postcss", "autoprefixer"]);

function configMentions(pkgDir) {
  // deps used only by tooling config (vitest.config, next.config, scripts in package.json)
  let blob = JSON.stringify(readJson(path.join(pkgDir, "package.json"))?.scripts ?? {});
  for (const f of fs.readdirSync(pkgDir)) if (/\.config\.[cm]?[jt]s$/.test(f) || /^\.?(eslint|postcss|tailwind)/.test(f)) {
    try { blob += fs.readFileSync(path.join(pkgDir, f), "utf8"); } catch { /* ignore */ }
  }
  return blob;
}

// --- per-package analysis --------------------------------------------------
const pkgIndex = new Map(packages.map((p) => [p.folder, p]));
const out = { root, generatedAt: new Date().toISOString(), packages: [], internalEdges: [], drift: [], duplicates: [], totals: {} };

for (const p of packages) {
  const m = p.manifest;
  const manager = fs.existsSync(path.join(p.dir, "pnpm-lock.yaml")) ? "pnpm"
    : fs.existsSync(path.join(p.dir, "package-lock.json")) ? "npm" : "unknown";
  const installed = fs.existsSync(path.join(p.dir, "node_modules"));
  const used = importedSpecifiers(p.dir);
  const cfg = configMentions(p.dir);

  const deps = [];
  const groups = { dependencies: "prod", devDependencies: "dev", optionalDependencies: "optional", peerDependencies: "peer" };
  const allUnique = new Map();
  for (const [field, kind] of Object.entries(groups)) {
    for (const [name, range] of Object.entries(m[field] ?? {})) {
      let own = null, transitive = null, transitiveCount = null, version = null;
      if (installed && field !== "peerDependencies") {
        const c = closure(name, p.dir);
        if (c.size) {
          const real = resolvePkg(name, p.dir);
          own = c.get(real)?.bytes ?? null;
          version = c.get(real)?.version ?? null;
          transitive = [...c.values()].reduce((s, x) => s + x.bytes, 0);
          transitiveCount = c.size - 1;
          for (const [k, v] of c) allUnique.set(k, v);
        }
      }
      const types = name.startsWith("@types/");
      const importedAs = used.get(name) ?? (types ? used.get(name.replace("@types/", "")) : 0) ?? 0;
      const inConfig = cfg.includes(name) || IMPLICIT.has(name) || used.texts.some((t) => t.includes(`"${name}"`) || t.includes(`'${name}'`));
      deps.push({
        name, kind, range, version, ownBytes: own, totalBytes: transitive, transitiveCount,
        importedInFiles: importedAs || 0,
        unusedCandidate: kind !== "peer" && !importedAs && !inConfig && !types && !name.startsWith("@devdigest/"),
        misplaced: kind === "prod" && (types || /^(vitest|typescript|tsx|drizzle-kit|@vitest|prettier|eslint)/.test(name)) ? "dev-only tool listed in dependencies" : null,
      });
    }
  }
  // imported but undeclared (excluding node builtins, aliases, relative)
  const declared = new Set(Object.keys({ ...m.dependencies, ...m.devDependencies, ...m.optionalDependencies, ...m.peerDependencies }));
  const aliasPrefixes = Object.keys(readTsconfig(path.join(p.dir, "tsconfig.json"))?.compilerOptions?.paths ?? {}).map((k) => k.replace(/\/?\*$/, ""));
  const undeclared = [...used.keys()].filter((s) =>
    !declared.has(s) && !s.startsWith("node:") && !aliasPrefixes.includes(s) && !s.startsWith("@/") && !s.startsWith("~") && !s.startsWith("@shared") &&
    !["fs", "path", "os", "url", "crypto", "http", "https", "child_process", "stream", "util", "events", "zlib", "net", "tls", "readline", "assert", "buffer", "module", "worker_threads", "perf_hooks", "timers", "querystring", "dns", "process"].includes(s));

  deps.sort((a, b) => (b.totalBytes ?? -1) - (a.totalBytes ?? -1));
  out.packages.push({
    folder: p.folder, name: m.name, manager, installed,
    counts: { prod: deps.filter((d) => d.kind === "prod").length, dev: deps.filter((d) => d.kind === "dev").length, optional: deps.filter((d) => d.kind === "optional").length, peer: deps.filter((d) => d.kind === "peer").length },
    uniquePackagesInstalled: allUnique.size,
    installedBytes: installed ? [...allUnique.values()].reduce((s, x) => s + x.bytes, 0) : null,
    deps, undeclaredImports: undeclared.sort(),
  });

  // internal edges from tsconfig path aliases
  const ts = readTsconfig(path.join(p.dir, "tsconfig.json"));
  for (const [alias, targets] of Object.entries(ts?.compilerOptions?.paths ?? {})) {
    const abs = path.resolve(p.dir, targets[0]);
    const rel = path.relative(root, abs).split(path.sep);
    const target = abs.includes(`${path.sep}vendor${path.sep}shared`) ? "shared" : rel[0];
    if (target && target !== p.folder && !out.internalEdges.some((e) => e.from === p.folder && e.to === target))
      out.internalEdges.push({ from: p.folder, to: target, via: alias });
  }
}

// --- cross-package analysis ------------------------------------------------
const byName = new Map();
for (const pk of out.packages) for (const d of pk.deps) {
  if (!byName.has(d.name)) byName.set(d.name, []);
  byName.get(d.name).push({ pkg: pk.folder, range: d.range, version: d.version, kind: d.kind });
}
for (const [name, uses] of byName) {
  if (uses.length < 2) continue;
  out.duplicates.push({ name, packages: uses.map((u) => u.pkg), ranges: [...new Set(uses.map((u) => u.range))] });
  if (new Set(uses.map((u) => u.range)).size > 1) out.drift.push({ name, uses });
}
out.duplicates.sort((a, b) => b.packages.length - a.packages.length);
out.totals = {
  packages: out.packages.length,
  declaredDeps: out.packages.reduce((s, x) => s + x.deps.length, 0),
  installedBytes: out.packages.reduce((s, x) => s + (x.installedBytes ?? 0), 0),
  notInstalled: out.packages.filter((x) => !x.installed).map((x) => x.folder),
};
out.notes = [
  "ownBytes = the package's own files; totalBytes = it plus its whole transitive closure (shared subtrees are counted in each dep, so per-dep totals overlap and do not sum to installedBytes).",
  "installedBytes is de-duplicated per package; sizes are on-disk file bytes, not install/bundle/gzip size.",
  "unusedCandidate is a static-import heuristic: dynamic requires, CLI-only tools and plugin-by-name loading can false-positive — verify before removing.",
];
console.log(JSON.stringify(out, null, 2));
