#!/usr/bin/env node
// Writes, from collector/allowlist.json, the filter `join` installs on a
// participant's machine, the collector's configuration and the participants
// page, so the two filters and the page that describes them cannot disagree.
// `--check` writes nothing and fails when any is stale.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectorConfig, participantsPage, readAllowlist, transformModule } from "../src/generate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowlist = readAllowlist(root);
const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const engine = fs.readFileSync(new URL("../src/rules.js", import.meta.url), "utf8");
const outputs = {
  "src/telemetry-transform.mjs": transformModule(allowlist, version, engine),
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
