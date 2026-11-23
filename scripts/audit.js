#!/usr/bin/env node
// pharo-agent-telemetry audit [--study <directory>] <archive files or directories>:
// what a study's collector archived, and whether it holds anything the
// study's allowlist does not allow. Exits 1 if it does. A directory stands for
// the .jsonl files in it.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { audit } from "../src/audit.js";
import { readAllowlist } from "../src/study.js";

const { values, positionals: given } = parseArgs({ allowPositionals: true, options: { study: { type: "string", default: "." } } });
if (given.length === 0) {
  console.error("Usage: pharo-agent-telemetry audit [--study <directory>] <archive file or directory>...");
  process.exit(2);
}
const files = given.flatMap((each) => {
  try {
    return fs.statSync(each).isDirectory() ? fs.readdirSync(each).filter((name) => name.endsWith(".jsonl")).sort().map((name) => path.join(each, name)) : [each];
  } catch {
    console.error(`${each}: no such file or directory.`);
    process.exit(2);
  }
});
const lines = files.flatMap((file) => fs.readFileSync(file, "utf8").split("\n"));
const { spans, keys, problems } = audit(lines, readAllowlist(values.study));
console.log(`${[...spans.values()].reduce((sum, count) => sum + count, 0)} spans`);
for (const [name, count] of [...spans].sort()) console.log(`  ${count}  ${name}`);
console.log(`attributes: ${[...keys].sort().join(", ")}`);
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}
console.log("\nNothing the allowlist does not allow.");
