#!/usr/bin/env node
// ESLint's flat config (and typescript-eslint's projectService/allowDefaultProject
// globs) resolve relative to the process cwd, so eslint must be invoked from
// inside each package directory — not from the repo root with root-relative
// paths — for the per-package eslint.config.js to apply correctly.
import { spawnSync } from "node:child_process";
import path from "node:path";

const PACKAGE_ROOTS = [
  "apps/api",
  "apps/bot",
  "apps/web",
  "apps/worker",
  "packages/db",
  "packages/hyperliquid-sdk",
  "packages/shared",
];

const repoRoot = process.cwd();
const files = process.argv.slice(2);

const groups = new Map();
for (const file of files) {
  const relFromRoot = path.relative(repoRoot, file);
  const root = PACKAGE_ROOTS.find((r) => relFromRoot.startsWith(r + path.sep));
  if (!root) continue;
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(path.relative(root, relFromRoot));
}

let failed = false;
for (const [root, relFiles] of groups) {
  const result = spawnSync(path.join("node_modules", ".bin", "eslint"), ["--fix", ...relFiles], {
    cwd: path.join(repoRoot, root),
    stdio: "inherit",
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
