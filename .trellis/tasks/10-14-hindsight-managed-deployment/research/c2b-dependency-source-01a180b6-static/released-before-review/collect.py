"""Read bounded installed metadata in the fixed image without site or package imports."""

import hashlib
import json
import os
import platform
import signal
import stat
import sys
import time
from email.parser import BytesParser
from pathlib import Path

TOKEN = "0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d"
PURELIB = Path("/app/api/.venv/lib/python3.11/site-packages")
STARTED = time.monotonic()
MAX_OUTPUT = 1024 * 1024


class InventoryRefused(Exception):
    """Only a fixed code is exported; arbitrary exception values remain private."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise InventoryRefused(code)


def deadline(_signum: int, _frame: object) -> None:
    raise InventoryRefused("collector_deadline")


def environment() -> dict[str, str]:
    version = sys.implementation.version
    implementation = f"{version.major}.{version.minor}.{version.micro}"
    if version.releaselevel != "final":
        implementation += version.releaselevel[0] + str(version.serial)
    return {
        "implementation_name": sys.implementation.name,
        "implementation_version": implementation,
        "os_name": os.name,
        "platform_machine": platform.machine(),
        "platform_release": platform.release(),
        "platform_system": platform.system(),
        "platform_version": platform.version(),
        "python_full_version": platform.python_version(),
        "platform_python_implementation": platform.python_implementation(),
        "python_version": ".".join(platform.python_version_tuple()[:2]),
        "sys_platform": sys.platform,
    }


def metadata(path: Path) -> dict:
    before = path.lstat()
    require(
        stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "metadata_not_regular"
    )
    require(path.resolve() == path, "metadata_redirection")
    require(before.st_size <= 512 * 1024, "metadata_file_bound")
    with path.open("rb") as stream:
        raw = stream.read(512 * 1024 + 1)
    require(len(raw) == before.st_size, "metadata_size_changed")
    after = path.lstat()
    require(
        (
            before.st_dev,
            before.st_ino,
            before.st_mtime_ns,
            before.st_ctime_ns,
            before.st_size,
        )
        == (
            after.st_dev,
            after.st_ino,
            after.st_mtime_ns,
            after.st_ctime_ns,
            after.st_size,
        ),
        "metadata_changed",
    )
    raw.decode("utf-8", errors="strict")
    parsed = BytesParser().parsebytes(raw, headersonly=True)
    require(not parsed.defects, "metadata_parse_defect")
    for key in ["Name", "Version", "Metadata-Version"]:
        require(len(parsed.get_all(key, [])) == 1, "metadata_required_header")
    require(
        len(parsed.get_all("Requires-Python", [])) <= 1, "metadata_duplicate_python"
    )
    requires_dist = [str(value) for value in parsed.get_all("Requires-Dist", [])]
    provides_extra = [str(value) for value in parsed.get_all("Provides-Extra", [])]
    require(
        len(requires_dist) <= 512 and len(provides_extra) <= 128, "metadata_field_count"
    )
    require(
        all(len(value) <= 8192 for value in requires_dist), "requirement_text_bound"
    )
    fields = {
        "name": str(parsed["Name"]),
        "version": str(parsed["Version"]),
        "metadataVersion": str(parsed["Metadata-Version"]),
        "requiresPython": str(parsed["Requires-Python"])
        if parsed["Requires-Python"]
        else None,
        "requiresDist": requires_dist,
        "providesExtra": provides_extra,
    }
    return {
        "file": path.relative_to(PURELIB).as_posix(),
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        **fields,
    }


def collect() -> dict:
    distributions = []
    result: dict = {
        "schema": "c2b-installed-dependencies-v1",
        "token": TOKEN,
        "complete": False,
        "deploymentReady": False,
        "scope": "Metadata collection only; no application import or compatibility claim",
        "distributions": distributions,
        "failure": None,
    }
    try:
        require(
            sys.flags.no_site == 1
            and sys.flags.isolated == 1
            and sys.dont_write_bytecode,
            "python_flags",
        )
        require(
            sys.platform == "linux" and sys.version_info[:2] == (3, 11),
            "python_platform",
        )
        require(os.getuid() == 1000 and os.getgid() == 1000, "collector_user")
        require(PURELIB.resolve() == PURELIB and PURELIB.is_dir(), "purelib_identity")
        result["environment"] = environment()
        result["pythonExecutable"] = sys.executable
        result["purelib"] = str(PURELIB)
        names = []
        with os.scandir(PURELIB) as entries:
            for index, entry in enumerate(entries):
                require(index < 8192, "purelib_entry_bound")
                require(
                    not entry.name.endswith(".egg-info"),
                    "legacy_egg_metadata_unsupported",
                )
                if entry.name.endswith(".dist-info"):
                    require(
                        entry.is_dir(follow_symlinks=False) and not entry.is_symlink(),
                        "distribution_directory",
                    )
                    names.append(entry.name)
        require(0 < len(names) <= 1024, "distribution_count")
        total = 0
        for name in sorted(names):
            value = metadata(PURELIB / name / "METADATA")
            total += value["bytes"]
            require(total <= 32 * 1024 * 1024, "metadata_total_bound")
            distributions.append(value)
        result["metadataBytes"] = total
        result["complete"] = True
    except InventoryRefused as error:
        result["failure"] = str(error)
    except FileNotFoundError:
        result["failure"] = "metadata_missing"
    except (PermissionError, OSError):
        result["failure"] = "metadata_unreadable"
    except Exception:
        result["failure"] = "metadata_invalid"
    result["elapsedMs"] = round((time.monotonic() - STARTED) * 1000)
    return result


if __name__ == "__main__":
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(20)
    output = collect()
    encoded = (
        json.dumps(output, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()
    if len(encoded) > MAX_OUTPUT:
        output = {
            "schema": "c2b-installed-dependencies-v1",
            "token": TOKEN,
            "complete": False,
            "deploymentReady": False,
            "failure": "output_bound",
        }
        encoded = (json.dumps(output) + "\n").encode()
    signal.alarm(0)
    sys.stdout.buffer.write(encoded)
    sys.exit(0 if output["complete"] else 2)
