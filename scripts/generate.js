#!/usr/bin/env node
// Writes the collector's configuration and the participants page from
// collector/allowlist.json, so the filter and the page that describes it
// cannot disagree. `--check` writes nothing and fails when either is stale.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectorConfig, participantsPage, readAllowlist } from "../src/generate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowlist = readAllowlist(root);
const outputs = {
  "collector/otelcol.yaml": collectorConfig(allowlist),
  "docs/participants.md": participantsPage(allowlist),
};

const check = process.argv.includes("--check");
let stale = false;
for (const [file, text] of Object.entries(outputs)) {
  const target = new URL(`../${file}`, import.meta.url);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
  if (current === text) continue;
  if (check) {
    console.error(`${file} is out of date: run npm run generate`);
    stale = true;
  } else {
    fs.writeFileSync(target, text);
    console.log(`wrote ${file}`);
  }
}
process.exitCode = stale ? 1 : 0;
