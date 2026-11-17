/** What an import did: how many items it applied and which it left out, with the reason. */
export type ImportSummary = {
  matched: number;
  skipped: { item: string; reason: string }[];
};

export class ImportError extends Error {}
