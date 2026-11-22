// What scripts/catalog.js reads in the projects' source, and how the
// allowlist takes in what it wrote: collector/catalog.json, the tools MCP,
// PLexus and pharo-image-fs publish and the words of their own names.
import { nameWords } from "./rules.js";

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
 * The classes a Tonel file defines, with their superclass, and the class
 * names its code refers to, in code, strings or symbols, comments left out.
 *
 * @param {string} text
 * @returns {{ defined: Array<{ name: string, superclass: string }>, referred: string[] }}
 */
export function smalltalkClasses(text) {
  const defined = [...text.matchAll(/^(?:Class|Error|Exception)\s*\{[^}]*?#name\s*:\s*#?'?([A-Za-z][A-Za-z0-9_]*)'?[^}]*?#superclass\s*:\s*#?'?([A-Za-z][A-Za-z0-9_]*)'?/gm)]
    .map((match) => ({ name: match[1], superclass: match[2] }));
  // Comments left out, strings and symbols kept: a test names the class it expects as a string.
  let code = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "$") {
      index += 1;
      code += " ";
    } else if (character === '"') {
      const end = text.indexOf('"', index + 1);
      index = end === -1 ? text.length : end;
      code += " ";
    } else if (character === "'") {
      let end = index + 1;
      while (end < text.length && !(text[end] === "'" && text[end + 1] !== "'")) end += text[end] === "'" ? 2 : 1;
      code += ` ${text.slice(index + 1, end)} `;
      index = end;
    } else {
      code += character;
    }
  }
  return { defined, referred: [...new Set(code.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [])] };
}

/** A class name that reads as an exception's, as Pharo names them. */
export const exceptionName = /^[A-Z][A-Za-z0-9]*(?:Error|Exception|Notice|Warning|Notification|Failure|Abort|TimedOut|Timeout)$/;

/**
 * The exception classes a project can name: those its code and its tests
 * refer to that read as exceptions (the compile notices its tests expect
 * among them), and those its code defines that descend from one, the
 * JSON-RPC errors it builds on included.
 *
 * @param {string[]} texts the project's Tonel files, tests left out
 * @param {string[]} [tests] its tests' Tonel files, read only for the classes they refer to
 */
export function exceptionClasses(texts, tests = []) {
  const found = texts.map(smalltalkClasses);
  const superclasses = new Map(found.flatMap(({ defined }) => defined.map(({ name, superclass }) => [name, superclass])));
  const isException = (name, seen = new Set()) => {
    if (exceptionName.test(name) || ["Error", "Exception", "Notification", "Warning", "Halt"].includes(name) || /^JRPC[A-Za-z]*(?:Error|Invalid)/.test(name)) return true;
    const superclass = superclasses.get(name);
    if (superclass === undefined || seen.has(name)) return false;
    seen.add(name);
    return isException(superclass, seen);
  };
  const referred = [...found, ...tests.map(smalltalkClasses)].flatMap((each) => each.referred).filter((name) => exceptionName.test(name));
  return [...new Set([...referred, ...[...superclasses.keys()].filter((name) => isException(name))])].sort();
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
