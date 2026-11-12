/** Real native helper create-only race using one randomly named disposable credential account. */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const helper = "G:/taki-native-flow-build-20261110/debug/taki-secret-key.exe";
const account = `installation-smoke-race-${randomUUID()}`;
const output = "G:/taki-native-flow-artifacts-20261110/helper-race.json";
const frame = (key) => { const result = Buffer.alloc(36); result.writeUInt32LE(32); key.copy(result, 4); return result; };
function run(operation, key) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [operation, "--account", account], { windowsHide: true });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, bytes: Buffer.concat(chunks) }));
    child.stdin.end(key ? frame(key) : undefined);
  });
}
const keys = [randomBytes(32), randomBytes(32)];
const start = performance.now();
const created = await Promise.all(keys.map((key) => run("create", key)));
const read = await run("get");
const result = { account, statuses: created.map((item) => item.status), readStatus: read.status,
  winnerRoundTrips: keys.some((key) => read.bytes.equals(frame(key))),
  singleWinner: created.filter((item) => item.status === 0).length === 1 && created.filter((item) => item.status === 4).length === 1,
  durationMs: performance.now() - start };
const cleanup = spawnSync("cmdkey.exe", [`/delete:${account}.TakiAgent`], { windowsHide: true, encoding: "utf8" });
result.cleanupExit = cleanup.status;
result.absentAfterCleanup = (await run("get")).status === 3;
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.winnerRoundTrips || !result.singleWinner || !result.absentAfterCleanup) process.exitCode = 1;
