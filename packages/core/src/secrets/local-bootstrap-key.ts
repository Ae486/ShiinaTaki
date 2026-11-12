/**
 * INPUT: configured native helper executable and internally derived local-bootstrap account.
 * OUTPUT: asynchronous create-only 32-byte key source with sanitized unavailable failures.
 * POS: core/secrets — sanctioned native security-helper seam; never blocks the Core event loop.
 */
import { spawn } from "node:child_process";
import { decodeFramedKey, frameKey } from "./master-key.ts";

export interface LocalBootstrapKeySource {
  read(): Uint8Array | null | Promise<Uint8Array | null>;
  readonly canCreate: boolean;
  create(key: Uint8Array): void | Promise<void>;
}

export function localBootstrapKeySource(helper: string | undefined, account: string): LocalBootstrapKeySource | null {
  if (!helper) return null;
  return {
    canCreate: true,
    async read() {
      const result = await runHelper({ helper, account, operation: "get" });
      if (result.status === 3) return null;
      if (result.status !== 0) throw new Error("Local credential helper is unavailable");
      const key = decodeFramedKey(result.stdout);
      if (key?.length !== 32) throw new Error("Local credential encoding is invalid");
      return key;
    },
    async create(key) {
      const result = await runHelper({ helper, account, operation: "create", key });
      if (result.status !== 0 && result.status !== 4) throw new Error("Local credential provisioning is unavailable");
    },
  };
}

function runHelper(input: { helper: string; account: string; operation: "get" | "create"; key?: Uint8Array }) {
  return new Promise<{ status: number | null; stdout: Buffer }>((resolve, reject) => {
    const child = spawn(input.helper, [input.operation, "--account", input.account], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) child.kill();
      else chunks.push(chunk);
    });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Local credential helper could not start")); });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (timedOut || size > 4096) reject(new Error("Local credential helper did not complete"));
      else resolve({ status, stdout: Buffer.concat(chunks) });
    });
    child.stdin.on("error", () => { /* Child refusal is classified by the close/error handlers. */ });
    child.stdin.end(input.key ? Buffer.from(frameKey(input.key)) : undefined);
  });
}
