#!/usr/bin/env node
// pharo-agent-telemetry check [--study <directory>]: the study's generated
// files are current, and its rule fixtures pass through the agent's filter
// and, where Docker runs, through the collector, which must keep the same.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readStudy } from "../src/study.js";

const { values } = parseArgs({ options: { study: { type: "string", default: "." } } });
const study = readStudy(values.study);
const run = (args) => spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, PHARO_AGENT_TELEMETRY_STUDY: study.directory } }).status;
const generated = run([fileURLToPath(new URL("generate.js", import.meta.url)), "--study", study.directory, "--check"]);
if (generated !== 0) process.exit(1);
const tests = fileURLToPath(new URL("../test/study/", import.meta.url));
process.exit(run(["--test", "--test-concurrency=1", path.join(tests, "rules.test.js"), path.join(tests, "collector.test.js")]) ?? 1);
