#!/usr/bin/env node
// Writes a study's catalog.json from the source of the projects whose names
// the filter keeps: the tools MCP, PLexus and any other project the study
// covers publish, and the words of their own names, which a name an agent
// makes up is kept through; and, from what `exception-names` wrote, the
// classes MCP names an exception by in an image of each Pharo version. Run
// it for each release of any of them, from checkouts of that release (each
// option may be given again, for branches not merged yet; --exceptions takes
// files, or the directory exception-names wrote them in):
//
//   pharo-agent-telemetry catalog [--study <directory>] --mcp <MCP> --plexus <PLexus> --exceptions <directory> [--project <name>=<checkout>]...
//
// A project other than MCP and PLexus, which adds tools to MCP in an image
// of its own, goes in sets of its own, `<name> tools` and `<name> words`,
// which the study's allowlist lists under `published`, `vocabulary` and
// `grows` for their names to be kept. Then `pharo-agent-telemetry generate`.
// A name a new release adds is dropped, or kept as _OTHER, until then.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import vm from "node:vm";
import { exceptionNames, pharoProject, wordsOf } from "../src/catalog.js";
import { addable, catalogAdditionCap } from "../src/rules.js";
import { readStudy, studyFiles, studyPath } from "../src/study.js";

const { values } = parseArgs({
  options: {
    study: { type: "string", default: "." },
    mcp: { type: "string", multiple: true },
    plexus: { type: "string", multiple: true },
    exceptions: { type: "string", multiple: true },
    project: { type: "string", multiple: true, default: [] },
  },
});
for (const option of ["mcp", "plexus", "exceptions"]) {
  if (!values[option]?.length) {
    console.error("Usage: pharo-agent-telemetry catalog [--study <directory>] --mcp <MCP checkout> --plexus <PLexus checkout> --exceptions <directory exception-names wrote> [--project <name>=<checkout>]...\nEach option may be given again: the catalog takes in every checkout named, as for branches not yet merged, and every file of exception names. --project names a project that adds tools to MCP, once for each of its checkouts.");
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

/**
 * The other projects named, each with its checkouts: `<name>=<checkout>`,
 * a name given again for each checkout of one project. MCP and PLexus have
 * options of their own, since the rules read their spans.
 */
function otherProjects(given) {
  const projects = new Map();
  for (const each of given) {
    const at = each.indexOf("=");
    const name = each.slice(0, at);
    const checkout = each.slice(at + 1);
    if (at < 1 || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error(`--project ${each}: give <name>=<checkout>, the name a letter then letters, digits, ".", "_" or "-".`);
    if (/^(mcp|plexus)$/i.test(name)) throw new Error(`--project ${each}: ${name} is read from --${name.toLowerCase()}.`);
    if (!fs.existsSync(checkout)) throw new Error(`--project ${each}: no ${checkout}.`);
    projects.set(name, [...(projects.get(name) ?? []), checkout]);
  }
  return [...projects].map(([name, checkouts]) => ({ name, ...pharoProject(checkouts), release: checkouts.map(described).join(" + ") }));
}

/** A set of a project that a catalog adds to whole, or refused when an agent would trim it. */
function fits(name, members) {
  if (members.length > catalogAdditionCap) throw new Error(`${members.length} names in ${name}: a catalog adds at most ${catalogAdditionCap} to a set.`);
  return members;
}

const study = readStudy(values.study);
const allowlist = JSON.parse(fs.readFileSync(studyPath(study, "allowlist"), "utf8"));
let mcp;
let plexus;
let exceptions;
let projects;
try {
  mcp = { ...pharoProject(values.mcp, { packagePrefix: "MCP" }), release: values.mcp.map(described).join(" + ") };
  exceptions = mcpExceptions(values.exceptions, allowlist);
  plexus = plexusProject(values.plexus);
  projects = otherProjects(values.project);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const projectSets = Object.fromEntries(projects.flatMap(({ name, tools, words }) => [[`${name} tools`, fits(`${name} tools`, tools)], [`${name} words`, fits(`${name} words`, [...words].sort())]]));
const catalog = {
  $comment: "Generated by `pharo-agent-telemetry catalog` from the source of each release named under `releases`, and from the images named under `images`, in which `pharo-agent-telemetry exception-names` had MCP name the exception classes. Do not edit: run both again for each release of MCP or PLexus, then `pharo-agent-telemetry generate`.",
  published: new Date().toISOString(),
  releases: { MCP: mcp.release, PLexus: plexus.release, ...Object.fromEntries(projects.map(({ name, release }) => [name, release])) },
  images: exceptions.images,
  sets: {
    "MCP tools": mcp.tools,
    "PLexus tools": plexus.tools,
    "project words": [...new Set([...mcp.words, ...plexus.words])].sort(),
    "MCP exception classes": exceptions.names,
    ...projectSets,
  },
};
fs.writeFileSync(studyPath(study, "catalog"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${studyFiles.catalog}: ${catalog.sets["MCP tools"].length} MCP tools, ${catalog.sets["PLexus tools"].length} PLexus tools, ${catalog.sets["project words"].length} words, ${exceptions.names.length} MCP exception classes${projects.map(({ name, tools, words }) => `, ${tools.length} ${name} tools and ${words.size} words`).join("")} (a catalog adds at most ${catalogAdditionCap} to a set), from ${exceptions.images.length} images`);
// A project's names are kept only through the sets the allowlist lists: say which it does not.
const listed = (key, name) => [].concat(allowlist[key] ?? []).includes(name) || (key === "grows" && name in (allowlist.grows ?? {}));
for (const { name } of projects) {
  for (const [set, key] of [[`${name} tools`, "published"], [`${name} words`, "vocabulary"]]) {
    const missing = [key, "grows"].filter((each) => !listed(each, set));
    if (missing.length > 0) console.log(`${set} is not in the allowlist's ${missing.join(" or ")}: its names are not kept until allowlist.json lists it there.`);
  }
}
