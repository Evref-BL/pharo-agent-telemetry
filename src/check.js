// What a deployed collector must do, asked from outside as a participant's
// tools reach it: refuse a request without the token, serve nothing but
// /v1/traces and the signed catalog, and take a span with it. The span is of
// no service of ours, so the collector takes it and keeps nothing of it: the
// archive never holds a check.
import { fetchCatalog, verifyCatalog } from "./agent.js";
import { catalogLeftOut, catalogProblem } from "./rules.js";

/** A span of no tool, as the check sends it. */
export function checkRequest(now = Date.now()) {
  const nanos = BigInt(now) * 1_000_000n;
  return JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [
        { key: "service.name", value: { stringValue: "pharo-agent-telemetry" } },
        { key: "deployment.environment.name", value: { stringValue: "check" } },
      ] },
      scopeSpans: [{ scope: { name: "pharo-agent-telemetry" }, spans: [{
        traceId: [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        spanId: [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        name: "check",
        kind: 1,
        startTimeUnixNano: String(nanos),
        endTimeUnixNano: String(nanos + 1_000_000n),
      }] }],
    }],
  });
}

/**
 * Each expectation of a deployed collector, and whether it held.
 *
 * With `publicKey`, the catalog the agents ask for at `url` must be served,
 * signed by its private key, readable by the agents and dated no later than
 * now; with `allowlist` too, it must hold the sets that grow as the
 * collector's configuration was generated with, and nothing the agents
 * would leave out.
 *
 * @param {string} endpoint the collector's public URL
 * @param {string} token
 * @param {typeof fetch} [fetcher]
 * @param {{ publicKey?: string, url?: string, sets?: Record<string, string[]>, allowlist?: any, now?: number }} [catalog]
 * @returns {Promise<Array<{ expectation: string, held: boolean, saw: string }>>}
 */
export async function checkDeployment(endpoint, token, fetcher = fetch, { publicKey, url, sets, allowlist, now = Date.now() } = {}) {
  const base = endpoint.replace(/\/+$/, "");
  const post = (path, headers) => fetcher(`${base}${path}`, {
    method: "POST",
    body: checkRequest(),
    headers: { "content-type": "application/json", ...headers },
  });
  const status = async (request) => {
    try {
      return String((await request).status);
    } catch (error) {
      return `no answer (${error instanceof Error ? error.cause?.code ?? error.message : String(error)})`;
    }
  };
  const results = [];
  const expect = async (expectation, request, wanted) => {
    const saw = await status(request);
    results.push({ expectation, held: saw === wanted, saw });
  };
  await expect("a request without the token is refused", post("/v1/traces", {}), "401");
  await expect("a request with another token is refused", post("/v1/traces", { authorization: "Bearer not-the-token" }), "401");
  await expect("nothing but /v1/traces is served", post("/v1/logs", { authorization: `Bearer ${token}` }), "404");
  await expect("the root serves nothing", fetcher(`${base}/`), "404");
  await expect("a span with the token is taken", post("/v1/traces", { authorization: `Bearer ${token}` }), "200");
  if (publicKey !== undefined) {
    const fetched = await fetchCatalog(url ?? `${base}/pharo-agent-telemetry/catalog.json`);
    const verified = "text" in fetched ? verifyCatalog(fetched.text, publicKey) : { refused: fetched.failure };
    results.push({ expectation: "the catalog is served, signed by the study's key", held: "payload" in verified, saw: "payload" in verified ? `the catalog of ${verified.payload?.published}` : verified.refused });
    if ("payload" in verified) {
      const problem = catalogProblem(verified.payload) ?? (Date.parse(verified.payload.published) > now + 300_000 ? `it is dated ${verified.payload.published}, in the future` : undefined);
      results.push({ expectation: "the agents can read the catalog, and it is dated no later than now", held: problem === undefined, saw: problem ?? `form ${verified.payload.schema}, of ${verified.payload.published}` });
      if (sets !== undefined && allowlist !== undefined) {
        const same = JSON.stringify(verified.payload.sets) === JSON.stringify(sets);
        const leftOut = catalogLeftOut(allowlist, verified.payload);
        results.push({ expectation: "the catalog holds the sets the collector's configuration was generated with, and nothing the agents leave out", held: same && leftOut.length === 0, saw: !same ? "other sets" : leftOut.length > 0 ? `the agents leave out ${leftOut.slice(0, 3).join(", ")}` : "the same sets" });
      }
    }
  }
  return results;
}
