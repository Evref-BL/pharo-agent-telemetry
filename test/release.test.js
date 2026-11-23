import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { releaseProblems } from "../scripts/check-release.js";
import { dpoPlaceholder, participantsPage } from "../src/generate.js";
import { missingForJoin, studyPath } from "../src/study.js";
import { allowlist, study } from "./support.js";

const settled = {
  endpoint: "https://c.test",
  token: "t",
  controller: { name: "Example SA", contact: "privacy@example.test" },
  dpo: "dpo@example.test",
  host: { provider: "Example Cloud", region: "Paris", importer: "Example's GitLab", archive: "Example's Elasticsearch" },
};

test("the example study's publish refuses its page as it stands: it has no DPO contact", () => {
  const page = fs.readFileSync(studyPath(study, "page"), "utf8");
  assert.ok(page.includes(dpoPlaceholder));
  assert.ok(releaseProblems(page, missingForJoin(study.collector)).some((problem) => problem.includes("no DPO contact")));
});

test("a page missing only the DPO contact is still refused, and a settled one is not", () => {
  const withoutOfficer = participantsPage(allowlist, { ...study, collector: { ...settled, dpo: undefined } });
  assert.deepEqual(releaseProblems(withoutOfficer, ["dpo"]), [
    "the participants page has no DPO contact: set collector.dpo in study.json and run pharo-agent-telemetry generate",
    "study.json does not set its collector's dpo",
  ]);
  assert.deepEqual(releaseProblems(participantsPage(allowlist, { ...study, collector: settled }), []), []);
});
