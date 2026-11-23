#!/usr/bin/env node
// pharo-agent-telemetry generate [--study <directory>] [--check]: writes, from
// the study's allowlist and catalog, the filter `join` installs on a
// participant's machine, the collector's configuration beside a copy of this
// package's collector stack, and the participants page, so the two filters
// and the page that describes them cannot disagree. --check writes nothing
// and fails when any is stale.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { collectorConfig, participantsPage, transformModule } from "../src/generate.js";
import { readAllowlist, readStudy, studyFiles } from "../src/study.js";

const { values } = parseArgs({ options: { study: { type: "string", default: "." }, check: { type: "boolean" } } });
const study = readStudy(values.study);
const allowlist = readAllowlist(study);
const engine = fs.readFileSync(new URL("../src/rules.js", import.meta.url), "utf8");
const stack = new URL("../collector/", import.meta.url);

/** What each generated file of the study holds, and whether it runs. */
const outputs = {
  [studyFiles.filter]: { text: transformModule(allowlist, study.version, engine) },
  [path.join(studyFiles.collector, "otelcol.yaml")]: { text: collectorConfig(allowlist) },
  [studyFiles.page]: { text: participantsPage(allowlist, study) },
  ...Object.fromEntries(fs.readdirSync(stack).map((name) => [path.join(studyFiles.collector, name), {
    text: fs.readFileSync(new URL(name, stack), "utf8"),
    mode: fs.statSync(new URL(name, stack)).mode & 0o111 ? 0o755 : 0o644,
  }])),
};

let stale = false;
for (const [file, { text, mode = 0o644 }] of Object.entries(outputs)) {
  const target = path.join(study.directory, file);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
  const runs = current !== undefined && (fs.statSync(target).mode & 0o111) !== 0;
  if (current === text && runs === ((mode & 0o111) !== 0)) continue;
  if (values.check) {
    console.error(`${file} is out of date: run pharo-agent-telemetry generate`);
    stale = true;
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    fs.chmodSync(target, mode);
    console.log(`wrote ${file}`);
  }
}
process.exitCode = stale ? 1 : 0;
