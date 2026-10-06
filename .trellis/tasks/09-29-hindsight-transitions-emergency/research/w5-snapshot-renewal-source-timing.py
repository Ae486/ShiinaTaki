"""Diagnostic-only larger envelope and phase timing; original test is restored byte for byte."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
path = ROOT / 'packages/core/src/memory/transitions/transition-healthy-source.test.ts'
original = path.read_bytes()
original_hash = hashlib.sha256(original).hexdigest()
text = original.decode('utf-8').replace('\r\n', '\n')
assert text.count('}, 30_000);') == 1
text = text.replace('}, 30_000);', '}, 120_000);')
text = text.replace('    const h = await createHealthyTransitionHarness({ aliases: true });', '''    const startedAt = performance.now();
    const mark = (label: string) => console.log("W5_SOURCE_DIAGNOSTIC", label, Math.round(performance.now() - startedAt));
    const h = await createHealthyTransitionHarness({ aliases: true }); mark("harness");''')
text = text.replace('      const authority =', '      mark("initial-return");\n      const authority =')
text = text.replace('      const uploads =', '      mark("lost-source-seal");\n      const uploads =')
text = text.replace('      expect(h.remote.sources.calls).toEqual', '      mark("reentry-recovered");\n      expect(h.remote.sources.calls).toEqual')
text = text.replace('      expect(readCanonicalSource(h.db,', '      mark("final-return");\n      expect(readCanonicalSource(h.db,')
text = text.replace('      expect(h.remote.calls.delta).toBe(2);', '      expect(h.remote.calls.delta).toBe(2); mark("all-assertions-complete");')
(HERE / 'w5-snapshot-renewal-source-original-test.txt').write_bytes(original)
try:
    path.write_text(text, encoding='utf-8')
    args = [shutil.which('pnpm.cmd') or 'pnpm', '--filter', '@taki/core', 'exec', 'vitest', 'run',
            'src/memory/transitions/transition-healthy-source.test.ts', '--maxWorkers=1', '--reporter=verbose']
    result = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace')
    (HERE / 'w5-snapshot-renewal-source-timing.log').write_text(result.stdout, encoding='utf-8')
    print(json.dumps({'testExitCode': result.returncode, 'output': 'w5-snapshot-renewal-source-timing.log'}), flush=True)
finally:
    path.write_bytes(original)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == original_hash
    print(json.dumps({'originalTestRestoredSha256': original_hash}), flush=True)
raise SystemExit(result.returncode)
