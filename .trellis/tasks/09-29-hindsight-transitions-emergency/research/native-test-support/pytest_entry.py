"""Run native pytest under the existing offline fixture egress guard."""
import sys
from egress_guard import install_guard
sys.modules["winloop"] = None
install_guard()
import pytest
raise SystemExit(pytest.main(sys.argv[1:]))
