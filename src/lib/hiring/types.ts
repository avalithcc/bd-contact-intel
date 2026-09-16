/**
 * A job posting normalized from an ATS-specific response shape into the
 * common fields the rest of the hiring-signals pipeline works with.
 */
export interface NormalizedPosting {
  // The ATS's own id for this posting (used for per-company dedup).
  externalId: string;
  title: string;
  location: string;
  url: string;
  department?: string;
  postedAt?: Date;
}

/**
 * A source of job postings for one ATS (applicant tracking system). Each
 * adapter knows how to talk to one vendor's public API and normalize its
 * response into `NormalizedPosting[]`. `config` is adapter-specific — see
 * e.g. `LeverConfig` in ./lever.ts — and comes straight from
 * `target_company.config`.
 *
 * New ATS vendors (workday, oracle_hcm, ...) slot in by adding a file here
 * and registering it in ./registry.ts; nothing else in the pipeline needs
 * to change.
 */
export interface JobSource {
  fetchPostings(config: unknown): Promise<NormalizedPosting[]>;
}
