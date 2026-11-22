// What scripts/catalog.js reads in the projects' source.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exceptionClasses, smalltalkLiterals, smalltalkToolNames, withCatalog, wordsOf } from "../src/catalog.js";

test("a name's words are split on _, - and camelCase, in lower case, one-letter words kept", () => {
  assert.deepEqual(wordsOf("ClassNotFound"), ["class", "not", "found"]);
  assert.deepEqual(wordsOf("method_sourceAt-x"), ["method", "source", "at", "x"]);
  assert.deepEqual(wordsOf("HTTPServer"), ["http", "server"]);
  assert.deepEqual(wordsOf("NotATestClass"), ["not", "a", "test", "class"]);
  assert.deepEqual(wordsOf("2fa_code"), ["code"]);
});

test("the exception classes a project can name: those it refers to, its tests' strings included, and those it defines below one", () => {
  const code = `"A comment naming CommentOnlyError"
Class {
	#name : 'MCPInvalidToolInput',
	#superclass : 'JRPCInvalidParameters',
	#category : 'MCP'
}
Class {
	#name : 'MCPTool',
	#superclass : 'Object',
	#category : 'MCP'
}
MCPTool >> run [ ^ [ self compile ] on: OCUndeclaredVariableNotice do: [ :e | $" ] ]`;
  const test = "MCPToolTest >> testCompile [ self assert: (self typeOf: 'x') equals: 'OCSyntaxErrorNotice' ]";
  assert.deepEqual(exceptionClasses([code], [test]), ["MCPInvalidToolInput", "OCSyntaxErrorNotice", "OCUndeclaredVariableNotice"]);
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
