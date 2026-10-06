"""Tests for the new-copy whole-driver ordering; bounded-child mechanics are reused."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("w6_rehearsal", HERE / "w6-owned-committed-rehearsal.py")
rehearsal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rehearsal)


def test_default_inert(monkeypatch, capsys):
    monkeypatch.setattr(rehearsal, "run", lambda: pytest.fail("unexpected run"))
    assert rehearsal.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executed"] is False


@pytest.mark.parametrize("failure", [None, "child", "receipt", "dispatch"])
def test_no_restart_without_complete_same_receipt_and_zero_dispatch(tmp_path, monkeypatch, failure):
    calls = []

    def child(_directory, _name, args, _env):
        phase = args[args.index("--phase") + 1]
        calls.append((phase, args))
        if failure == "child":
            raise RuntimeError("owned child failed")
        result = {
            "completed": True,
            "receiptId": rehearsal.recovery.RECEIPT,
            "epochId": rehearsal.recovery.previous.TARGET_EPOCH,
            "additionalDispatch": {"native": 0, "transport": 0, "model": 0},
        }
        if failure == "receipt":
            result["receiptId"] = "different"
        if failure == "dispatch":
            result["additionalDispatch"]["model"] = 1
        rehearsal.runner.write_json(args[args.index("--result-path") + 1], result)

    monkeypatch.setattr(rehearsal.paired, "child", child)
    monkeypatch.setattr(rehearsal.paired, "clean_environment", lambda: {})
    if failure:
        with pytest.raises((RuntimeError, AssertionError)):
            rehearsal.phases(tmp_path)
        assert len(calls) == 1
    else:
        outputs = rehearsal.phases(tmp_path)
        assert [x["phase"] for x in outputs] == ["emergency", "restart"]
        assert "--recovery-evidence-path" in calls[0][1]
        assert "--recovery-evidence-path" not in calls[1][1]
        assert calls[0][1][calls[0][1].index("--core-db-path") + 1] == tmp_path / "core/taki.db"
