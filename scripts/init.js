#!/usr/bin/env node
// pharo-agent-telemetry init <directory>: starts a study there, from the
// example study this package ships: its package, study.json, allowlist,
// catalog and rule fixtures. Then edit them, and run
// `pharo-agent-telemetry generate` in it.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals: [directory] } = parseArgs({ allowPositionals: true, options: {} });
if (directory === undefined) {
  console.error("Usage: pharo-agent-telemetry init <directory>");
  process.exit(2);
}
if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) {
  console.error(`${directory} is not empty: init starts a study only in a new or empty directory.`);
  process.exit(1);
}
const example = new URL("../example/", import.meta.url);
const own = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const name of ["package.json", "study.json", "allowlist.json", "catalog.json", "bin", "rules"]) {
  fs.cpSync(new URL(name, example), path.join(directory, name), { recursive: true });
}
// Written here: npm leaves a package's .gitignore files out of it. The collector's settings, archive and signed catalog stay on its machine.
fs.writeFileSync(path.join(directory, ".gitignore"), "node_modules/\ncollector/.env\ncollector/archive/\ncollector/published/\n");
// The study depends on this release of this package.
const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
pkg.dependencies[own.name] = `^${own.version}`;
fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Started a study in ${directory}, from the example. Name it (package.json's name, study.json's id), say who runs it and why (study.json), choose what it keeps (allowlist.json), then run npm install and npx pharo-agent-telemetry generate there.`);
