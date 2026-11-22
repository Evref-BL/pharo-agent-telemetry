// Where participants send their traces, and who answers for them. Every
// field is empty until the collector is deployed and the controller named;
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

/** What `join` lacks before it may send to the project's collector, by name. */
export function missingForJoin(collector = { endpoint: publicEndpoint, token: publicToken, controller, dpo, host }) {
  return Object.entries({ endpoint: collector.endpoint, token: collector.token, controller: collector.controller, dpo: collector.dpo, host: collector.host })
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
}
