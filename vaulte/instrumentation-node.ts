// Start the in-process scheduler when asked to (ENABLE_INTERNAL_SCHEDULER=true). See lib/scheduler.ts.
import { startScheduler } from "./lib/scheduler";

if (process.env.ENABLE_INTERNAL_SCHEDULER === "true") startScheduler();
