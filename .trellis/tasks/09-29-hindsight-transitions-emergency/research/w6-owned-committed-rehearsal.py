"""Whole committed-recovery and distinct restart rehearsal on a new Core-only copy."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


recovery = load("w6_committed_source", HERE / "w6-owned-emergency-committed-recovery.py")
paired = load("w6_bounded_child", HERE / "w6-owned-paired-restore-runner.py")
runner = recovery.runner
paired.SECONDS = 1800


def prepare():
    recovery.preflight()
    source = runner.ROOT
    base = runner.REPO / ".trellis/.runtime/stage4-w6"
    runner.no_link(base)
    root = base / ("rehearsal-" + uuid.uuid4().hex)
    assert root.resolve().parent == base.resolve()
    root.mkdir()
    names = [
        "core/taki.db",
        f"core/backups/incident-{recovery.sealed.INCIDENT}/core.sqlite",
        f"core/backups/incident-{recovery.sealed.INCIDENT}/manifest.json",
        f"emergency-history/{recovery.FOURTH_ID}/emergency/driver-result.json",
        f"emergency-history/{recovery.FOURTH_ID}/supervisor-result.json",
    ]
    original = {}
    for name in names:
        old, new = source / name, root / name
        runner.no_link(old)
        assert old.resolve().is_relative_to(source.resolve()) and new.resolve().is_relative_to(root.resolve())
        original[name] = runner.digest(old)
        new.parent.mkdir(parents=True, exist_ok=True)
        assert not new.exists()
        shutil.copyfile(old, new)
        assert runner.digest(new) == original[name] == runner.digest(old)
    runner.write_json(
        root / "ownership.json",
        {
            "kind": "committed-recovery-rehearsal",
            "root": str(root),
            "source": str(source),
            "originalFiles": original,
            "startsNative": False,
        },
    )
    return root, original


def phases(root):
    history = root / "emergency-history" / ("rehearsal-" + uuid.uuid4().hex)
    outputs = []
    for phase in ("emergency", "restart"):
        directory = history / phase
        directory.mkdir(parents=True)
        result_path = directory / "driver-result.json"
        args = [
            runner.NODE,
            runner.DRIVER,
            "--run-owned-copy",
            "--core-data-dir",
            root / "core",
            "--core-db-path",
            root / "core/taki.db",
            "--result-path",
            result_path,
            "--phase",
            phase,
        ]
        if phase == "emergency":
            args += [
                "--recovery-transition-id",
                recovery.sealed.TRANSITION,
                "--recovery-evidence-path",
                recovery.evidence_path(root),
            ]
        paired.child(directory, "node", args, paired.clean_environment())
        result = runner.read_json(result_path)
        assert result["completed"] is True
        assert result["receiptId"] == recovery.RECEIPT and result["epochId"] == recovery.previous.TARGET_EPOCH
        assert result["additionalDispatch"] == {"native": 0, "transport": 0, "model": 0}
        assert not any(Path(str(root / "core/taki.db") + suffix).exists() for suffix in ("-wal", "-shm", "-journal"))
        outputs.append({"phase": phase, "result": str(result_path), "sha256": runner.digest(result_path)})
    return outputs


def run():
    root, original = prepare()
    sources = runner.source_inventory()
    report = {"completed": False, "root": str(root), "startsNative": False, "sourceCoreSha256": recovery.CORE_SHA}
    runner.write_json(root / "source-files.json", sources)
    runner.write_json(root / "rehearsal-result.json", report)
    print(json.dumps({"rehearsalRoot": str(root)}), flush=True)
    try:
        report["phases"] = phases(root)
        report["completed"] = True
    except BaseException as error:
        report["errorClass"] = type(error).__name__
        raise
    finally:
        report["originalFilesPreserved"] = all(
            runner.digest(runner.ROOT / name) == digest for name, digest in original.items()
        )
        report["sourcesPreserved"] = runner.source_inventory() == sources
        if not report["originalFilesPreserved"] or not report["sourcesPreserved"]:
            report["completed"] = False
        runner.write_json(root / "rehearsal-result.json", report)
        print(json.dumps(report), flush=True)
    assert report["completed"]
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-committed-rehearsal", action="store_true")
    if not parser.parse_args(argv).run_reviewed_committed_rehearsal:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    return run()


if __name__ == "__main__":
    sys.exit(main())
