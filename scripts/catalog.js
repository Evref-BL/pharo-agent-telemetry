#!/usr/bin/env node
// Writes collector/catalog.json from the source of the projects whose names
// the filter keeps: the tools MCP, PLexus and pharo-image-fs publish, and the
// words of their own names, which a name an agent makes up is kept through.
// Run it for each release of any of them, from checkouts of that release
// (each option may be given again, for branches not merged yet):
//
//   npm run catalog -- --mcp <MCP> --plexus <PLexus> --pharo-image-fs <pharo-image-fs>
//
// then `npm run generate`. A name a new release adds is dropped, or kept as
// _OTHER, until then.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import vm from "node:vm";
import { catalogFile, exceptionClasses, smalltalkLiterals, smalltalkToolNames, wordsOf } from "../src/catalog.js";

const { values } = parseArgs({
  options: {
    mcp: { type: "string", multiple: true },
    plexus: { type: "string", multiple: true },
    "pharo-image-fs": { type: "string", multiple: true },
  },
});
for (const option of ["mcp", "plexus", "pharo-image-fs"]) {
  if (!values[option]?.length) {
    console.error("Usage: npm run catalog -- --mcp <MCP checkout> --plexus <PLexus checkout> --pharo-image-fs <pharo-image-fs checkout>\nEach option may be given again: the catalog takes in every checkout named, as for branches not yet merged.");
    process.exit(1);
  }
}

/** The commit a checkout is at, as git describes it, so the catalog says which release it read. */
function described(directory) {
  try {
    return execFileSync("git", ["-C", directory, "describe", "--tags", "--always"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * The Tonel files of a Pharo project's packages, baselines left out: what a
 * release loads for its tools, or, with `tests`, only its tests.
 */
function tonelFiles(directory, packagePrefix, tests = false) {
  const source = path.join(directory, "src");
  return fs.readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(packagePrefix) && /Tests/.test(entry.name) === tests)
    .flatMap((entry) => fs.readdirSync(path.join(source, entry.name)).filter((name) => name.endsWith(".st")).map((name) => path.join(source, entry.name, name)))
    .sort();
}

/**
 * A Pharo project's tools, the words of its own names (every string and
 * symbol of its packages), and the exception classes it can name, read from
 * each checkout given.
 */
function pharoProject(directories, packagePrefix) {
  const read = (files) => files.map((file) => fs.readFileSync(file, "utf8"));
  const texts = directories.flatMap((directory) => read(tonelFiles(directory, packagePrefix)));
  const tests = directories.flatMap((directory) => read(tonelFiles(directory, packagePrefix, true)));
  if (texts.length === 0) throw new Error(`No ${packagePrefix} package under ${directories.join(", ")}.`);
  const tools = [...new Set(texts.flatMap(smalltalkToolNames))].sort();
  const words = new Set(texts.flatMap(smalltalkLiterals).flatMap(wordsOf));
  for (const tool of tools) for (const word of wordsOf(tool)) words.add(word);
  return { tools, words, exceptions: exceptionClasses(texts, tests), release: directories.map(described).join(" + ") };
}

/**
 * PLexus's own tools, read from the array its server lists them from, and
 * the words of their names, properties and values; and of the argument that
 * names an image, which PLexus adds to an image's tools.
 */
function plexusProject(directories) {
  const read = directories.map((directory) => plexusCheckout(directory));
  return {
    tools: [...new Set(read.flatMap((each) => each.tools))].sort(),
    words: new Set(read.flatMap((each) => [...each.words])),
    release: read.map((each) => each.release).join(" + "),
  };
}

function plexusCheckout(directory) {
  const file = path.join(directory, "packages", "plexus", "src", "mcp", "server.ts");
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("export const imageTools");
  const open = text.indexOf("[", text.indexOf("=", start));
  const close = text.indexOf("\n];", open);
  if (start === -1 || open === -1 || close === -1) throw new Error(`No imageTools array in ${file}.`);
  const literal = text.slice(open, close + 2).replace(/\bas const\b/g, "");
  const imageTools = vm.runInNewContext(`(${literal})`, {
    nameProperty: { type: "string" },
    schema: (properties, required = []) => ({ type: "object", properties, required }),
  });
  const tools = imageTools.map((tool) => tool.name).sort();
  const words = new Set();
  const visit = (schema) => {
    for (const [name, property] of Object.entries(schema?.properties ?? {})) {
      for (const word of wordsOf(name)) words.add(word);
      for (const value of property?.enum ?? []) for (const word of wordsOf(String(value))) words.add(word);
      visit(property);
      visit(property?.items);
    }
  };
  for (const tool of imageTools) {
    for (const word of wordsOf(tool.name)) words.add(word);
    visit(tool.inputSchema);
  }
  if (!/properties: \{ image: /.test(text)) throw new Error(`PLexus no longer adds an image argument the way ${file} did.`);
  words.add("image");
  return { tools, words, release: described(path.join(directory)) };
}

const mcp = pharoProject(values.mcp, "MCP");
const plexus = plexusProject(values.plexus);
const pifs = pharoProject(values["pharo-image-fs"], "PharoImageFS");
const catalog = {
  $comment: "Generated by `npm run catalog` from the source of each release named under `releases`. Do not edit: run it again for each release of MCP, PLexus or pharo-image-fs, then `npm run generate`.",
  releases: { MCP: mcp.release, PLexus: plexus.release, "pharo-image-fs": pifs.release },
  sets: {
    "MCP tools": mcp.tools,
    "PLexus tools": plexus.tools,
    "pharo-image-fs tools": pifs.tools.filter((name) => name.startsWith("pifs_")),
    "project words": [...new Set([...mcp.words, ...plexus.words, ...pifs.words])].sort(),
    "MCP exception classes": mcp.exceptions,
  },
};
fs.writeFileSync(new URL(`../${catalogFile}`, import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${catalogFile}: ${catalog.sets["MCP tools"].length} MCP tools, ${catalog.sets["PLexus tools"].length} PLexus tools, ${catalog.sets["pharo-image-fs tools"].length} pharo-image-fs tools, ${catalog.sets["project words"].length} words`);
