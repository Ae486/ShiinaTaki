"""Copy only the two required existing model caches into a new isolated G profile."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

profile = Path(sys.argv[1]).resolve()
assert profile.parent == Path("G:/taki-codex-work").resolve()
assert profile.name.startswith("integration-profile-")
source_root = Path("C:/Users/55473/.cache/huggingface/hub").resolve()
target_root = profile / ".cache/huggingface/hub"
models = ("models--BAAI--bge-small-en-v1.5", "models--cross-encoder--ms-marco-MiniLM-L-6-v2")


def inventory(root):
    result = {}
    for entry in sorted(root.rglob("*")):
        if not entry.is_file():
            continue
        assert entry.resolve().is_relative_to(root.resolve())
        digest = hashlib.sha256()
        with entry.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        result[entry.relative_to(root).as_posix()] = {"bytes": entry.stat().st_size, "sha256": digest.hexdigest()}
    return result


receipts = []
for model in models:
    source = source_root / model
    destination = target_root / model
    before = inventory(source)
    assert before, f"Required existing model cache missing: {model}"
    shutil.copytree(source, destination, symlinks=False)
    assert inventory(destination) == before
    assert inventory(source) == before, "Original model cache changed during copying"
    receipts.append({"model": model, "files": len(before), "bytes": sum(item["bytes"] for item in before.values()),
                     "manifestSha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
                     "copyVerified": True, "sourceUnchanged": True})
(profile / "model-cache-receipt.json").write_text(json.dumps(receipts, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"profile": str(profile), "modelCaches": receipts, "downloads": 0}))
