#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const [pack] = JSON.parse(result.stdout);
const files = pack.files.map((entry) => entry.path);
const forbiddenPatterns = [
  /^node_modules\//,
  /^tests\//,
  /^\.github\//,
  /^\.agents\//,
  /(^|\/)\.env(\.|$)/,
  /namecheap-auth\.json$/,
  /\.tgz$/,
];

const forbiddenFiles = files.filter((file) =>
  forbiddenPatterns.some((pattern) => pattern.test(file)),
);

if (forbiddenFiles.length > 0) {
  process.stderr.write(
    `Package dry run included forbidden files:\n${forbiddenFiles.join("\n")}\n`,
  );
  process.exit(1);
}

const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "src/cli.mjs",
  "src/index.mjs",
  "src/tools/namecheap/client.mjs",
  "src/tools/railway/client.mjs",
  "src/tools/npm/client.mjs",
];

const missingFiles = requiredFiles.filter((file) => !files.includes(file));
if (missingFiles.length > 0) {
  process.stderr.write(
    `Package dry run missed required files:\n${missingFiles.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Package dry run validated ${files.length} files for ${pack.name}@${pack.version}.\n`,
);
