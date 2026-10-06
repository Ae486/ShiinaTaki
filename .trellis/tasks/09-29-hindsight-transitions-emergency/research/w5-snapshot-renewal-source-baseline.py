"""Exact preimage differential: restore only this repair's candidate module in a finally block."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RELATIVE = "packages/core/src/memory/transitions/transition-healthy-candidate.ts"
PATH = ROOT / RELATIVE
original = PATH.read_bytes()
text = original.decode("utf-8").replace("\r\n", "\n")
text = text.replace('import type { HindsightTransitionStatus, MemoryTransitionIntent }',
    'import { randomUUID } from "node:crypto";\nimport type { HindsightTransitionStatus, MemoryTransitionIntent, MemoryTransitionUnusedInventory }')
text = text.replace('persistTransitionNativeEvidence, readTransitionCandidate, readTransitionNativeEvidence',
    'persistTransitionNativeEvidence, readTransitionCandidate')
text = text.replace('import type { Database }', 'import { prepareTransitionNativeCommand, readTransitionNativeCommand, markTransitionNativeDispatched } from "../../db/memory-transition-driver-repo.ts";\nimport type { Database }')
text = text.replace('import { loadTransitionUnusedInventory } from "./transition-unused-inventory.ts";\nimport { transitionLocalHash } from "./transition-local-encoding.ts";',
    'import { loadBodies } from "../hindsight/hindsight-application-bundle-loader.ts";')
text = text.replace('      // Inventory renewal can reclaim an expired Native executor. Preserve the prepared logical request,\n      // but dispatch under the current fence rather than the status captured before inventory loading.\n      const executor = (await input.native.fence(bankId)).executor;\n', '')
text = text.replace('        executor, client:', '        executor: fenced.executor, client:')
text = text.replace('    evidenceIds.push(await nativeEvidence(input, status)); input.changed();', '''    const client = requireHindsightApplicationClient(input.native.client);
    if (!client.currentSnapshotPage) invalid();
    const evidence = await loadTransitionNativeEvidence({ status,
      client: { ...input.native.client, ...client, currentSnapshotPage: client.currentSnapshotPage }, request: input.request });
    persistTransitionNativeEvidence(input.db, { ...input.work(), evidence });
    evidenceIds.push(evidence.evidenceId); input.changed();''')
text = text.replace('loadTransitionUnusedInventory(input, bank.target)', 'loadUnusedInventory(input, bank.target)')
text = text[:text.index('async function nativeEvidence(')] + '''async function loadUnusedInventory(input: Input, status: HindsightTransitionStatus): Promise<MemoryTransitionUnusedInventory> {
  const client = requireHindsightApplicationClient(input.native.client);
  if (!client.createCurrentSnapshot || !client.currentSnapshotPage) invalid();
  const bankId = status.bank_id;
  const nativeSnapshot = await client.createCurrentSnapshot({ bankId, ttlSeconds: 600, context: input.request() });
  const nativePages = [];
  for (let pageNumber = 0; pageNumber < nativeSnapshot.manifest.total_pages; pageNumber++) {
    nativePages.push(await client.currentSnapshotPage({ bankId, snapshotId: nativeSnapshot.snapshot_id, pageNumber, context: input.request() }));
  }
  const namespace = { application_id: "taki" as const, provider_lineage: status.request.provider_lineage,
    bank_generation: status.request.bank_generation };
  // Snapshot materialization has a native request identity too. Reopening after a lost POST response must query
  // through the same idempotent request, never mint a different snapshot request for this unused-scope capture.
  const command = readTransitionNativeCommand(input.db, { transitionId: input.intent.transitionId, bankId,
    kind: "application-snapshot", slot: "unused-inventory" }) ?? prepareTransitionNativeCommand(input.db, { ...input.work(),
    command: { kind: "application-snapshot", bankId, slot: "unused-inventory", request: { namespace, request_id: randomUUID(), ttl_seconds: 600 } } });
  if (command.kind !== "application-snapshot") invalid();
  markTransitionNativeDispatched(input.db, { ...input.work(), command });
  const applicationManifest = await client.createApplicationSnapshot({ bankId, context: input.request(), request: command.request });
  const applicationPages = [];
  for (let pageNumber = 0; pageNumber < applicationManifest.total_pages; pageNumber++) {
    applicationPages.push(await client.applicationSnapshotPage({ bankId, namespace,
      snapshotId: applicationManifest.snapshot_id!, pageNumber, context: input.request() }));
  }
  const bodies = await loadBodies({ bankId, namespace, client, context: input.request(), request: input.request }, applicationPages);
  return { nativeSnapshot, nativePages, applicationManifest, applicationPages,
    bodies: [...bodies.values()].map(({ ref, bytes }) => ({ ref, base64: Buffer.from(bytes).toString("base64") })) };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
'''
expected = json.loads((HERE / 'w5-checker-source-hashes.json').read_text())['core'][RELATIVE]['sha256']
variants = [text.encode(), text.replace('\n', '\r\n').encode()]
baseline = next((value for value in variants if hashlib.sha256(value).hexdigest() == expected), None)
assert baseline is not None, 'Reconstructed baseline must match the immutable checked source byte for byte'
original_hash = hashlib.sha256(original).hexdigest()
(HERE / 'w5-snapshot-renewal-candidate-before-baseline.txt').write_bytes(original)
(HERE / 'w5-snapshot-renewal-candidate-baseline.txt').write_bytes(baseline)
print(json.dumps({'baselineSha256': expected, 'repairSha256': original_hash}), flush=True)
try:
    PATH.write_bytes(baseline)
    args = [shutil.which('pnpm.cmd') or 'pnpm', '--filter', '@taki/core', 'exec', 'vitest', 'run',
            'src/memory/transitions/transition-healthy-source.test.ts', '--maxWorkers=1', '--reporter=verbose']
    completed = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace')
    (HERE / 'w5-snapshot-renewal-source-baseline.log').write_text(completed.stdout, encoding='utf-8')
    print(json.dumps({'testExitCode': completed.returncode, 'output': 'w5-snapshot-renewal-source-baseline.log'}), flush=True)
finally:
    PATH.write_bytes(original)
    assert hashlib.sha256(PATH.read_bytes()).hexdigest() == original_hash
    print('Repair source restored byte for byte', flush=True)
raise SystemExit(completed.returncode)
