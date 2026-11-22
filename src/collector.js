// Where participants send their traces, who answers for them, and where the
// agents find a newer catalog. Every field is empty until the collector is
// deployed and the controller named;
// `join` refuses the project's collector until all are set, the participants
// page says what is missing rather than inventing it, and `npm publish`
// refuses while the page says so (scripts/check-release.js).

/** The collector's public URL. @type {string | undefined} */
export const publicEndpoint = undefined;

/** The shared token. Public: it keeps scanners out, not people. @type {string | undefined} */
export const publicToken = undefined;

/**
 * Who decides why and how the data is processed, the GDPR's controller, and
 * how a participant reaches them.
 *
 * @type {{ name: string, contact: string } | undefined}
 */
export const controller = undefined;

/**
 * How a participant reaches the controller's data protection officer, as
 * the page names it (for one, "dpo@example.org").
 *
 * @type {string | undefined}
 */
export const dpo = undefined;

/**
 * Where the data is: the company hosting the collector's VM, the GDPR's
 * processor, the region the VM is in, the GitLab whose scheduled job copies
 * the archive every day, and where it keeps it, as the page names them (for
 * one, "Berger-Levrault's GitLab" and "Berger-Levrault's Elasticsearch, in
 * France").
 *
 * @type {{ provider: string, region: string, importer: string, archive: string } | undefined}
 */
export const host = undefined;

/**
 * Where the agents ask for a newer catalog of the names the filter keeps: a
 * URL on the collector's own host, which serves it as
 * `/pharo-agent-telemetry/catalog.json` (for one,
 * "https://telemetry.example.org/pharo-agent-telemetry/catalog.json").
 *
 * @type {string | undefined}
 */
export const catalogUrl = undefined;

/**
 * The Ed25519 public key the agents check a catalog's signature with: the
 * `x` of its JWK, base64url, as `npm run sign-catalog -- --new-key` prints
 * it. The private key is the administrators' alone, never in this
 * repository.
 *
 * @type {string | undefined}
 */
export const catalogPublicKey = undefined;

/** Whether a URL is on the same host as the collector's endpoint, over HTTPS as it is. */
function onHostOf(url, endpoint) {
  try {
    const target = new URL(url);
    const base = new URL(endpoint);
    return target.host === base.host && target.protocol === base.protocol;
  } catch {
    return false;
  }
}

/** What `join` lacks before it may send to the project's collector, by name; a catalog URL on another host than the collector's is lacking too. */
export function missingForJoin(collector = { endpoint: publicEndpoint, token: publicToken, controller, dpo, host, catalogUrl, catalogPublicKey }) {
  return Object.entries({
    endpoint: collector.endpoint,
    token: collector.token,
    controller: collector.controller,
    dpo: collector.dpo,
    host: collector.host,
    catalogUrl: collector.catalogUrl !== undefined && collector.endpoint !== undefined && !onHostOf(collector.catalogUrl, collector.endpoint) ? undefined : collector.catalogUrl,
    catalogPublicKey: collector.catalogPublicKey,
  })
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
}
