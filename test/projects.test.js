// A study of the tools a project of its own adds to MCP: the catalog reads
// them from the project's source as it reads MCP's, and the filter keeps
// their names once the study's allowlist publishes them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pharoProject, withCatalog } from "../src/catalog.js";
import { createTransform } from "../src/rules.js";
import { comparable, testKey } from "./support.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Writes files under a directory, from a map of relative paths to contents. */
function write(directory, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
  return directory;
}

const toolClass = (className, toolName, property) => `Class {
	#name : '${className}',
	#superclass : 'MCPTool',
	#category : 'Widgets-MCP',
	#package : 'Widgets-MCP'
}

{ #category : 'accessing' }
${className} class >> toolName [

	^ '${toolName}'
]

{ #category : 'accessing' }
${className} >> buildInputSchema [

	^ MCPStructureInputSchema
		  properties: { (self schemaPropertyNamed: '${property}' type: 'string' description: 'Only answer widgets whose name starts with this.') }
		  required: #(  )
]
`;

/** A project that adds a tool to MCP, in a source directory of its own, beside a package with no tool and its tests. */
function widgetsProject(directory) {
  return write(directory, {
    ".project": "{\n\t'srcDirectory' : 'repository'\n}\n",
    "repository/Widgets-MCP/WidgetsToolListWidgets.class.st": toolClass("WidgetsToolListWidgets", "widget_list", "prefix"),
    "repository/Widgets-Core/WidgetsInventory.class.st": "Class {\n\t#name : 'WidgetsInventory',\n\t#superclass : 'Object',\n\t#package : 'Widgets-Core'\n}\n\n{ #category : 'accessing' }\nWidgetsInventory >> secretLedger [\n\n\t^ #confidentialAccount\n]\n",
    "repository/Widgets-MCP-Tests/WidgetsToolListWidgetsTest.class.st": toolClass("WidgetsToolTestOnly", "widget_test_only", "fixture"),
    "repository/BaselineOfWidgets/BaselineOfWidgets.class.st": "Class {\n\t#name : 'BaselineOfWidgets',\n\t#superclass : 'BaselineOf',\n\t#package : 'BaselineOfWidgets'\n}\n\n{ #category : 'baselines' }\nBaselineOfWidgets >> baseline: spec [\n\n\t^ 'baselineOnlyWord'\n]\n",
  });
}

test("a project's tools and the words of its packages that add tools are read from its Tonel source, tests and baselines left out", () => {
  const directory = widgetsProject(fs.mkdtempSync(path.join(os.tmpdir(), "pat-widgets-")));
  try {
    const { tools, words } = pharoProject([directory]);
    assert.deepEqual(tools, ["widget_list"]);
    for (const word of ["widget", "list", "prefix", "widgets", "tool", "string"]) assert.ok(words.has(word), word);
    for (const word of ["secret", "ledger", "confidential", "fixture", "baseline"]) assert.ok(!words.has(word), word);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("catalog reads any project named, beside MCP and PLexus, into sets of its own, and says which the allowlist does not use", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pat-catalog-"));
  try {
    const mcp = write(path.join(work, "MCP"), {
      ".project": "{\n\t'srcDirectory' : 'src'\n}\n",
      "src/MCP-Core/MCPToolGetClass.class.st": toolClass("MCPToolGetClass", "class_get", "name"),
    });
    const plexus = write(path.join(work, "PLexus"), {
      "packages/plexus/src/mcp/server.ts": 'const image = { type: "string" } as const;\nexport const imageTools = [\n  { name: "image_list", inputSchema: schema({ name: image }) },\n];\nconst forwarded = { properties: { image: image } };\n',
    });
    const exceptions = write(path.join(work, "exceptions"), { "pharo-14.txt": "# MCP 9.9.9 in Pharo-14\nError\nZeroDivide\n" });
    const widgets = widgetsProject(path.join(work, "Widgets"));
    const studyDirectory = path.join(work, "study");
    fs.cpSync(path.join(root, "example"), studyDirectory, { recursive: true });
    const run = (...projects) =>
      spawnSync(process.execPath, [path.join(root, "scripts", "catalog.js"), "--study", studyDirectory, "--mcp", mcp, "--plexus", plexus, "--exceptions", exceptions, ...projects.flatMap((each) => ["--project", each])], { encoding: "utf8" });

    const read = run(`Widgets=${widgets}`);
    assert.equal(read.status, 0, read.stderr);
    const catalog = readJson(path.join(studyDirectory, "catalog.json"));
    assert.deepEqual(catalog.sets["Widgets tools"], ["widget_list"]);
    assert.ok(catalog.sets["Widgets words"].includes("prefix"));
    assert.ok(!catalog.sets["Widgets words"].includes("secret"));
    assert.deepEqual(catalog.sets["MCP tools"], ["class_get"]);
    assert.ok("Widgets" in catalog.releases);
    // The example's allowlist names neither set: catalog says so, since their names would not be kept.
    assert.match(read.stdout, /Widgets tools[^\n]*published/);
    assert.match(read.stdout, /Widgets words[^\n]*vocabulary/);

    assert.notEqual(run(`MCP=${widgets}`).status, 0, "MCP and PLexus are named by their own options");
    assert.notEqual(run(`not a name=${widgets}`).status, 0);
    assert.notEqual(run(`Widgets=${path.join(work, "missing")}`).status, 0);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("the names of another package's tool are kept once the study publishes its tools and words, as MCP's are", () => {
  const fixture = readJson(path.join(root, "example", "rules", "origin.json"));
  const request = structuredClone(fixture.request);
  const scope = request.resourceSpans[0].scopeSpans[0];
  const [template] = scope.spans;
  const call = (tool, spanId) => ({
    ...template,
    spanId,
    name: `tools/call ${tool}`,
    attributes: [
      ...template.attributes.filter(({ key }) => !["gen_ai.tool.name", "pharo.mcp.tool.origin", "pharo.mcp.argument.names", "pharo.mcp.argument.unknown_names", "pharo.mcp.argument.coerced", "pharo.mcp.argument.options"].includes(key)),
      { key: "gen_ai.tool.name", value: { stringValue: tool } },
      { key: "pharo.mcp.tool.origin", value: { stringValue: "other" } },
      { key: "pharo.mcp.argument.names", value: { arrayValue: { values: [{ stringValue: "prefix" }] } } },
    ],
  });
  // One request a call: the filter's hashed ids leave no order between spans.
  const requestOf = (tool) => {
    scope.spans = [call(tool, "dddddddddddd0001")];
    return structuredClone(request);
  };

  const allowlist = readJson(path.join(root, "example", "allowlist.json"));
  const catalog = readJson(path.join(root, "example", "catalog.json"));
  catalog.sets["Widgets tools"] = ["widget_list"];
  catalog.sets["Widgets words"] = ["widget", "widgets", "list", "prefix"];
  allowlist.published = [...allowlist.published, "Widgets tools"];
  allowlist.vocabulary = [...allowlist.vocabulary, "Widgets words"];
  allowlist.grows = { ...allowlist.grows, "Widgets tools": "tool", "Widgets words": "word" };

  const kept = (list, tool) => comparable([createTransform(list, testKey)("traces", requestOf(tool))])[0].attributes;
  const study = withCatalog(allowlist, catalog);
  const published = kept(study, "widget_list");
  assert.equal(published["gen_ai.tool.name"], "widget_list");
  assert.deepEqual(published["pharo.mcp.argument.names"], ["prefix"]);
  const unpublished = kept(study, "gadget_list");
  assert.equal(unpublished["gen_ai.tool.name"], "_OTHER");
  assert.equal(unpublished["pharo.mcp.argument.names"], undefined);

  // The same call through the example study, which publishes no such tool: its names go.
  const example = kept(withCatalog(readJson(path.join(root, "example", "allowlist.json")), readJson(path.join(root, "example", "catalog.json"))), "widget_list");
  assert.equal(example["gen_ai.tool.name"], "_OTHER");
  assert.equal(example["pharo.mcp.argument.names"], undefined);
});
