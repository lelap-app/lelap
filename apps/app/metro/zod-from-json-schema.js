// Stands in for zod's `fromJSONSchema` (about 38 KB), which Lelap never calls but Metro would put
// into the start bundle through zod's index (M126). See metro.config.js.
export function fromJSONSchema() {
  throw new Error('fromJSONSchema is left out of the app.');
}
