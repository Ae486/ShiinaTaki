"""Capture the working dependency baseline without reading credentials/runtime data."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parent
phase = sys.argv[1]
out = EVIDENCE / phase
out.mkdir(exist_ok=True)
files = ["package.json", "packages/core/package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "eslint.config.js"]
sources = sorted(p for base in ["packages/core/src", "packages/shared/src", "apps/desktop/src", "e2e/src"] for p in (ROOT / base).rglob("*") if p.is_file())
hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
(out / "source-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")
manifest = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
(out / "file-hashes.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
if phase == "baseline":
    preimages = out / "preimages"
    preimages.mkdir(exist_ok=True)
    for name in files:
        dest = preimages / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, dest)
        assert hashlib.sha256(dest.read_bytes()).hexdigest() == manifest[name]
for name, args in {"status": ["git", "status", "--short"], "existing-lock-diff": ["git", "diff", "--", "pnpm-lock.yaml"]}.items():
    result = subprocess.run(args, cwd=ROOT, capture_output=True)
    (out / (name + ".txt")).write_bytes(result.stdout)
print(json.dumps({"root": str(ROOT), "phase": phase, "sourceFiles": len(hashes), "files": manifest}, indent=2))
