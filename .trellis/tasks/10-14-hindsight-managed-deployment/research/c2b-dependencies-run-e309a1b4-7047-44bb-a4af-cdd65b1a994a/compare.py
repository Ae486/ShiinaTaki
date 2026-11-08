"""Compare the frozen current application to collected target metadata using pinned packaging."""

import hashlib
import json
import sys
from collections import deque
from pathlib import Path

import tomllib

HERE = Path(__file__).resolve().parent
SUPPORTED_METADATA = {"1.2", "2.1", "2.2", "2.3", "2.4"}
ENVIRONMENT_KEYS = {
    "implementation_name",
    "implementation_version",
    "os_name",
    "platform_machine",
    "platform_release",
    "platform_system",
    "platform_version",
    "python_full_version",
    "platform_python_implementation",
    "python_version",
    "sys_platform",
}


def load_parser(release: dict) -> None:
    if not sys.flags.no_site or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise ValueError("host_python_flags")
    pin = release["hostPython"]
    if Path(sys.executable).resolve() != Path(pin["path"]).resolve():
        raise ValueError("host_python_path")
    if hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest() != pin["sha256"]:
        raise ValueError("host_python_hash")
    package = Path(release["packaging"]["path"])
    files = {p.relative_to(package).as_posix(): p for p in package.rglob("*.py")}
    if set(files) != set(release["packaging"]["files"]):
        raise ValueError("packaging_file_set")
    for name, path in files.items():
        if (
            path.is_symlink()
            or hashlib.sha256(path.read_bytes()).hexdigest()
            != release["packaging"]["files"][name]
        ):
            raise ValueError("packaging_hash")
    sys.path.insert(0, str(package.parent))


def compare(inventory: dict, project: dict) -> dict:
    from packaging.requirements import Requirement
    from packaging.specifiers import SpecifierSet
    from packaging.utils import canonicalize_name
    from packaging.version import Version

    if inventory.get("schema") != "c2b-installed-dependencies-v1" or not inventory.get(
        "complete"
    ):
        raise ValueError("inventory_incomplete")
    env = inventory["environment"]
    if set(env) != ENVIRONMENT_KEYS or not all(
        isinstance(v, str) for v in env.values()
    ):
        raise ValueError("incomplete_target_marker_environment")
    if env["sys_platform"] != "linux" or env["python_version"] != "3.11":
        raise ValueError("unsupported_target_environment")
    installed = {}
    for item in inventory["distributions"]:
        if item["metadataVersion"] not in SUPPORTED_METADATA:
            raise ValueError("metadata_version_unsupported")
        name = canonicalize_name(item["name"], validate=True)
        if name in installed:
            raise ValueError("duplicate_distribution_name")
        Version(item["version"])
        SpecifierSet(item["requiresPython"] or "")
        if not isinstance(item["providesExtra"], list) or not isinstance(
            item["requiresDist"], list
        ):
            raise ValueError("metadata_field_shape")
        extras = [
            canonicalize_name(value, validate=True) for value in item["providesExtra"]
        ]
        if len(extras) != len(set(extras)):
            raise ValueError("duplicate_distribution_extra")
        for value in item["requiresDist"]:
            Requirement(value)
        installed[name] = item
    application = canonicalize_name(project["name"], validate=True)
    if (
        application not in installed
        or installed[application]["version"] != project["version"]
    ):
        raise ValueError("application_metadata_identity")
    observed_application = installed[application]
    installed[application] = {
        "name": project["name"],
        "version": project["version"],
        "requiresPython": project["requires-python"],
        "requiresDist": project["dependencies"],
        "providesExtra": list(project["optional-dependencies"]),
    }
    work = deque([(application, ""), (application, "embedded-db")])
    seen = set()
    issues = []
    ignored = 0
    evaluated = 0
    while work:
        name, extra = work.popleft()
        if (name, extra) in seen:
            continue
        seen.add((name, extra))
        if len(seen) > 8192:
            raise ValueError("dependency_graph_bound")
        item = installed[name]
        if not SpecifierSet(item["requiresPython"] or "").contains(
            env["python_full_version"], prereleases=True
        ):
            issues.append(
                {
                    "kind": "requires_python",
                    "package": name,
                    "required": item["requiresPython"],
                    "observed": env["python_full_version"],
                }
            )
        extras = {
            canonicalize_name(value, validate=True) for value in item["providesExtra"]
        }
        if extra and extra not in extras:
            issues.append({"kind": "missing_extra", "package": name, "extra": extra})
            continue
        requirements = list(item["requiresDist"])
        if name == application and extra:
            requirements += project["optional-dependencies"][extra]
        for raw in requirements:
            req = Requirement(raw)
            evaluated += 1
            if evaluated > 65536:
                raise ValueError("requirement_evaluation_bound")
            if req.marker and not req.marker.evaluate({**env, "extra": extra}):
                ignored += 1
                continue
            target = canonicalize_name(req.name, validate=True)
            if req.url:
                issues.append(
                    {"kind": "direct_url_unresolved", "package": target, "parent": name}
                )
                continue
            actual = installed.get(target)
            if actual is None:
                issues.append(
                    {
                        "kind": "missing_distribution",
                        "package": target,
                        "parent": name,
                        "required": str(req.specifier),
                    }
                )
                continue
            if not req.specifier.contains(actual["version"], prereleases=True):
                issues.append(
                    {
                        "kind": "version_mismatch",
                        "package": target,
                        "parent": name,
                        "required": str(req.specifier),
                        "observed": actual["version"],
                    }
                )
            work.append((target, ""))
            work.extend(
                (target, canonicalize_name(value, validate=True))
                for value in req.extras
            )
    unique = {json.dumps(value, sort_keys=True): value for value in issues}
    return {
        "schema": "c2b-dependency-comparison-v1",
        "comparisonComplete": True,
        "metadataCompatible": not unique,
        "deploymentReady": False,
        "scope": "Current application mandatory plus embedded-db dependency closure; metadata only, no import/startup proof",
        "selectedSourceExtras": ["embedded-db"],
        "targetEnvironment": env,
        "installedDistributionCount": len(installed),
        "reachableDistributionCount": len({name for name, _ in seen}),
        "evaluatedRequirements": evaluated,
        "markerExcludedRequirements": ignored,
        "baseApplicationMetadata": observed_application,
        "issues": list(unique.values()),
    }


if __name__ == "__main__":
    try:
        if len(sys.argv) != 1:
            raise ValueError("no_arguments")
        release = json.loads((HERE / "release.json").read_text(encoding="utf-8"))
        load_parser(release)
        source = (HERE / "source-pyproject.toml").read_bytes()
        if (
            hashlib.sha256(source).hexdigest()
            != release["files"]["source-pyproject.toml"]
        ):
            raise ValueError("source_metadata_changed")
        archive = Path(release["archive"])
        disposition = json.loads((archive / "disposition.json").read_text())
        raw = (archive / "result.json").read_bytes()
        if hashlib.sha256(raw).hexdigest() != disposition["hashes"]["result.json"]:
            raise ValueError("inventory_result_hash")
        result = json.loads(raw)
        if result["token"] != release["token"] or not result["inventoryComplete"]:
            raise ValueError("inventory_not_collected")
        answer = compare(
            result["inventory"], tomllib.loads(source.decode("utf-8"))["project"]
        )
        answer["sourceMetadataSha256"] = hashlib.sha256(source).hexdigest()
        answer["inventoryResultSha256"] = hashlib.sha256(raw).hexdigest()
        answer["token"] = release["token"]
    except Exception as error:
        answer = {
            "comparisonComplete": False,
            "metadataCompatible": False,
            "deploymentReady": False,
            "failure": str(error)
            if isinstance(error, ValueError) and str(error).replace("_", "").isalnum()
            else "comparison_refused",
        }
    print(json.dumps(answer, indent=2))
    sys.exit(0 if answer["comparisonComplete"] else 2)
