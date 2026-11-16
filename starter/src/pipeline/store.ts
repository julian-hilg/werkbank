import { FAIL_EVERY, FLAKY_JOB, JOBS, JOB_STATUSES, type Job, type JobStatus } from "./data";
import { reachable, runOrder } from "./layout";

/**
 * Statuses of the sample pipeline's jobs. A plain store outside the panels,
 * like the task store: every Pipeline panel shows the same run. Nothing is
 * saved; a reload returns to the sample.
 */
export interface PipelineState {
  statuses: Record<string, JobStatus>;
  /** How many runs have been started. */
  runs: number;
}

type Listener = () => void;
type Timer = ReturnType<typeof setTimeout>;

export class PipelineStore {
  private state: PipelineState;
  private listeners = new Set<Listener>();
  private timers = new Map<string, Timer>();

  constructor(
    readonly jobs: Job[] = JOBS,
    /** How long a job takes on screen, in ms. The sample compresses seconds into fractions of one. */
    private stepMs: (job: Job) => number = (job) => 350 + Math.min(900, job.durationSec * 8),
    private flaky: string = FLAKY_JOB,
  ) {
    this.state = this.initial();
  }

  getState = (): PipelineState => this.state;
  subscribe = (fn: Listener) => (this.listeners.add(fn), () => void this.listeners.delete(fn));
  statusOf = (id: string): JobStatus => this.state.statuses[id] ?? "waiting";
  isRunning = (): boolean => this.jobs.some((j) => this.statusOf(j.id) === "running" || this.statusOf(j.id) === "waiting");
  /** Whether the run that `runs` counts as the latest is (or was) the one with the failing check. */
  failsOnRun = (run: number): boolean => run > 0 && run % FAIL_EVERY === 0;

  /**
   * Start a run: every job waits, then each starts once its upstream jobs are
   * ok. Returns the state before, so the command can be undone.
   */
  run(): PipelineState {
    const before = this.state;
    this.stop();
    this.commit({ statuses: Object.fromEntries(this.jobs.map((j) => [j.id, "waiting" as JobStatus])), runs: before.runs + 1 });
    this.advance();
    return before;
  }

  /** Back to the sample's starting statuses. Returns the state before. */
  reset(): PipelineState {
    const before = this.state;
    this.stop();
    this.commit(this.initial());
    return before;
  }

  /** Put a previous state back (used by undo). A run that was under way continues from there. */
  restore(state: PipelineState): void {
    this.stop();
    this.commit(state);
    this.advance();
  }

  private initial(): PipelineState {
    return { statuses: Object.fromEntries(this.jobs.map((j) => [j.id, j.status])), runs: 0 };
  }

  private stop(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  private set(id: string, status: JobStatus, more: Record<string, JobStatus> = {}): void {
    this.commit({ ...this.state, statuses: { ...this.state.statuses, ...more, [id]: status } });
  }

  /** Start every waiting job whose inputs are ready, and time every running one. */
  private advance(): void {
    for (const id of runOrder(this.jobs)) {
      const job = this.jobs.find((j) => j.id === id)!;
      if (this.statusOf(id) === "waiting" && job.upstream.every((u) => this.statusOf(u) === "ok")) this.set(id, "running");
      if (this.statusOf(id) === "running" && !this.timers.has(id)) this.timers.set(id, setTimeout(() => this.finish(job), this.stepMs(job)));
    }
  }

  private finish(job: Job): void {
    this.timers.delete(job.id);
    if (this.statusOf(job.id) !== "running") return;
    if (job.id === this.flaky && this.failsOnRun(this.state.runs)) {
      // What depends on a failed check keeps its old output: stale, not run.
      const stale = Object.fromEntries([...reachable(this.jobs, job.id, "downstream")].map((id) => [id, "stale" as JobStatus]));
      this.set(job.id, "failed", stale);
    } else {
      this.set(job.id, "ok");
    }
    this.advance();
  }

  private commit(state: PipelineState): void {
    this.state = state;
    this.listeners.forEach((fn) => fn());
  }
}

/** Jobs per status, every status present. */
export function countByStatus(state: PipelineState): Record<JobStatus, number> {
  const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const status of Object.values(state.statuses)) counts[status]++;
  return counts;
}

export const pipeline = new PipelineStore();
