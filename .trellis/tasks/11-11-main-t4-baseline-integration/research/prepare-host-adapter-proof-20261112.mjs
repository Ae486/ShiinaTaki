import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareDeploymentKeyAdapter } from "../../../../apps/hindsight-host/test-fixtures/deployment-key-adapter-fixture.ts";
import { fileDigest } from "../../../../apps/hindsight-host/src/installed-files.ts";

const root = mkdtempSync("G:/Temp/taki-host-adapter-proof-");
writeFileSync(join(root, ".owned-host-adapter-proof"), "TAKI_HOST_FIXTURE_BUILD_PROOF\n", { flag: "wx" });
prepareDeploymentKeyAdapter(root);
const nativeRoot = process.env.TAKI_C2A_NATIVE_ROOT ?? "H:/hindsight";
const python = process.env.TAKI_C2A_PYTHON ?? join(nativeRoot, ".venv", "Scripts", "python.exe");
const pythonProbe = spawnSync(python, ["-I", "-B", "-c", "import json,sys; print(json.dumps({'version':sys.version,'executable':sys.executable,'baseExecutable':sys._base_executable}))"], {
  env: { SystemRoot: process.env.SystemRoot }, encoding: "utf8", windowsHide: true, timeout: 5_000,
});
if (pythonProbe.error || pythonProbe.status !== 0) throw new Error("retained Native Python probe failed", { cause: pythonProbe.error });
const nativeModules = "docker/standalone/managed_bootstrap";
const sources = ["docker/standalone/tests/fixtures/c2a_pipe_owner.py",
  ...readdirSync(join(nativeRoot, nativeModules)).filter((file) => file.endsWith(".py")).map((file) => `${nativeModules}/${file}`)];
const proof = {
  ...JSON.parse(readFileSync(join(root, "test-key-adapter", "build-receipt.json"), "utf8")),
  ownedProofRoot: root, nativeRoot, python, pythonSha256: fileDigest(python), pythonProbe: JSON.parse(pythonProbe.stdout),
  nativeSourceHashesBefore: Object.fromEntries(sources.map((file) => [file, fileDigest(join(nativeRoot, file))])),
  nativeReadOnlyArguments: ["-I", "-B"], originalHistoricalTempsModified: false,
};
writeFileSync(new URL("./host-adapter-build-proof-20261112.json", import.meta.url), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ root, sourceSha256: proof.sourceSha256, adapterSha256: proof.adapterSha256,
  compilerSha256: proof.compilerSha256, realFrameProbePassed: proof.protocolProbe.fixedFakeKeyMatched }) + "\n");
