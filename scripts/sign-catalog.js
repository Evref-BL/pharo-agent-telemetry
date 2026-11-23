#!/usr/bin/env node
// Signs the catalog the agents of a study may take in place of the one their
// filter was generated with, for its collector to serve as
// /pharo-agent-telemetry/catalog.json:
//
//   pharo-agent-telemetry sign-catalog [--study <directory>] --key <private key file>
//
// It signs the sets that grow with the Pharo tools' releases (the
// allowlist's `grows`), with the study's catalog.json's members, as
// `generate` makes the collector's configuration: sign and deploy from the
// same commit. It refuses a catalog the agents would trim, and a date in the
// future. The private key is the study's operators' and never enters its
// repository;
//
//   pharo-agent-telemetry sign-catalog [--study <directory>] --new-key <file outside the study>
//
// writes a new one there, readable by its owner only, and prints the public
// key to set as collector.catalogPublicKey in study.json.
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { catalogPayload, publicKeyOf, signCatalog } from "../src/catalog.js";
import { catalogLeftOut, catalogTime } from "../src/rules.js";
import { readAllowlist, readStudy } from "../src/study.js";

const { values } = parseArgs({
  options: {
    study: { type: "string", default: "." },
    key: { type: "string" },
    "new-key": { type: "string" },
    out: { type: "string" },
    published: { type: "string" },
  },
});
const study = readStudy(values.study);
const root = fs.realpathSync(study.directory);
const out = values.out ?? path.join(root, "collector", "published", "catalog.json");
const { catalogPublicKey } = study.collector;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Whether a file is, or would be, in the study's directory. */
function inRepository(file) {
  let directory = path.dirname(path.resolve(file));
  while (!fs.existsSync(directory)) directory = path.dirname(directory);
  const real = path.join(fs.realpathSync(directory), path.relative(directory, path.resolve(file)));
  return real === root || real.startsWith(`${root}${path.sep}`);
}

if (values["new-key"]) {
  const file = values["new-key"];
  if (inRepository(file)) fail(`${file} is in the study's directory: keep the private key outside it.`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  try {
    fs.writeFileSync(file, pem, { mode: 0o600, flag: "wx" });
  } catch (error) {
    fail(`${file} was not written (${/** @type {any} */ (error).code}): a key is never replaced.`);
  }
  console.log(`Wrote the private key to ${file}, readable by you only. Set collector.catalogPublicKey in study.json to:\n${publicKeyOf(pem)}`);
} else if (values.key) {
  if (inRepository(values.key)) fail(`${values.key} is in the study's directory: keep the private key outside it.`);
  const pem = fs.readFileSync(values.key, "utf8");
  const published = values.published ?? new Date().toISOString();
  const time = catalogTime(published);
  if (time === undefined) fail(`--published ${published} is not a UTC date of the form 2026-11-23T10:00:00Z.`);
  if (time > Date.now()) fail(`--published ${published} is in the future: an agent takes no catalog older than the one it has, so a catalog dated ahead keeps every later one out until then.`);
  const allowlist = readAllowlist(study);
  const payload = catalogPayload(allowlist, published);
  // The agents' own check: a member they would leave out is fixed here, not signed.
  const leftOut = catalogLeftOut(allowlist, payload);
  if (leftOut.length > 0) fail(`Not signed: the agents would leave out ${leftOut.join(", ")}.`);
  const signed = signCatalog(payload, pem);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, signed, { mode: 0o644 });
  const key = publicKeyOf(pem);
  console.log(`Signed the catalog of ${published} into ${out}.`);
  if (catalogPublicKey !== undefined && catalogPublicKey !== key) console.log(`Note: this key's public key, ${key}, is not collector.catalogPublicKey in study.json: the agents will refuse this catalog.`);
} else {
  fail("Usage: pharo-agent-telemetry sign-catalog [--study <directory>] --key <private key file> [--out <file>]\n       pharo-agent-telemetry sign-catalog [--study <directory>] --new-key <file outside the study>");
}
