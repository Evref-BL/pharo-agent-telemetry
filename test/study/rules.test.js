// The study's filter against its rule fixtures. collector.test.js sends the
// same fixtures through the study's collector and requires the same spans,
// so the two filters agree.
import assert from "node:assert/strict";
import test from "node:test";
import { compile, transformTraces } from "../../src/rules.js";
import { allowlist, comparable, expectedSpans, ruleFixtures, testKey, transformModule } from "../support.js";

// The places in sessions and the filter's version are the agent's alone, which the collector cannot know: tests of their own check them.
const transform = transformModule.filter(testKey, { offsets: false, filterVersion: undefined });

for (const fixture of ruleFixtures()) {
  test(`the agent's filter: ${fixture.name}: ${fixture.about}`, () => {
    assert.deepEqual(comparable([transform("traces", fixture.request)]), expectedSpans(fixture));
  });
}

test("applying the rules again, ids aside, changes nothing", () => {
  const rules = compile(allowlist);
  for (const fixture of ruleFixtures()) {
    const once = transformTraces(rules, fixture.request, {});
    const twice = transformTraces(rules, once, {});
    assert.deepEqual(twice, once, fixture.name);
  }
});
