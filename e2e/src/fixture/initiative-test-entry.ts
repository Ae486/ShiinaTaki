/**
 * INPUT: the isolated Core environment and IPC scenario commands from initiative process tests.
 * OUTPUT: calls to the real composed initiative service; production main gains no test API or RPC.
 * POS: e2e/fixture — test-only module-loader instrumentation and controllable source/delivery evidence.
 */
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_DIR } from "./paths.ts";

const mainUrl = pathToFileURL(join(CORE_DIR, "src/main.ts")).href;
const hook = registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== mainUrl) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
    if (!/\bconst\s+(?:initiativeRuntime\b|\{[^}]*\binitiativeRuntime\b)/.test(source)) {
      throw new Error("missing composed initiative service");
    }
    return { ...loaded, source: `${source}\nexport { initiativeRuntime, turnControls };\n` };
  },
});
let composed: Record<string, unknown>;
try { composed = await import(mainUrl) as Record<string, unknown>; }
finally { hook.deregister(); }

interface SourceFacts { current: boolean; gate: "ready" | "hold" | "suppress" }
const facts = new Map<string, SourceFacts>();
const runtime = object(composed.initiativeRuntime);
const queue = object(object(composed.turnControls).queue);
const reservations = new Map<string, Record<string, unknown>>();

if (!process.send) throw new Error("initiative test entry requires IPC");
process.on("message", (message) => {
  const command = object(message);
  void handle(command).then(
    (result) => send({ id: command.id, result }),
    (error: unknown) => send({ id: command.id, error: error instanceof Error ? error.message : "test command failed" }),
  );
});
send({ ready: true });

async function handle(command: Record<string, unknown>): Promise<unknown> {
  switch (command.action) {
    case "dispatch": {
      const opportunity = object(command.opportunity);
      if (typeof opportunity.opportunityId !== "string") throw new Error("missing opportunity identity");
      const evidence = facts.get(opportunity.opportunityId)
        ?? { current: command.current !== false, gate: gate(command.gate) };
      facts.set(opportunity.opportunityId, evidence);
      return invoke(runtime, "dispatch", [{ ...opportunity,
        isCurrent: () => evidence.current, deliveryGate: () => evidence.gate,
      }]);
    }
    case "resume": return invoke(runtime, "resume", [command.runId]);
    case "facts": {
      const evidence = facts.get(String(command.opportunityId));
      if (!evidence) throw new Error("unknown test opportunity");
      if (typeof command.current === "boolean") evidence.current = command.current;
      if (command.gate !== undefined) evidence.gate = gate(command.gate);
      return { updated: true };
    }
    case "stop": {
      process.disconnect();
      process.emit("SIGINT", "SIGINT");
      return undefined;
    }
    default: return handleQueue(command);
  }
}

async function handleQueue(command: Record<string, unknown>): Promise<unknown> {
  const characterId = command.characterId ?? "taki";
  if (command.action === "primary-version") return invoke(queue, "primaryVersion", [characterId]);
  if (command.action === "primary-reserve") {
    const reservation = object(await invoke(queue, "reservePrimary", [characterId]));
    reservations.set(String(command.reservationId), reservation);
    return { reserved: true };
  }
  if (command.action === "primary-cancel") {
    const key = String(command.reservationId);
    const reservation = reservations.get(key);
    if (!reservation) throw new Error("unknown test reservation");
    await invoke(reservation, "cancel", []);
    reservations.delete(key);
    return { cancelled: true };
  }
  if (command.action === "background-probe") {
    const release = await invoke(queue, "tryAcquireBackground", [characterId]);
    if (typeof release !== "function") return { acquired: false };
    release();
    return { acquired: true };
  }
  throw new Error("unknown initiative test action");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid test object");
  return value as Record<string, unknown>;
}

function gate(value: unknown): SourceFacts["gate"] {
  if (value === undefined) return "ready";
  if (value === "ready" || value === "hold" || value === "suppress") return value;
  throw new Error("invalid test delivery gate");
}

function invoke(target: Record<string, unknown>, method: string, args: unknown[]): Promise<unknown> {
  const operation = target[method];
  if (typeof operation !== "function") throw new Error(`missing initiative method: ${method}`);
  return Promise.resolve(Reflect.apply(operation, target, args));
}

function send(value: unknown): void {
  if (process.connected) process.send?.(value);
}
