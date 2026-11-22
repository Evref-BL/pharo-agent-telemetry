#!/usr/bin/env node
// npm run check-deployment -- <endpoint> <token>: asks a deployed collector,
// from outside, what a participant's tools rely on. Exits 1 if anything fails.
import { fileURLToPath } from "node:url";
import { catalogPayload } from "../src/catalog.js";
import { catalogPublicKey, catalogUrl, publicEndpoint, publicToken } from "../src/collector.js";
import { checkDeployment } from "../src/check.js";
import { readAllowlist } from "../src/generate.js";

const [endpoint = publicEndpoint, token = publicToken] = process.argv.slice(2);
if (endpoint === undefined || token === undefined) {
  console.error("Usage: npm run check-deployment -- <endpoint> <token>");
  process.exit(2);
}
if (!endpoint.startsWith("https://")) console.log(`Note: ${endpoint} is not HTTPS; a deployed collector is.\n`);
if (catalogPublicKey === undefined) console.log("Note: catalogPublicKey is not set in src/collector.js, so the served catalog is not checked.\n");
const allowlist = readAllowlist(fileURLToPath(new URL("..", import.meta.url)));
// The catalog where the agents ask for it: catalogUrl, for the project's collector.
const url = endpoint === publicEndpoint && catalogUrl !== undefined ? catalogUrl : undefined;
const results = await checkDeployment(endpoint, token, fetch, catalogPublicKey === undefined ? {} : { publicKey: catalogPublicKey, url, allowlist, sets: catalogPayload(allowlist, "").sets });
for (const { expectation, held, saw } of results) console.log(`${held ? "ok  " : "FAIL"}  ${expectation} (${saw})`);
process.exit(results.every((result) => result.held) ? 0 : 1);
