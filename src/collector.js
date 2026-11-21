// Where participants send their traces, and who answers for them. Every
// field is empty until the collector is deployed and the controller named;
// `join` refuses the project's collector until all are set, and the
// participants page says what is missing rather than inventing it.

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
 * Where the data is: the company hosting the collector's VM, the GDPR's
 * processor, the region the VM is in, and where the daily import keeps the
 * archive, as the page names it (for one, "Berger-Levrault's Elasticsearch,
 * in France").
 *
 * @type {{ provider: string, region: string, archive: string } | undefined}
 */
export const host = undefined;

/** What `join` lacks before it may send to the project's collector, by name. */
export function missingForJoin(collector = { endpoint: publicEndpoint, token: publicToken, controller, host }) {
  return Object.entries({ endpoint: collector.endpoint, token: collector.token, controller: collector.controller, host: collector.host })
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
}
