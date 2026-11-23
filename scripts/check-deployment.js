#!/usr/bin/env node
// pharo-agent-telemetry check-deployment [--study <directory>] [<endpoint> <token>]:
// asks a study's deployed collector, from outside, what a participant's tools
// rely on; the study's own collector unless an endpoint is given. Exits 1 if
// anything fails.
import { parseArgs } from "node:util";
import { catalogPayload } from "../src/catalog.js";
import { checkDeployment } from "../src/check.js";
import { isStudyCollector, readAllowlist, readStudy } from "../src/study.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { study: { type: "string", default: "." } } });
const study = readStudy(values.study);
const { catalogPublicKey, catalogUrl } = study.collector;
const [endpoint = study.collector.endpoint, token = study.collector.token] = positionals;
if (endpoint === undefined || token === undefined) {
  console.error("Usage: pharo-agent-telemetry check-deployment [--study <directory>] <endpoint> <token>");
  process.exit(2);
}
if (!endpoint.startsWith("https://")) console.log(`Note: ${endpoint} is not HTTPS; a deployed collector is.\n`);
if (catalogPublicKey === undefined) console.log("Note: collector.catalogPublicKey is not set in study.json, so the served catalog is not checked.\n");
const allowlist = readAllowlist(study);
// The catalog where the agents ask for it: catalogUrl, for the study's collector.
const url = isStudyCollector(endpoint, study.collector.endpoint) && catalogUrl !== undefined ? catalogUrl : undefined;
const results = await checkDeployment(endpoint, token, fetch, catalogPublicKey === undefined ? {} : { publicKey: catalogPublicKey, url, allowlist, sets: catalogPayload(allowlist, "").sets });
for (const { expectation, held, saw } of results) console.log(`${held ? "ok  " : "FAIL"}  ${expectation} (${saw})`);
process.exit(results.every((result) => result.held) ? 0 : 1);
