#!/usr/bin/env node
// Writes a study's catalog.json from the source of the projects whose names
// the filter keeps: the tools MCP and PLexus publish, and the
// words of their own names, which a name an agent makes up is kept through;
// and, from what `exception-names` wrote, the classes MCP names an
// exception by in an image of each Pharo version. Run it for each release of
// any of them, from checkouts of that release (each option may be given
// again, for branches not merged yet; --exceptions takes files, or the
// directory exception-names wrote them in):
//
//   pharo-agent-telemetry catalog [--study <directory>] --mcp <MCP> --plexus <PLexus> --exceptions <directory>
//
// then `pharo-agent-telemetry generate`. A name a new release adds is dropped, or kept as
// _OTHER, until then.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import vm from "node:vm";
import { exceptionNames, smalltalkLiterals, smalltalkToolNames, wordsOf } from "../src/catalog.js";
import { addable, catalogAdditionCap } from "../src/rules.js";
import { readStudy, studyFiles, studyPath } from "../src/study.js";

const { values } = parseArgs({
  options: {
    study: { type: "string", default: "." },
    mcp: { type: "string", multiple: true },
    plexus: { type: "string", multiple: true },
    exceptions: { type: "string", multiple: true },
  },
});
for (const option of ["mcp", "plexus", "exceptions"]) {
  if (!values[option]?.length) {
    console.error("Usage: pharo-agent-telemetry catalog [--study <directory>] --mcp <MCP checkout> --plexus <PLexus checkout> --exceptions <directory exception-names wrote>\nEach option may be given again: the catalog takes in every checkout named, as for branches not yet merged, and every file of exception names.");
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
 * The Tonel files of a Pharo project's packages, baselines and tests left
 * out: what a release loads for its tools.
 */
function tonelFiles(directory, packagePrefix) {
  const source = path.join(directory, "src");
  return fs.readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(packagePrefix) && !/Tests/.test(entry.name))
    .flatMap((entry) => fs.readdirSync(path.join(source, entry.name)).filter((name) => name.endsWith(".st")).map((name) => path.join(source, entry.name, name)))
    .sort();
}

/**
 * A Pharo project's tools and the words of its own names (every string and
 * symbol of its packages), read from each checkout given.
 */
function pharoProject(directories, packagePrefix) {
  const texts = directories.flatMap((directory) => tonelFiles(directory, packagePrefix).map((file) => fs.readFileSync(file, "utf8")));
  if (texts.length === 0) throw new Error(`No ${packagePrefix} package under ${directories.join(", ")}.`);
  const tools = [...new Set(texts.flatMap(smalltalkToolNames))].sort();
  const words = new Set(texts.flatMap(smalltalkLiterals).flatMap(wordsOf));
  for (const tool of tools) for (const word of wordsOf(tool)) words.add(word);
  return { tools, words, release: directories.map(described).join(" + ") };
}

/**
 * The classes MCP names an exception by, in every image exception-names
 * read, and which images: those of the files given, or of the files in the
 * directories given. A name a catalog could not add, not of a class name's
 * strict shape, is left out, and said; more names than a catalog adds to a
 * set are refused, since an agent of an earlier package would miss some.
 */
function mcpExceptions(paths, allowlist) {
  const files = paths.flatMap((each) => (fs.statSync(each).isDirectory() ? fs.readdirSync(each).filter((name) => name.endsWith(".txt")).map((name) => path.join(each, name)) : [each])).sort();
  const read = files.map((file) => exceptionNames(fs.readFileSync(file, "utf8")));
  if (read.length === 0 || read.some((each) => each.names.length === 0)) throw new Error(`No exception names in ${paths.join(", ")}: run pharo-agent-telemetry exception-names.`);
  const names = [...new Set(read.flatMap((each) => each.names))].sort();
  const kind = allowlist.grows["MCP exception classes"];
  const kept = names.filter((name) => addable(allowlist, kind, name));
  const leftOut = names.filter((name) => !kept.includes(name));
  if (leftOut.length > 0) console.log(`left out of MCP exception classes, not of a class name's strict shape: ${leftOut.join(", ")}`);
  if (kept.length > catalogAdditionCap) throw new Error(`${kept.length} MCP exception classes: a catalog adds at most ${catalogAdditionCap} to a set.`);
  return { names: kept, images: read.flatMap((each) => each.from) };
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
  // The properties the tools share are declared before them, each as `const
  // name = { … } as const;`: read them all rather than a list of names that a
  // new one breaks.
  const context = { schema: (properties, required = []) => ({ type: "object", properties, required }) };
  for (const [, name, value] of text.slice(0, start).matchAll(/^const (\w+) = (\{[\s\S]*?\}) as const;$/gm)) {
    context[name] = vm.runInNewContext(`(${value})`);
  }
  const imageTools = vm.runInNewContext(`(${literal})`, context);
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

const study = readStudy(values.study);
const allowlist = JSON.parse(fs.readFileSync(studyPath(study, "allowlist"), "utf8"));
const mcp = pharoProject(values.mcp, "MCP");
const exceptions = mcpExceptions(values.exceptions, allowlist);
const plexus = plexusProject(values.plexus);
const catalog = {
  $comment: "Generated by `pharo-agent-telemetry catalog` from the source of each release named under `releases`, and from the images named under `images`, in which `pharo-agent-telemetry exception-names` had MCP name the exception classes. Do not edit: run both again for each release of MCP or PLexus, then `pharo-agent-telemetry generate`.",
  published: new Date().toISOString(),
  releases: { MCP: mcp.release, PLexus: plexus.release },
  images: exceptions.images,
  sets: {
    "MCP tools": mcp.tools,
    "PLexus tools": plexus.tools,
    "project words": [...new Set([...mcp.words, ...plexus.words])].sort(),
    "MCP exception classes": exceptions.names,
  },
};
fs.writeFileSync(studyPath(study, "catalog"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${studyFiles.catalog}: ${catalog.sets["MCP tools"].length} MCP tools, ${catalog.sets["PLexus tools"].length} PLexus tools, ${catalog.sets["project words"].length} words, ${exceptions.names.length} MCP exception classes (a catalog adds at most ${catalogAdditionCap} to a set), from ${exceptions.images.length} images`);
