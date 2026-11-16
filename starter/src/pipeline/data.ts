/**
 * An invented data pipeline: the sample behind the Pipeline panel. Nothing
 * here runs anything; durations and row counts are made up.
 */
export const KINDS = ["source", "transform", "check", "output"] as const;
export type JobKind = (typeof KINDS)[number];
export const JOB_STATUSES = ["ok", "running", "failed", "stale", "waiting"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  name: string;
  kind: JobKind;
  /** Ids of the jobs whose output this one reads. */
  upstream: string[];
  /** Duration of the last run, in seconds. */
  durationSec: number;
  /** Rows written by the last run. */
  rowsOut: number;
  /** Status the sample starts in. The live status is in the pipeline store. */
  status: JobStatus;
}

export const JOBS: Job[] = [
  { id: "src-prices", name: "vendor prices", kind: "source", upstream: [], durationSec: 42, rowsOut: 1_840_000, status: "ok" },
  { id: "src-calendar", name: "trading calendar", kind: "source", upstream: [], durationSec: 3, rowsOut: 2_610, status: "ok" },
  { id: "src-filings", name: "filings", kind: "source", upstream: [], durationSec: 95, rowsOut: 12_400, status: "ok" },
  { id: "clean-prices", name: "clean prices", kind: "transform", upstream: ["src-prices", "src-calendar"], durationSec: 61, rowsOut: 1_812_300, status: "ok" },
  { id: "parse-filings", name: "parse filings", kind: "transform", upstream: ["src-filings"], durationSec: 130, rowsOut: 11_950, status: "ok" },
  { id: "check-gaps", name: "gap check", kind: "check", upstream: ["clean-prices"], durationSec: 8, rowsOut: 0, status: "ok" },
  { id: "daily-returns", name: "daily returns", kind: "transform", upstream: ["check-gaps"], durationSec: 24, rowsOut: 1_804_900, status: "ok" },
  { id: "fundamentals", name: "fundamentals", kind: "transform", upstream: ["parse-filings"], durationSec: 37, rowsOut: 9_870, status: "ok" },
  { id: "join-factors", name: "join factors", kind: "transform", upstream: ["daily-returns", "fundamentals"], durationSec: 78, rowsOut: 1_798_200, status: "ok" },
  { id: "check-totals", name: "reconcile totals", kind: "check", upstream: ["join-factors"], durationSec: 12, rowsOut: 0, status: "ok" },
  { id: "risk-report", name: "risk report", kind: "output", upstream: ["check-totals"], durationSec: 19, rowsOut: 640, status: "ok" },
  { id: "warehouse-export", name: "warehouse export", kind: "output", upstream: ["check-totals", "daily-returns"], durationSec: 54, rowsOut: 1_798_200, status: "stale" },
];

/** The check that fails on every third run, so the failure path can be seen. */
export const FLAKY_JOB = "check-totals";
export const FAIL_EVERY = 3;
