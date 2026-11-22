// What scripts/catalog.js reads in the projects' source, and how the
// allowlist takes in what it wrote: collector/catalog.json, the tools MCP,
// PLexus and pharo-image-fs publish and the words of their own names.
import { nameWords } from "./rules.js";

/** Where the catalog is, from the repository's root. */
export const catalogFile = "collector/catalog.json";

/**
 * The words of a name, as the filter reads a name it checks: split on `_`,
 * `-` and camelCase, in lower case, those of two characters or more that
 * start with a letter.
 *
 * @param {string} name
 */
export function wordsOf(name) {
  return nameWords(name).filter((word) => /^[a-z][a-z0-9]+$/.test(word));
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
  return { ...allowlist, releases: catalog.releases, sets: { ...allowlist.sets, ...catalog.sets } };
}
