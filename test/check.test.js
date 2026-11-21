import assert from "node:assert/strict";
import test from "node:test";
import { checkDeployment, checkRequest } from "../src/check.js";

test("the check's span is marked as one, and names no tool", () => {
  const [resourceSpans] = JSON.parse(checkRequest(0)).resourceSpans;
  assert.deepEqual(resourceSpans.resource.attributes.find((each) => each.key === "deployment.environment.name").value, { stringValue: "check" });
  assert.equal(resourceSpans.scopeSpans[0].spans[0].name, "check");
});

test("says which expectation a collector broke, and what it answered instead", async () => {
  // A collector that takes anything: no token, any path.
  const lax = async () => new Response("{}", { status: 200 });
  const results = await checkDeployment("https://collector.test/", "token", lax);
  assert.deepEqual(results.filter((result) => result.held).map((result) => result.expectation), ["a span with the token is taken"]);
  assert.equal(results[0].saw, "200");

  const unreachable = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
  const failed = await checkDeployment("https://collector.test", "token", unreachable);
  assert.ok(failed.every((result) => !result.held && result.saw === "no answer (ENOTFOUND)"));
});
