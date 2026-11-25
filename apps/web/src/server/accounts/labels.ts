// Client-safe labels (no server imports).
export const BUCKETS = ["cash", "taxable", "traditional", "roth", "hsa", "excluded"] as const;
export type BucketKey = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<BucketKey, string> = {
  cash: "Cash (checking, savings)",
  taxable: "Taxable investments",
  traditional: "Traditional (401k, IRA)",
  roth: "Roth",
  hsa: "HSA",
  excluded: "Not part of FI (home, car, 529)",
};
