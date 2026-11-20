// Where participants send their traces. Both are public: the token keeps
// scanners out, not people. Empty until the collector is deployed; `join`
// refuses until then unless given `--endpoint`.

/** @type {string | undefined} */
export const publicEndpoint = undefined;

/** @type {string | undefined} */
export const publicToken = undefined;
