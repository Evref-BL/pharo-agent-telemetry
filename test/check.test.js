import assert from "node:assert/strict";
import test from "node:test";
import { checkDeployment, checkRequest } from "../src/check.js";
import { allowlist, transformModule } from "./support.js";

const { filter } = transformModule;
import { testKey } from "./support.js";

test("the check's span is of no service of ours, so the rules keep nothing of it", () => {
  assert.equal(filter(testKey)("traces", JSON.parse(checkRequest(0))), null);
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

test("the catalog is checked where the agents ask for it: signed, readable, dated no later than now, and holding only what they take", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const http = await import("node:http");
  const { catalogPayload, publicKeyOf, signCatalog } = await import("../src/catalog.js");
  const key = /** @type {string} */ (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
  let served = "";
  const server = http.createServer((request, response) => (request.url === "/custom/catalog.json" ? response.writeHead(200).end(served) : response.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const answered = async () => new Response("{}", { status: 200 });
  const check = (url) => checkDeployment(base, "token", answered, { publicKey: publicKeyOf(key), url, allowlist, sets: catalogPayload(allowlist, "").sets });
  const failed = async (url) => (await check(url)).filter((result) => !result.held && /catalog/.test(result.expectation)).map((result) => result.saw);
  try {
    served = signCatalog(catalogPayload(allowlist, new Date(Date.now() - 60_000).toISOString()), key);
    assert.deepEqual(await failed(`${base}/custom/catalog.json`), []);
    // Not where catalogUrl says, the catalog is not served.
    assert.deepEqual(await failed(undefined), ["HTTP 404"]);
    served = signCatalog(catalogPayload(allowlist, "2099-01-01T00:00:00.000Z"), key);
    assert.deepEqual(await failed(`${base}/custom/catalog.json`), ["it is dated 2099-01-01T00:00:00.000Z, in the future"]);
    const payload = catalogPayload(allowlist, new Date(Date.now() - 60_000).toISOString());
    served = signCatalog({ ...payload, sets: { ...payload.sets, "agent hosts": ["evil-host"] } }, key);
    assert.deepEqual(await failed(`${base}/custom/catalog.json`), ["other sets"]);
    served = signCatalog({ ...payload, published: "Nov 23 2026" }, key);
    assert.match((await failed(`${base}/custom/catalog.json`))[0], /its date is not a UTC date/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});
