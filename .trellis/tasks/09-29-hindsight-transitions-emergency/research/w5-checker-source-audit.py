"""Independent W5 inventory; never rewrite implementer or predecessor evidence."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path("H:/TakiAgent")
NATIVE = Path("H:/hindsight")
RESEARCH = Path(__file__).resolve().parent
DELIVERY_HASH = "21673440218d85039ef17405a24f4134880a31f7a6872352dc86a50e1b99ea94"
EXTRA = ["packages/core/src/server/methods/memory-transition-methods.test.ts"]
PRESERVED = {
    "w5-source-ownership.json": DELIVERY_HASH,
    "w5-prior-source-baseline.json": "8e8b4dad76f41d25201253969f0baa7777d9412b9e82757595cc804c3434f67d",
    "w5-first-real-run-source-hashes.json": "e97459b4918a0ecfd99ea863ba030fd5bb300451d26c8dc9bd5d8bfe7498bef1",
    "w5-native-billing-prior-hashes.json": "2742b09dedd3dd9af5d30c450564e1c7023ae3a62115fdb59a98d285a86f82d1",
    "w4-checker-source-hashes.json": "8e9474814dcd503b30922576c657038ba88d8fdb19ee46f127c27dc26ee89915",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    for name, expected in PRESERVED.items():
        assert digest(RESEARCH / name) == expected, name
    delivered = json.loads((RESEARCH / "w5-source-ownership.json").read_text(encoding="utf-8"))
    baseline = json.loads((RESEARCH / "w5-prior-source-baseline.json").read_text(encoding="utf-8"))
    core = {path: {"sha256": digest(ROOT / path), "deliveredSha256": row["sha256"]}
            for path, row in delivered["core"].items()}
    core.update({path: {"sha256": digest(ROOT / path), "deliveredSha256": None} for path in EXTRA})
    native = {path: {"sha256": digest(NATIVE / path), "deliveredSha256": row["sha256"]}
              for path, row in delivered["native"].items()}
    expected_native = {**baseline["roots"]["H:/hindsight"],
                       **{path: row["sha256"] for path, row in delivered["native"].items()}}
    unexpected_native = [path for path, expected in expected_native.items() if digest(NATIVE / path) != expected]
    issues = []
    for base, inventory in ((ROOT, core), (NATIVE, native)):
        for relative in inventory:
            path = base / relative
            raw = path.read_bytes()
            text = raw.decode("utf-8")
            if raw.startswith(b"\xef\xbb\xbf"):
                issues.append(f"BOM:{relative}")
            if any(line.rstrip(" \t") != line for line in text.splitlines()):
                issues.append(f"trailing-whitespace:{relative}")
            if relative.endswith(".ts") and not relative.endswith(".test.ts"):
                if not all(tag in text[:650] for tag in ("INPUT:", "OUTPUT:", "POS:")):
                    issues.append(f"header:{relative}")
                index = path.parent / "index.md"
                if not index.exists() or path.name not in index.read_text(encoding="utf-8"):
                    issues.append(f"index:{relative}")
    corpus = ROOT / ".trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90"
    original = corpus / "application-ad325c12054d4d92b91a81ad2b18fee1"
    preflight = corpus / "w5-source-preflight-836b286e43414523a304cdbe8f25f84e.json"
    assert digest(preflight) == "d27ab04843cd82e1d574b06dda5512ad469bb85a541887414a8ce8707499ab1d"
    entries = json.loads(preflight.read_text(encoding="utf-8"))["entries"]
    for entry in entries:
        path = original / entry["path"]
        before = path.stat()
        assert before.st_size == entry["bytes"] and digest(path) == entry["sha256"], entry["path"]
        after = path.stat()
        assert before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns
    actual = {path.relative_to(original).as_posix() for path in (original / "data").rglob("*") if path.is_file()}
    actual.update(path.relative_to(original).as_posix() for path in original.glob("application.sqlite*") if path.is_file())
    assert actual == {entry["path"] for entry in entries}
    working = corpus / "w5-healthy-a7ffc67a1666400b8cc7e890d837cb97"
    counter = json.loads((working / "model-submissions.json").read_text(encoding="utf-8"))
    assert counter["submitted"] == 209
    assert not (original / "data/postmaster.pid").exists() and not (working / "data/postmaster.pid").exists()
    result = {"meaning": "Independent current checker source; original delivery and predecessor manifests remain immutable",
              "core": core, "native": native, "preservedManifests": PRESERVED,
              "nativeBaselinePathsVerified": len(expected_native), "unexpectedNativeChanges": unexpected_native,
              "encodingHeaderIndexIssues": issues,
              "changedSinceDelivery": [path for path, row in core.items() if row["sha256"] != row["deliveredSha256"]],
              "originalPreserved": {"files": len(entries), "bytes": sum(entry["bytes"] for entry in entries), "allHashesMatch": True},
              "realSubmissions": 209, "realSubmissionCap": 240, "realModelRequestsByChecker": 0,
              "realGate": "INCOMPLETE; no final native proof, Core COMMIT, Local edits or reentry"}
    output = RESEARCH / "w5-checker-source-hashes.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"coreFiles": len(core), "nativeFiles": len(native), "nativeBaselinePathsVerified": len(expected_native),
                      "changedSinceDelivery": result["changedSinceDelivery"], "issues": issues,
                      "unexpectedNativeChanges": unexpected_native, "originalPreserved": result["originalPreserved"],
                      "manifestSha256": digest(output)}))
    if issues or unexpected_native:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
