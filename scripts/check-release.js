#!/usr/bin/env node
// npm run check-release, run by npm publish: refuses while the participants
// page lacks a fact a participant is owed, the DPO's contact first among them.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { missingForJoin } from "../src/collector.js";
import { dpoPlaceholder } from "../src/generate.js";

/**
 * What stops a release, by the page's text and what the collector lacks.
 *
 * @param {string} page docs/participants.md
 * @param {string[]} [missing] the collector's unset facts, by name
 */
export function releaseProblems(page, missing = missingForJoin()) {
  const problems = [];
  if (page.includes(dpoPlaceholder)) problems.push("the participants page has no DPO contact: set dpo in src/collector.js and run npm run generate");
  if (/not set yet/.test(page)) problems.push("the participants page says a fact is not set yet");
  if (missing.length > 0) problems.push(`src/collector.js does not set its ${missing.join(", ")}`);
  return problems;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = releaseProblems(fs.readFileSync(new URL("../docs/participants.md", import.meta.url), "utf8"));
  for (const problem of problems) console.error(`Not releasable: ${problem}.`);
  process.exit(problems.length > 0 ? 1 : 0);
}
