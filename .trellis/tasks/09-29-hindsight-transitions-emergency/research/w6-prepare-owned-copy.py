"""Prepare a fresh, unstarted W6 pair from the verified stopped W5 predecessor."""

import hashlib
import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from w5_working_custody import ROOT, no_link, stopped

BASE = Path("H:/TakiAgent/.trellis/.runtime/stage4-w6")
CORE_SHA = "274e1ccbd651bcd8c64f88f7ceb0d80c56a3701e5a5a62309369cbfbd0235a45"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(root):
    files = [root / "application.sqlite"]
    for name in ("data", "prompt"):
        parent = root / name
        if parent.exists():
            no_link(parent)
            for item in parent.rglob("*"):
                no_link(item)
                if item.is_file():
                    files.append(item)
    return [
        {
            "path": str(path.relative_to(root)).replace("\\", "/"),
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        }
        for path in sorted(files)
    ]


def main():
    if sys.argv[1:] != ["--prepare-owned-copy"]:
        print(json.dumps({"executed": False, "startsServices": False}))
        return
    stopped()
    assert digest(ROOT / "application.sqlite") == CORE_SHA
    if BASE.exists():
        no_link(BASE)
    else:
        no_link(BASE.parent)
        BASE.mkdir()
    target = BASE / uuid.uuid4().hex
    assert target.parent.resolve() == BASE.resolve() and not target.exists()
    target.mkdir()
    owner = {
        "version": 1,
        "kind": "w6-private-pair",
        "root": str(target),
        "source": str(ROOT),
        "sourceCoreSha256": CORE_SHA,
        "prepared": False,
        "started": False,
        "stopped": True,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    owner_path = target / "ownership.json"
    owner_path.write_text(json.dumps(owner, indent=2) + "\n", encoding="utf-8")
    try:
        before = inventory(ROOT)
        for name in ("data", "prompt"):
            source = ROOT / name
            if source.exists():
                shutil.copytree(source, target / name, copy_function=shutil.copy2)
        shutil.copy2(ROOT / "application.sqlite", target / "application.sqlite")
        assert inventory(target) == before, "W6_COPY_MISMATCH"
        stopped()
        assert inventory(ROOT) == before, "W6_PREDECESSOR_CHANGED"
        assert not (target / "data" / "postmaster.pid").exists()
        assert not (target / "application.sqlite-wal").exists()
        manifest = target / "source-files.json"
        manifest.write_text(json.dumps(before, indent=2) + "\n", encoding="utf-8")
        owner.update(
            prepared=True,
            files=len(before),
            bytes=sum(r["bytes"] for r in before),
            manifestSha256=digest(manifest),
            originalPreserved=True,
        )
    except BaseException as error:
        owner["errorClass"] = type(error).__name__
        raise
    finally:
        owner_path.write_text(json.dumps(owner, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(owner))


if __name__ == "__main__":
    main()
