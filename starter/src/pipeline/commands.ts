import type { Command, Werkbank } from "@werkbank/framework";
import { FAIL_EVERY, FLAKY_JOB } from "./data";
import { runOrder } from "./layout";
import { pipeline, type PipelineState } from "./store";

/**
 * Pipeline commands. They change the sample pipeline's statuses and nothing
 * outside the app, and each can be undone by putting the previous statuses
 * back, so they are "local".
 */
export const pipelineCommands: Command<Werkbank, any>[] = [
  {
    id: "pipeline.run",
    title: "Run pipeline",
    category: "Pipeline",
    risk: "local",
    run: () => {
      const before = pipeline.run();
      const run = pipeline.getState().runs;
      return {
        run,
        order: runOrder(pipeline.jobs),
        note: pipeline.failsOnRun(run) ? `Sample run: "${FLAKY_JOB}" fails on every run number divisible by ${FAIL_EVERY}, this one included.` : "Sample run: statuses advance on timers over a few seconds.",
        before,
      };
    },
    undo: (_ctx, _input, result) => pipeline.restore((result as { before: PipelineState }).before),
  },
  {
    id: "pipeline.reset",
    title: "Reset pipeline",
    category: "Pipeline",
    risk: "local",
    run: () => ({ before: pipeline.reset() }),
    undo: (_ctx, _input, result) => pipeline.restore((result as { before: PipelineState }).before),
  },
];
