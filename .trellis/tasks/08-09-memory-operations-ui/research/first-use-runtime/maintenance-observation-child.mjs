// Task-only entry: bootCore keeps its existing environment, IPC and shutdown ownership.
import { installCoreObservation } from "./maintenance-observation.mjs";
installCoreObservation();
process.argv.push("--observe-maintenance");
await import("./post-reentry-replay.mjs");
