// What scripts/catalog.js reads in the projects' source.
import assert from "node:assert/strict";
import { test } from "node:test";
import { smalltalkLiterals, smalltalkToolNames, withCatalog, wordsOf } from "../src/catalog.js";

test("a name's words are split on _, - and camelCase, in lower case, single characters left out", () => {
  assert.deepEqual(wordsOf("ClassNotFound"), ["class", "not", "found"]);
  assert.deepEqual(wordsOf("method_sourceAt-x"), ["method", "source", "at"]);
  assert.deepEqual(wordsOf("HTTPServer"), ["http", "server"]);
});

test("the strings and unary symbols of Tonel code are read, comments and characters left out", () => {
  const text = `"a comment with 'quotes' and #words"
foo [ ^ #('it''s' #className $' 'two words' #at:put: #'source-code') ]`;
  assert.deepEqual(smalltalkLiterals(text), ["className", "source-code"]);
});

test("a tool class's name is the literal its class-side toolName answers", () => {
  const text = "MCPClassGetTool class >> toolName [\n\t^ 'class_get'\n]\n\nMCPOther >> toolName [ ^ 'not_a_tool' ]";
  assert.deepEqual(smalltalkToolNames(text), ["class_get"]);
});

test("the catalog's sets join the allowlist's, and a set in both is refused", () => {
  const allowlist = { sets: { "agent hosts": ["claude-code"] } };
  const merged = withCatalog(allowlist, { releases: { MCP: "v1" }, sets: { "MCP tools": ["class_get"] } });
  assert.deepEqual(merged.sets, { "agent hosts": ["claude-code"], "MCP tools": ["class_get"] });
  assert.deepEqual(merged.releases, { MCP: "v1" });
  assert.throws(() => withCatalog(allowlist, { releases: {}, sets: { "agent hosts": [] } }), /both in the allowlist and in the catalog/);
});
