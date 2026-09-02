// The catalog itself is generated data; it lives in the sibling JSON file so it
// stays out of the source tree's line count. See its `source` / `version` keys
// for the REBASE release it was cut from.
import catalog from './commercial-restriction-enzymes.json' with { type: 'json' };

export const COMMERCIAL_RESTRICTION_ENZYMES = Object.freeze(catalog.enzymes);
