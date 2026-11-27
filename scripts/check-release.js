#!/usr/bin/env node
// pharo-agent-telemetry check-release [--study <directory>], run by the
// study's npm publish: refuses while its participants page lacks a fact a
// participant is owed.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { missingForJoin, readStudy, studyPath } from "../src/study.js";

/**
 * What stops a release, by the page's text and what the collector lacks.
 *
 * @param {string} page the study's docs/participants.md
 * @param {string[]} missing the collector's unset facts, by name
 * @param {{ id: string, name: string, dependencies?: Record<string, string> }} [study] its id, and its package's name and dependencies
 */
export function releaseProblems(page, missing, study = undefined) {
  const problems = [];
  if (study?.id === "example" || study?.name?.startsWith("@example/")) problems.push("the study is still named as the example: give it its own id in study.json and name in package.json");
  const pinned = study?.dependencies?.["@evref-bl/pharo-agent-telemetry"];
  if (study !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pinned ?? "")) problems.push("package.json does not depend on one exact release of @evref-bl/pharo-agent-telemetry: participants would run an agent its page does not describe");
  if (/not set yet/.test(page)) problems.push("the participants page says a fact is not set yet");
  if (missing.length > 0) problems.push(`study.json does not set its collector's ${missing.join(", ")}`);
  return problems;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { study: { type: "string", default: "." } } });
  const study = readStudy(values.study);
  const { dependencies } = JSON.parse(fs.readFileSync(path.join(study.directory, "package.json"), "utf8"));
  const problems = releaseProblems(fs.readFileSync(studyPath(study, "page"), "utf8"), missingForJoin(study.collector), { id: study.id, name: study.name, dependencies });
  for (const problem of problems) console.error(`Not releasable: ${problem}.`);
  process.exit(problems.length > 0 ? 1 : 0);
}
