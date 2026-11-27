// What scripts/catalog.js reads in the projects' source and in the files
// scripts/exception-names.js writes, and how the allowlist takes in what it
// wrote: a study's catalog.json, the tools the projects it covers publish
// (MCP's, PLexus's and any other's), the words of their own names, and the
// classes MCP names exceptions by.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { catalogSchema, nameWords } from "./rules.js";

/**
 * The words of a name, as the filter reads a name it checks: split on `_`,
 * `-` and camelCase, in lower case, those that start with a letter, one
 * letter long too (the `a` of `NotAClass`).
 *
 * @param {string} name
 */
export function wordsOf(name) {
  return nameWords(name).filter((word) => /^[a-z][a-z0-9]*$/.test(word));
}

/**
 * The strings and unary symbols of a Tonel file that have a name's shape:
 * the names its code uses, comments left out.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function smalltalkLiterals(text) {
  const found = [];
  let index = 0;
  const string = () => {
    let value = "";
    index += 1;
    while (index < text.length) {
      if (text[index] === "'") {
        if (text[index + 1] === "'") {
          value += "'";
          index += 2;
          continue;
        }
        index += 1;
        return value;
      }
      value += text[index];
      index += 1;
    }
    return value;
  };
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const end = text.indexOf('"', index + 1);
      index = end === -1 ? text.length : end + 1;
    } else if (character === "$") {
      index += 2;
    } else if (character === "'") {
      found.push(string());
    } else if (character === "#" && text[index + 1] === "'") {
      index += 1;
      found.push(string());
    } else if (character === "#" && /[A-Za-z_]/.test(text[index + 1] ?? "")) {
      const symbol = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z0-9_:]*)?/.exec(text.slice(index + 1))[0];
      if (!symbol.includes(":")) found.push(symbol);
      index += 1 + symbol.length;
    } else {
      index += 1;
    }
  }
  return found.filter((each) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(each));
}

/**
 * The Pharo versions a project's CI runs: the smalltalkCI images its
 * workflow names (`Pharo64-14`).
 *
 * @param {string} text the workflow
 * @returns {number[]}
 */
export function ciPharoVersions(text) {
  return [...new Set([...text.matchAll(/\bPharo64-([0-9]{1,3})\b/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
}

/**
 * The template PLexus makes an image of a Pharo version from: a 64-bit
 * Pharo of that version, of any minor release (`Pharo 13.1`), its stable one
 * first, then one of a distribution's category, then the latest minor;
 * undefined when PLexus has none.
 *
 * @param {number} version
 * @param {Array<{ name: string, category?: string }>} templates as `plexus image templates` lists them
 */
export function pharoTemplate(version, templates) {
  const shape = new RegExp(`^Pharo ${version}\\.([0-9]+) - 64bit(?: \\(([^)]*)\\))?$`);
  const rank = (template) => {
    const [, minor, suffix] = shape.exec(template.name);
    return [(suffix === "stable" ? 0 : suffix === undefined ? 2 : 4) + (/distributions$/i.test(template.category ?? "") ? 0 : 1), -Number(minor)];
  };
  return templates
    .filter((template) => shape.test(template.name))
    .sort((a, b) => {
      const [first, second] = [rank(a), rank(b)];
      return first[0] - second[0] || first[1] - second[1];
    })[0];
}

/**
 * What scripts/exception-names.st wrote in an image: what named the classes
 * (`MCP 4.3.0 in Pharo-14.0.0+...`), from the lines that start with #, and
 * the names, one a line.
 *
 * @param {string} text
 * @returns {{ from: string[], names: string[] }}
 */
export function exceptionNames(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return {
    from: lines.filter((line) => line.startsWith("#")).map((line) => line.replace(/^#\s*/, "")),
    names: lines.filter((line) => !line.startsWith("#")),
  };
}

/**
 * The names the tool classes of a Tonel file give themselves: the literal a
 * `class >> toolName` method answers.
 *
 * @param {string} text
 */
export function smalltalkToolNames(text) {
  return [...text.matchAll(/class >> toolName \[\s*\^\s*'([a-z][a-z0-9_]*)'\s*\]/g)].map((match) => match[1]);
}

/**
 * The Tonel files of a Pharo project's packages, tests and baselines left
 * out, in the source directory its `.project` names (`src` without one): of
 * the packages whose name starts with a prefix when one is given, else of
 * those that hold a tool.
 *
 * @param {string} checkout
 * @param {string} [packagePrefix]
 * @returns {string[]} their texts
 */
function tonelTexts(checkout, packagePrefix) {
  const project = path.join(checkout, ".project");
  const named = fs.existsSync(project) ? /'srcDirectory'\s*:\s*'([^']*)'/.exec(fs.readFileSync(project, "utf8"))?.[1] : undefined;
  const source = path.join(checkout, named || "src");
  if (!fs.existsSync(source)) throw new Error(`No Tonel source in ${checkout}: no ${source}.`);
  return fs.readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/Tests/.test(entry.name) && !entry.name.startsWith("BaselineOf"))
    .filter((entry) => packagePrefix === undefined || entry.name.startsWith(packagePrefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => fs.readdirSync(path.join(source, entry.name)).filter((name) => name.endsWith(".st")).sort().map((name) => fs.readFileSync(path.join(source, entry.name, name), "utf8")))
    .filter((texts) => packagePrefix !== undefined || texts.some((text) => smalltalkToolNames(text).length > 0))
    .flat();
}

/**
 * A Pharo project's tools, the names its tool classes give themselves, and
 * the words of its own names (every string and symbol of its packages, and
 * its tools' names), read from each checkout given: from the packages whose
 * name starts with a prefix, as MCP's, or else from those that hold a tool,
 * where the names a call to one carries are.
 *
 * @param {string[]} checkouts
 * @param {{ packagePrefix?: string }} [options]
 */
export function pharoProject(checkouts, { packagePrefix } = {}) {
  const texts = checkouts.flatMap((checkout) => tonelTexts(checkout, packagePrefix));
  if (texts.length === 0) throw new Error(`No ${packagePrefix === undefined ? "package with a tool" : `${packagePrefix} package`} under ${checkouts.join(", ")}.`);
  const tools = [...new Set(texts.flatMap(smalltalkToolNames))].sort();
  const words = new Set(texts.flatMap(smalltalkLiterals).flatMap(wordsOf));
  for (const tool of tools) for (const word of wordsOf(tool)) words.add(word);
  return { tools, words };
}

/**
 * The allowlist with the catalog's sets among its own.
 *
 * @param {any} allowlist a study's allowlist.json
 * @param {any} catalog a study's catalog.json
 */
export function withCatalog(allowlist, catalog) {
  for (const name of Object.keys(catalog.sets)) {
    if (name in allowlist.sets) throw new Error(`${name} is both in the allowlist and in the catalog.`);
  }
  return { ...allowlist, catalogPublished: catalog.published, releases: catalog.releases, sets: { ...allowlist.sets, ...catalog.sets } };
}

/**
 * The catalog the agents may add to their filter's sets from, as it is
 * signed and served: the form of catalog the rules read, a date, the
 * releases it was read from, and the sets that grow with them (the
 * allowlist's `grows`), as the collector's configuration is generated with.
 *
 * @param {any} allowlist the allowlist with the catalog's sets (readAllowlist)
 * @param {string} published when it was signed, as an ISO date
 */
export function catalogPayload(allowlist, published) {
  return { schema: catalogSchema, published, releases: allowlist.releases, sets: Object.fromEntries(Object.keys(allowlist.grows).map((name) => [name, allowlist.sets[name]])) };
}

/**
 * A catalog signed as the collector serves it: its JSON text, and the
 * Ed25519 signature of that text by the administrators' private key, which
 * the agents check with the public key the package ships.
 *
 * @param {any} payload catalogPayload's
 * @param {string} privateKey PEM
 */
export function signCatalog(payload, privateKey) {
  const text = JSON.stringify(payload);
  return `${JSON.stringify({ payload: text, signature: sign(null, Buffer.from(text, "utf8"), createPrivateKey(privateKey)).toString("base64") })}\n`;
}

/** The public key of a private one, as the agents take it: the `x` of its JWK. */
export function publicKeyOf(privateKey) {
  return /** @type {string} */ (createPublicKey(createPrivateKey(privateKey)).export({ format: "jwk" }).x);
}
