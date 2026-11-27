import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { releaseProblems } from "../scripts/check-release.js";
import { participantsPage } from "../src/generate.js";
import { missingForJoin, studyPath } from "../src/study.js";
import { allowlist, study } from "./support.js";

const settled = {
  endpoint: "https://c.test",
  token: "t",
  controller: { name: "Example SA", contact: "privacy@example.test" },
  dpo: "dpo@example.test",
  host: { provider: "Example Cloud", region: "Paris", importer: "Example's GitLab", archive: "Example's Elasticsearch" },
};

test("the example study's publish refuses its page as it stands: its collector is not set", () => {
  const page = fs.readFileSync(studyPath(study, "page"), "utf8");
  assert.ok(releaseProblems(page, missingForJoin(study.collector)).includes("the participants page says a fact is not set yet"));
});

test("a settled page is released with or without a DPO, and without an authority", () => {
  assert.deepEqual(releaseProblems(participantsPage(allowlist, { ...study, collector: settled }), []), []);
  const { dpo, ...noOfficer } = settled;
  const { authority, ...noAuthority } = study.text;
  const page = participantsPage(allowlist, { ...study, collector: noOfficer, text: noAuthority });
  assert.equal(missingForJoin(noOfficer).includes("dpo"), false);
  assert.deepEqual(releaseProblems(page, []), []);
  assert.doesNotMatch(page, /officer|authority/);
});
