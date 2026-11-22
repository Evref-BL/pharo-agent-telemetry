#!/usr/bin/env node
// npm run audit -- <archive files or directories>: what the collector
// archived, and whether it holds anything the allowlist does not allow.
// Exits 1 if it does. A directory stands for the .jsonl files in it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.js";
import { readAllowlist } from "../src/generate.js";

const given = process.argv.slice(2);
if (given.length === 0) {
  console.error("Usage: npm run audit -- <archive file or directory>...");
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
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lines = files.flatMap((file) => fs.readFileSync(file, "utf8").split("\n"));
const { spans, keys, problems } = audit(lines, readAllowlist(root));
console.log(`${[...spans.values()].reduce((sum, count) => sum + count, 0)} spans`);
for (const [name, count] of [...spans].sort()) console.log(`  ${count}  ${name}`);
console.log(`attributes: ${[...keys].sort().join(", ")}`);
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}
console.log("\nNothing the allowlist does not allow.");
