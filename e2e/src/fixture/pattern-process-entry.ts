/** Real production composition; IPC only provides ready/stop process lifecycle, never dispatch or source facts. */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_DIR } from "./paths.ts";
await import(pathToFileURL(join(CORE_DIR, "src/main.ts")).href);
process.on("message", (message: unknown) => {
  if (message && typeof message === "object" && "action" in message && message.action === "stop") {
    process.emit("SIGTERM"); process.disconnect?.();
  }
});
process.send?.({ ready: true });
