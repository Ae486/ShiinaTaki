"""Task-only bounded file facts shared by snapshot, image install and pre-import check."""

import ast
import hashlib
import json
import os
import stat
import time
from pathlib import Path

TOKEN = "ad8bf8b8-9577-4420-9fd9-212574bd4568"
BUILD = "taki-memory-hindsight-0.9.0-template-backup-v1"
APP = Path("/app/api/hindsight_api")
PURELIB = Path("/app/api/.venv/lib/python3.11/site-packages")
ARTIFACT = Path("/opt/taki-c2b-application")
CACHE_KEY = "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"
CACHE_SHA = "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
CACHE_BYTES = 1681126


class Refused(Exception):
    """Export fixed codes only."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Refused(code)


def encoded(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def plain_path(path: Path) -> None:
    require(path.is_absolute(), "path_not_absolute")
    for part in [*reversed(path.parents), path]:
        entry = part.lstat()
        require(not stat.S_ISLNK(entry.st_mode), "path_link")
        require(not getattr(entry, "st_file_attributes", 0) & 0x400, "path_reparse")
    require(path.resolve() == path, "path_redirected")


def file_fact(path: Path, maximum: int = 64 * 1024 * 1024) -> dict:
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "file_not_regular")
    require(0 <= before.st_size <= maximum, "file_byte_bound")
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            count += len(chunk)
            require(count <= maximum, "file_byte_bound")
            digest.update(chunk)
    after = path.lstat()
    require(
        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        and count == before.st_size,
        "file_changed",
    )
    return {"bytes": count, "sha256": digest.hexdigest()}


def tree(root: Path, *, caches: bool = False, protected: bool = False, seconds: int = 180) -> dict:
    """Include directories and symlink text for protected base bytes; never follow a link."""
    plain_path(root)
    require(root.is_dir(), "tree_root")
    deadline = time.monotonic() + seconds
    entries: dict = {}
    total = 0
    ignored = 0

    def visit(directory: Path) -> None:
        nonlocal total, ignored
        with os.scandir(directory) as listing:
            names = []
            for entry in listing:
                require(len(names) < 16384, "directory_entry_bound")
                names.append(entry.name)
        for name in sorted(names):
            require(time.monotonic() < deadline, "tree_deadline")
            require(len(entries) < (150000 if protected else 2048), "tree_entry_bound")
            path = directory / name
            relative = path.relative_to(root).as_posix()
            require(len(relative) <= 512 and not any(ord(c) < 32 for c in relative), "path_text")
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                require(protected, "source_link")
                entries[relative] = {"link": os.readlink(path)}
                continue
            require(not getattr(info, "st_file_attributes", 0) & 0x400, "source_reparse")
            if caches and (name == "__pycache__" or name.endswith((".pyc", ".pyo"))):
                ignored += 1
                continue
            if stat.S_ISDIR(info.st_mode):
                entries[relative] = {"directory": True}
                visit(path)
            else:
                fact = file_fact(path, 1024**3 if protected else 8 * 1024**2)
                total += fact["bytes"]
                require(total <= (8 * 1024**3 if protected else 32 * 1024**2), "tree_byte_bound")
                entries[relative] = fact
            if protected:
                entries[relative]["mode"] = stat.S_IMODE(info.st_mode)
                entries[relative]["uid"] = info.st_uid
                entries[relative]["gid"] = info.st_gid

    visit(root)
    return {"entries": entries, "bytes": total, "ignoredCaches": ignored, "sha256": sha(encoded(entries))}


def protected_facts() -> dict:
    # This covers all virtualenv code, metadata, scripts and symlink targets, not a package sample.
    value = tree(Path("/app/api/.venv"), protected=True)
    return {
        "virtualenv": {"entries": len(value["entries"]), "bytes": value["bytes"], "sha256": value["sha256"]},
        "python": file_fact(Path("/usr/local/bin/python3.11")),
    }


def base_metadata(expected: list[dict]) -> dict:
    actual = {}
    with os.scandir(PURELIB) as listing:
        for index, entry in enumerate(listing):
            require(index < 8192, "purelib_entry_bound")
            require(not entry.name.endswith(".egg-info"), "unexpected_egg_metadata")
            if entry.name.endswith(".dist-info"):
                path = PURELIB / entry.name / "METADATA"
                plain_path(path)
                actual[f"{entry.name}/METADATA"] = file_fact(path, 512 * 1024)
    wanted = {item["file"]: {"bytes": item["bytes"], "sha256": item["sha256"]} for item in expected}
    require(len(wanted) == 221 and actual == wanted, "base_metadata_changed")
    return {"count": len(actual), "sha256": sha(encoded(actual))}


def build_gate(path: Path) -> str:
    raw = path.read_bytes()
    require(len(raw) <= 128 * 1024, "build_source_bound")
    values = []
    for node in ast.parse(raw).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "TAKI_MEMORY_COMPATIBILITY_BUILD" for target in node.targets
        ):
            values.append(ast.literal_eval(node.value))
    require(values == [BUILD], "wrong_build")
    return BUILD


def cache_gate(path: Path) -> dict:
    try:
        plain_path(path)
        fact = file_fact(path, CACHE_BYTES + 1)
    except FileNotFoundError as error:
        raise Refused("cache_missing") from error
    require(fact == {"bytes": CACHE_BYTES, "sha256": CACHE_SHA}, "cache_corrupt")
    return fact
