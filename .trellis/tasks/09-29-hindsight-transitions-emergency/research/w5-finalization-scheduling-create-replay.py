"""Create a new diagnostic; retain the failed driver and its result byte-for-byte."""
from pathlib import Path

research = Path(__file__).resolve().parent
source = (research / "w5-verified-observation-driver.mjs").read_text(encoding="utf-8")
source = source.replace("w5-observed-driver-", "w5-scheduled-driver-")
source = source.replace("  return resolveNative(input);", """  const value = await resolveNative(input);
  // Match real Native transition_service.py resolve: its terminal SQL increments revision once.
  // The older synthetic fixture omits that update. No production or historical evidence is changed.
  value.revision++;
  remote.status.set(JSON.stringify([input.bankId, input.request.executor.transition_id]), value);
  return value;""")
needle = 'assert.equal(result.sourceSha256Before, "a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923");'
source = source.replace(needle, needle + """
result.fixtureCorrection = "terminal status revision increments once, matching real Native SQL";
const sourceManifest = JSON.parse(readFileSync(new URL("w5-verified-observation-source-manifest.json", import.meta.url), "utf8"));
const paths = [...new Set([...sourceManifest.files.map((file) => file.path),
  "packages/core/src/memory/transitions/transition-healthy-execution.ts",
  "packages/core/src/memory/transitions/transition-native-session.ts",
  ".trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-finalization-scheduling-driver.mjs"])];
const digestPath = (path) => createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
result.sourceFiles = paths.map((path) => ({ path, sha256: digestPath(path) }));
""")
source = source.replace('  assert.equal(settled.state, "completed");', '''  assert.equal(settled.state, "completed");
  const resolution = db.prepare("SELECT resolution_json FROM memory_transition_resolutions WHERE operation_id=:id").get({ id: operation.operationId });
  assert(resolution, "MISSING_TERMINAL_RESOLUTION");
  const terminal = JSON.parse(resolution.resolution_json);
  result.terminal = { outcome: terminal.result.outcome, runtime: terminal.result.runtime,
    queue: terminal.result.queue, release: terminal.release.disposition, banks: terminal.release.banks.length };
  assert.equal(result.finalPhase, "terminal");
  assert.equal(result.terminal.outcome, "completed");
  assert.equal(result.terminal.runtime, "ready");
  assert.equal(result.terminal.queue, "settled");
  assert(result.heartbeat.every((heartbeat) => heartbeat.outcome === "resolved" && heartbeat.ms < result.requestTimeoutMs));
  assert.equal(result.diagnostics.length, 0);''')
source = source.replace('  if (!result.sourceUnchanged) process.exitCode = 1;', '''  result.checkedSourceUnchanged = result.sourceFiles.every((file) => digestPath(file.path) === file.sha256);
  if (!result.sourceUnchanged || !result.checkedSourceUnchanged) process.exitCode = 1;''')
target = research / "w5-finalization-scheduling-driver.mjs"
with target.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(source)
print(target)
