#!/usr/bin/env node
// pharo-agent-telemetry init <directory>: starts a study there, from the
// example study this package ships: its package, study.json, allowlist,
// catalog and rule fixtures, named after the directory. Then edit them, and run
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
// Named after its directory, so that no two studies share the example's id. It depends on this exact release:
// participants consent to the agent and rules of one release, as the study's page describes them.
const id = path.basename(path.resolve(directory)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "study";
const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
pkg.name = id;
pkg.bin = { [id]: "bin/study.js" };
pkg.dependencies[own.name] = own.version;
fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
const study = JSON.parse(fs.readFileSync(path.join(directory, "study.json"), "utf8"));
study.id = id;
fs.writeFileSync(path.join(directory, "study.json"), `${JSON.stringify(study, null, 2)}\n`);
console.log(`Started the study ${id} in ${directory}, from the example. Give it the package name participants will run (package.json), say who runs it and why (study.json), choose what it keeps (allowlist.json), then run npm install and npx @evref-bl/pharo-agent-telemetry generate there.`);
