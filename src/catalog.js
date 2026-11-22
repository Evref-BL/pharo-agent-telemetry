// What scripts/catalog.js reads in the projects' source and in the files
// scripts/exception-names.js writes, and how the allowlist takes in what it
// wrote: collector/catalog.json, the tools MCP, PLexus and pharo-image-fs
// publish, the words of their own names, and the classes MCP names
// exceptions by.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { catalogSchema, nameWords } from "./rules.js";

/** Where the catalog is, from the repository's root. */
export const catalogFile = "collector/catalog.json";

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
 * Pharo of that version, its stable one first, then one of a distribution's
 * category; undefined when PLexus has none.
 *
 * @param {number} version
 * @param {Array<{ name: string, category?: string }>} templates as `plexus image templates` lists them
 */
export function pharoTemplate(version, templates) {
  const shape = new RegExp(`^Pharo ${version}\\.0 - 64bit(?: \\(([^)]*)\\))?$`);
  const rank = (template) => {
    const suffix = shape.exec(template.name)?.[1];
    return (suffix === "stable" ? 0 : suffix === undefined ? 2 : 4) + (/distributions$/i.test(template.category ?? "") ? 0 : 1);
  };
  return templates.filter((template) => shape.test(template.name)).sort((a, b) => rank(a) - rank(b))[0];
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
 * The allowlist with the catalog's sets among its own.
 *
 * @param {any} allowlist collector/allowlist.json
 * @param {any} catalog collector/catalog.json
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
