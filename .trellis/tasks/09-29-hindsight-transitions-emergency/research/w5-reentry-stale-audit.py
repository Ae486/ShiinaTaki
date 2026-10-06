"""Audit only new diagnostic artifacts and the seven immutable supplied inputs."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path("H:/TakiAgent")
RESEARCH = ROOT / ".trellis/tasks/09-29-hindsight-transitions-emergency/research"
INPUT = ROOT / ".trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c"
ARTIFACTS = [
    "w5-reentry-stale-replay.mjs",
    "w5-reentry-stale-fast.test.mjs",
    "w5-reentry-stale-fast.log",
    "w5-reentry-stale-diagnosis.md",
    "w5-reentry-stale-diagnosis-checkpoint.md",
    "w5-reentry-stale-audit.py",
]
PROBES = [
    "w5-stale-probe-expired-57a89632-9fa5-4b0d-8e55-291db9ed70e4",
    "w5-stale-probe-fresh-cafb7db5-6c29-49bf-8561-ac288349889f",
    "w5-stale-probe-elapsed-294a250e-b165-42f6-8dbc-e7796a121986",
    "w5-stale-probe-elapsed-full-fbbd19a8-76f7-4d0e-a1ac-9dc612ec3256",
]


def digest(path: Path) -> dict:
    body = path.read_bytes()
    return {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}


def main() -> None:
    supplied = json.loads((INPUT / "copy-manifest.json").read_text(encoding="utf-8"))
    verified_inputs = {}
    for name, expected in supplied["files"].items():
        actual = digest(INPUT / name)
        assert actual == expected, f"Input changed: {name}"
        verified_inputs[name] = actual
    inventory = {}
    for name in ARTIFACTS:
        path = RESEARCH / name
        body = path.read_bytes()
        assert not body.startswith(b"\xef\xbb\xbf"), f"BOM: {name}"
        value = body.decode("utf-8")
        assert value.endswith("\n"), f"Missing newline: {name}"
        assert all(line == line.rstrip() for line in value.splitlines()), f"Whitespace: {name}"
        if name.endswith(".mjs"):
            subprocess.run(["node", "--check", str(path)], cwd=ROOT, check=True, capture_output=True)
        if name.endswith(".py"):
            compile(value, str(path), "exec")
        inventory[str(path.relative_to(ROOT)).replace("\\", "/")] = digest(path)
    results = {}
    for name in PROBES:
        path = ROOT / ".trellis/.runtime" / name / "result.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        assert value["before"] == value["after"] == {"intents": 1, "attempts": 1, "operations": 8}
        assert value["sourcePreserved"] and not value.get("harnessError")
        assert value["externalCalls"] == value["modelCalls"] == 0
        results[name] = digest(path)
    audit = {"version": 1, "inputsVerified": len(verified_inputs), "artifactsVerified": len(inventory),
             "probesVerified": len(results), "nodeSyntaxChecks": 2, "pythonSyntaxChecks": 1,
             "utf8NoBomWhitespace": "pass", "sourcePreserved": True,
             "externalCalls": 0, "modelCalls": 0}
    (RESEARCH / "w5-reentry-stale-audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    manifest = {"version": 1, "meaning": "New diagnostic artifacts only; no previous manifest replaced",
                "inputs": verified_inputs, "artifacts": inventory, "probeResults": results,
                "audit": digest(RESEARCH / "w5-reentry-stale-audit.json")}
    (RESEARCH / "w5-reentry-stale-diagnostic-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit))


if __name__ == "__main__":
    main()
