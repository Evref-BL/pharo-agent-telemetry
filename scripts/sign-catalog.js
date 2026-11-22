#!/usr/bin/env node
// Signs the catalog the agents may take in place of the one their filter was
// generated with, for the collector to serve as
// /pharo-agent-telemetry/catalog.json:
//
//   npm run sign-catalog -- --key <private key file>
//
// It signs the sets that grow with the projects' releases (the allowlist's
// `grows`), with collector/catalog.json's members, as `npm run generate`
// makes the collector's configuration: sign and deploy from the same commit.
// It refuses a catalog the agents would trim, and a date in the future. The
// private key is the administrators' and never enters this repository;
//
//   npm run sign-catalog -- --new-key <file outside this repository>
//
// writes a new one there, readable by its owner only, and prints the public
// key to set as catalogPublicKey in src/collector.js.
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { catalogPayload, publicKeyOf, signCatalog } from "../src/catalog.js";
import { catalogPublicKey } from "../src/collector.js";
import { readAllowlist } from "../src/generate.js";
import { catalogLeftOut, catalogTime } from "../src/rules.js";

const root = fs.realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const { values } = parseArgs({
  options: {
    key: { type: "string" },
    "new-key": { type: "string" },
    out: { type: "string", default: path.join(root, "collector", "published", "catalog.json") },
    published: { type: "string" },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Whether a file is, or would be, in this repository. */
function inRepository(file) {
  let directory = path.dirname(path.resolve(file));
  while (!fs.existsSync(directory)) directory = path.dirname(directory);
  const real = path.join(fs.realpathSync(directory), path.relative(directory, path.resolve(file)));
  return real === root || real.startsWith(`${root}${path.sep}`);
}

if (values["new-key"]) {
  const file = values["new-key"];
  if (inRepository(file)) fail(`${file} is in this repository: keep the private key outside it.`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  try {
    fs.writeFileSync(file, pem, { mode: 0o600, flag: "wx" });
  } catch (error) {
    fail(`${file} was not written (${/** @type {any} */ (error).code}): a key is never replaced.`);
  }
  console.log(`Wrote the private key to ${file}, readable by you only. Set catalogPublicKey in src/collector.js to:\n${publicKeyOf(pem)}`);
} else if (values.key) {
  if (inRepository(values.key)) fail(`${values.key} is in this repository: keep the private key outside it.`);
  const pem = fs.readFileSync(values.key, "utf8");
  const published = values.published ?? new Date().toISOString();
  const time = catalogTime(published);
  if (time === undefined) fail(`--published ${published} is not a UTC date of the form 2026-11-23T10:00:00Z.`);
  if (time > Date.now()) fail(`--published ${published} is in the future: an agent takes no catalog older than the one it has, so a catalog dated ahead keeps every later one out until then.`);
  const allowlist = readAllowlist(root);
  const payload = catalogPayload(allowlist, published);
  // The agents' own check: a member they would leave out is fixed here, not signed.
  const leftOut = catalogLeftOut(allowlist, payload);
  if (leftOut.length > 0) fail(`Not signed: the agents would leave out ${leftOut.join(", ")}.`);
  const signed = signCatalog(payload, pem);
  fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
  fs.writeFileSync(values.out, signed, { mode: 0o644 });
  const key = publicKeyOf(pem);
  console.log(`Signed the catalog of ${published} into ${values.out}.`);
  if (catalogPublicKey !== undefined && catalogPublicKey !== key) console.log(`Note: this key's public key, ${key}, is not catalogPublicKey in src/collector.js: the agents will refuse this catalog.`);
} else {
  fail("Usage: npm run sign-catalog -- --key <private key file> [--out <file>]\n       npm run sign-catalog -- --new-key <file outside this repository>");
}
