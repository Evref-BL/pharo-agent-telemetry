// A study: who collects, what they keep, and what they tell participants, as
// data in a directory of its own. This package runs any study and names
// none; a study's package hands its directory to src/cli.js.
//
// A study's directory holds:
//
// - package.json: its name, the package participants run with npx, and its
//   version, which the filter generated from it carries;
// - study.json: its id, its collector, who answers for it, and what the
//   participants page says of its purpose, retention and authority (below);
// - allowlist.json and catalog.json: what is kept, and the names that grow
//   with the Pharo tools' releases;
// - rules/: a fixture per rule, a request and the spans the rules keep of it;
// - what `pharo-agent-telemetry generate` makes of them: the filter
//   (telemetry-transform.mjs), the collector (collector/) and the
//   participants page (docs/participants.md).
//
// study.json's collector facts stay null until the collector is deployed and
// the controller named: `join` refuses the study's collector until all are
// set, the participants page says what is missing rather than inventing it,
// and `check-release` refuses to publish while it says so.
import fs from "node:fs";
import path from "node:path";
import { weakPublicKey } from "./agent.js";
import { withCatalog } from "./catalog.js";

/**
 * @typedef {object} Study
 * @property {string} directory where it is
 * @property {string} id one word that names it in the agent's settings: `join` of another study refuses until `leave`
 * @property {string} name its package's name, which participants run with npx
 * @property {string} version its package's version
 * @property {string | undefined} page where participants read its participants page
 * @property {Collector} collector
 * @property {{ purpose: string, why: string, retention: string, authority: string }} text what the participants page says of it alone
 *
 * @typedef {object} Collector
 * @property {string} [endpoint] the collector's public URL
 * @property {string} [token] the shared token. Public: it keeps scanners out, not people
 * @property {{ name: string, contact: string }} [controller] who decides why and how the data is processed, the GDPR's controller, and how a participant reaches them
 * @property {string} [dpo] how a participant reaches the controller's data protection officer
 * @property {{ provider: string, region: string, importer: string, archive: string }} [host] where the data is: the company hosting the collector's VM, the GDPR's processor, its region, the GitLab whose scheduled job copies the archive every day, and where it keeps it
 * @property {string} [catalogUrl] where the agents ask for a newer catalog: a URL on the collector's own host, which serves it as /pharo-agent-telemetry/catalog.json
 * @property {string} [catalogPublicKey] the Ed25519 public key the agents check a catalog's signature with, as `sign-catalog --new-key` prints it; the private key is the operators' alone
 */

/** The files of a study's directory, by what they are. */
export const studyFiles = {
  study: "study.json",
  allowlist: "allowlist.json",
  catalog: "catalog.json",
  filter: "telemetry-transform.mjs",
  collector: "collector",
  page: path.join("docs", "participants.md"),
  rules: "rules",
};

/** The facts of a collector, in the order `join` names what is missing. */
const collectorFacts = ["endpoint", "token", "controller", "dpo", "host", "catalogUrl", "catalogPublicKey"];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** The values of an object without its nulls, which study.json writes for what is not set yet. */
const set = (object) => Object.fromEntries(Object.entries(object ?? {}).filter(([, value]) => value !== null && value !== undefined));

/**
 * A study, read from its directory.
 *
 * @param {string} directory
 * @returns {Study}
 */
export function readStudy(directory) {
  const absolute = path.resolve(directory);
  let study;
  let pkg;
  try {
    study = readJson(path.join(absolute, studyFiles.study));
    pkg = readJson(path.join(absolute, "package.json"));
  } catch (error) {
    throw new Error(`${absolute} is not a study: it needs a package.json and a ${studyFiles.study} (${error instanceof Error ? error.message : error}).`);
  }
  if (typeof study.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(study.id)) throw new Error(`${studyFiles.study} needs an id of lowercase letters, digits and dashes.`);
  const text = study.text ?? {};
  for (const name of ["purpose", "why", "retention", "authority"]) {
    if (typeof text[name] !== "string" || text[name].trim() === "") throw new Error(`${studyFiles.study} needs text.${name}, which the participants page says.`);
  }
  const collector = set(study.collector);
  for (const name of Object.keys(collector)) {
    if (!collectorFacts.includes(name)) throw new Error(`${studyFiles.study}: collector.${name} is no collector fact (${collectorFacts.join(", ")}).`);
  }
  return { directory: absolute, id: study.id, name: pkg.name, version: pkg.version, page: study.page ?? undefined, collector, text };
}

/**
 * A study's allowlist with its catalog's sets, as the rules read it.
 *
 * @param {Study | string} study a study, or its directory
 */
export function readAllowlist(study) {
  const directory = typeof study === "string" ? study : study.directory;
  return withCatalog(readJson(path.join(directory, studyFiles.allowlist)), readJson(path.join(directory, studyFiles.catalog)));
}

/** Where a file of a study is. */
export const studyPath = (study, file) => path.join(study.directory, studyFiles[file]);

/** How participants run a study's package. */
export const studyCommand = (study) => `npx ${study.name}`;

/** Whether a URL is on the same host as the collector's endpoint, over HTTPS as it is. */
function onHostOf(url, endpoint) {
  try {
    const target = new URL(url);
    const base = new URL(endpoint);
    return target.host === base.host && target.protocol === base.protocol;
  } catch {
    return false;
  }
}

/**
 * Whether `join --endpoint` names the study's collector, however its URL is
 * written (a trailing slash, the host's case): then it is joined as the
 * study's, with its token, its catalog and its readiness checks.
 *
 * @param {string | undefined} endpoint what --endpoint gave, undefined for none
 * @param {string | undefined} ours the study's collector
 */
export function isStudyCollector(endpoint, ours) {
  if (endpoint === undefined) return true;
  if (ours === undefined) return false;
  try {
    const given = new URL(endpoint);
    const theirs = new URL(ours);
    return given.origin === theirs.origin && given.pathname.replace(/\/+$/, "") === theirs.pathname.replace(/\/+$/, "") && given.search === theirs.search;
  } catch {
    return false;
  }
}

/**
 * What `join` lacks before it may send to the study's collector, by name: a
 * catalog URL on another host than the collector's is lacking too, and so is
 * a public key anyone could sign for.
 *
 * @param {Collector} collector
 */
export function missingForJoin(collector) {
  return collectorFacts.filter((name) => {
    const value = collector[name];
    if (value === undefined) return true;
    if (name === "catalogUrl") return collector.endpoint !== undefined && !onHostOf(value, collector.endpoint);
    if (name === "catalogPublicKey") return weakPublicKey(value);
    return false;
  });
}
