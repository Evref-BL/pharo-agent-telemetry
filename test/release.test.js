import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { releaseProblems } from "../scripts/check-release.js";
import { dpoPlaceholder, participantsPage, readAllowlist } from "../src/generate.js";

const allowlist = readAllowlist(new URL("..", import.meta.url).pathname);
const settled = {
  endpoint: "https://c.test",
  token: "t",
  controller: { name: "Example SA", contact: "privacy@example.test" },
  dpo: "dpo@example.test",
  host: { provider: "Example Cloud", region: "Paris", importer: "Example's GitLab", archive: "Example's Elasticsearch" },
};

test("npm publish refuses the page as it stands: it has no DPO contact yet", () => {
  const page = fs.readFileSync(new URL("../docs/participants.md", import.meta.url), "utf8");
  assert.ok(page.includes(dpoPlaceholder));
  assert.ok(releaseProblems(page).some((problem) => problem.includes("no DPO contact")));
});

test("a page missing only the DPO contact is still refused, and a settled one is not", () => {
  const withoutOfficer = participantsPage(allowlist, { ...settled, dpo: undefined });
  assert.deepEqual(releaseProblems(withoutOfficer, ["dpo"]), [
    "the participants page has no DPO contact: set dpo in src/collector.js and run npm run generate",
    "src/collector.js does not set its dpo",
  ]);
  assert.deepEqual(releaseProblems(participantsPage(allowlist, settled), []), []);
});
