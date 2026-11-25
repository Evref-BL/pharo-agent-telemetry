import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// npm and GitHub find the licence by its text, not by package.json.
test("ships the full text of the licence it declares", () => {
  assert.equal(JSON.parse(read("package.json")).license, "MIT");
  const license = read("LICENSE");
  assert.match(license, /^MIT License\n\nCopyright \(c\) \d{4} \S/);
  assert.ok(license.includes("Permission is hereby granted, free of charge"));
  assert.ok(license.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
});
