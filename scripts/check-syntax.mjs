#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const includedDirs = ["src", "tests", "scripts"];

const collectMjsFiles = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...collectMjsFiles(absolute));
      continue;
    }
    if (entry.endsWith(".mjs")) {
      files.push(absolute);
    }
  }
  return files;
};

const files = includedDirs.flatMap((dir) => collectMjsFiles(path.join(root, dir)));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(`Checked ${files.length} JavaScript files.\n`);
