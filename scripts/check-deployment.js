#!/usr/bin/env node
// npm run check-deployment -- <endpoint> <token>: asks a deployed collector,
// from outside, what a participant's tools rely on. Exits 1 if anything fails.
import { publicEndpoint, publicToken } from "../src/collector.js";
import { checkDeployment } from "../src/check.js";

const [endpoint = publicEndpoint, token = publicToken] = process.argv.slice(2);
if (endpoint === undefined || token === undefined) {
  console.error("Usage: npm run check-deployment -- <endpoint> <token>");
  process.exit(2);
}
if (!endpoint.startsWith("https://")) console.log(`Note: ${endpoint} is not HTTPS; a deployed collector is.\n`);
const results = await checkDeployment(endpoint, token);
for (const { expectation, held, saw } of results) console.log(`${held ? "ok  " : "FAIL"}  ${expectation} (${saw})`);
process.exit(results.every((result) => result.held) ? 0 : 1);
