"""Opt-in fixtures for the source-reviewed G1 mechanical regression allowlist.

The native root conftest still owns MemoryEngine, authentication, database setup and
teardown. Only its two local model factories are replaced, using an existing native
deterministic embedding fixture and the native RRF pass-through. These checks do not
claim semantic extraction or retrieval quality.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

import pytest

from run_isolated_hindsight import HINDSIGHT_ROOT


TEST_ROOT = (HINDSIGHT_ROOT / "hindsight-api-slim/tests").resolve()
ROOT_CONFTEST = TEST_ROOT / "conftest.py"

# This is deliberately an explicit reviewed set, not a generic 'offline' switch.
# Fixed-instance migration suites, live API tests and semantic recall tests are absent.
FULL_FILES = frozenset(
    {
        "test_retain_orchestrator_mapping.py",
        "test_retain_pipeline_cancellation.py",
        "test_async_retain_tags.py",
        "test_operation_completion.py",
        "test_async_retain_operation_id.py",
        "test_async_batch_retain.py",
        "test_batch_chunking.py",
        "test_subbatch_chunk_coverage.py",
        "test_subbatch_multichunk_coverage.py",
        "test_structured_chunk_size_retain.py",
        "test_retain_transient_extraction_failure.py",
        "test_retain_same_document_concurrency.py",
        "test_delta_retain_duplicates.py",
        "test_batch_api.py",
        "test_taki_conditional_curation.py",
        "test_curation_http.py",
        "test_taki_replication_retain.py",
        "test_taki_replication_curation.py",
        "test_taki_replication_journal.py",
        "test_taki_logical_snapshot.py",
        "test_taki_replication_consolidation.py",
        "test_taki_replication_observation_maintenance.py",
        "test_taki_replication_admin_writers.py",
        "test_taki_replication_transfer.py",
        "test_taki_extension_contract.py",
        "test_supabase_tenant.py",
        "test_migration_shape.py",
        "test_migrations_newer_revision.py",
        "test_migrations_thread_safety.py",
        "test_admin_backup_restore.py",
        "test_extension_bank_tables.py",
        "test_async_submit_bank_not_found.py",
        "test_consolidation_submit_atomic_dedup.py",
        "test_maintenance_loop.py",
    }
)
# These worker cases use the owned PG and deterministic executors/validators.
# Require class-qualified selectors before collection; the rest of this large
# module has not been admitted to this mechanical-model validation path.
WORKER_SELECTORS = frozenset(
    {
        "TestBrokerTaskBackend::test_submit_task_updates_existing_operation",
        "TestBrokerTaskBackend::test_submit_task_creates_new_operation",
        "TestBrokerTaskBackend::test_submit_task_preserves_existing_payload",
        "TestWorkerPoller::test_executor_exception_triggers_retry",
        "TestWorkerPoller::test_executor_failed_status_not_overridden",
        "TestWorkerPoller::test_executor_defer_requeues_without_bumping_retry_count",
        "TestWorkerPoller::test_deferred_task_not_picked_up_until_exec_date",
        "TestWorkerPoller::test_extension_validate_retain_defer_propagates_to_poller",
        "TestWorkerPoller::test_memory_engine_execute_task_passes_through_defer_operation",
    }
)
APPEND_NAMES = frozenset(
    {
        "test_append_mode_metadata_consistent_for_unchanged_and_new_units",
        "test_append_mode_no_existing_document",
        "test_append_mode_requires_document_id",
        "test_replace_mode_is_default",
        "test_append_mode_conversation_arrays_produce_valid_json",
    }
)
DELTA_NAMES = frozenset(
    {
        "test_delta_retain_document_metadata_updated",
        "test_delta_retain_metadata_consistent_for_unchanged_units",
        "test_delta_retain_tags_propagated_to_existing_units",
        "test_delta_retain_removed_chunks_delete_facts",
        "test_delta_retain_chunks_have_content_hash",
        "test_merge_processed_content_tokens_helper",
        "test_processed_content_tokens_first_retain_is_none",
        "test_processed_content_tokens_unchanged_resubmit_is_zero",
        "test_processed_content_tokens_appended_reports_delta",
        "test_processed_content_tokens_without_document_id_is_none",
    }
)
FORBIDDEN_MARKERS = frozenset({"oracle", "integration", "hs_llm_core", "hs_llm_mat"})
FORBIDDEN_FIXTURES = frozenset({"llm_config", "memory_real_llm"})


@dataclass
class FactoryPatch:
    module: ModuleType
    embeddings_factory: object
    cross_encoder_factory: object
    optional_imports: pytest.MonkeyPatch


_patch: FactoryPatch | None = None


def pytest_sessionstart(session: pytest.Session) -> None:
    global _patch
    # The transport guard and owned database remain mandatory even for canned models.
    if not session.config.pluginmanager.hasplugin("g1_fixture_network_guard"):
        raise pytest.UsageError("G1 mechanical fixtures require the owned-fixture network guard")
    if not os.environ.get("HINDSIGHT_API_DATABASE_URL") or not os.environ.get("TAKI_G1_FIXTURE_PORT"):
        raise pytest.UsageError("Run mechanical fixtures only through run_isolated_hindsight.py")

    # Reject broad/unreviewed collection paths before importing test modules.
    # The later item check also enforces exact names in the partially allowed files.
    for selection in session.config.args:
        selected = str(selection).split("::", 1)
        path = Path(selected[0]).resolve()
        if path.is_relative_to(TEST_ROOT / "native_results"):
            continue
        if (path.parent == TEST_ROOT and path.name == "test_worker.py" and len(selected) == 2
                and selected[1].split("[", 1)[0] in WORKER_SELECTORS):
            continue
        if path.parent == TEST_ROOT and path.name in FULL_FILES | {
            "test_retain_append_mode.py",
            "test_delta_retain.py",
        }:
            continue
        raise pytest.UsageError(f"Unreviewed G1 collection path refused: {selection}")

    modules = [
        plugin
        for plugin in session.config.pluginmanager.get_plugins()
        if isinstance(plugin, ModuleType)
        and getattr(plugin, "__file__", None)
        and Path(plugin.__file__).resolve() == ROOT_CONFTEST
    ]
    if len(modules) != 1:
        raise pytest.UsageError("The native root conftest was not uniquely identified")
    conftest = modules[0]

    # Reuse the actual no-I/O embedding implementation already maintained by the
    # same-document concurrency tests; do not register that module's other fixtures.
    module_name = "_g1_native_stub_embeddings"
    spec = importlib.util.spec_from_file_location(module_name, TEST_ROOT / "test_retain_same_document_concurrency.py")
    if spec is None or spec.loader is None:
        raise pytest.UsageError("Native deterministic embedding fixture is unavailable")
    fixture_module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = fixture_module
    spec.loader.exec_module(fixture_module)
    factory = fixture_module._StubEmbeddings
    if factory().dimension != 384:
        raise pytest.UsageError("Native fixture dimension changed; review the isolated schema assumptions")

    from hindsight_api.config import clear_config_cache
    from hindsight_api.engine.cross_encoder import RRFPassthroughCrossEncoder

    os.environ["HINDSIGHT_API_LLM_PROVIDER"] = "mock"
    os.environ["HINDSIGHT_API_LLM_MODEL"] = "mock"
    clear_config_cache()
    optional_imports = pytest.MonkeyPatch()
    # LangChain's package initializer eagerly probes model-backed splitters. The
    # reviewed cases exercise its real character splitter, not those optional ML
    # integrations; use their supported ImportError path instead of loading local
    # Torch/model stacks. The production chunker itself remains unmodified.
    for package in ("sentence_transformers", "transformers", "spacy"):
        optional_imports.setitem(sys.modules, package, None)
    _patch = FactoryPatch(conftest, conftest.LocalSTEmbeddings, conftest.LocalSTCrossEncoder, optional_imports)
    conftest.LocalSTEmbeddings = factory
    conftest.LocalSTCrossEncoder = RRFPassthroughCrossEncoder


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    # Run after pytest's -k/-m selection. Broadening a selector must be a deliberate
    # source review, rather than silently running semantic/live tests with fake models.
    rejected: list[str] = []
    for item in items:
        path = Path(item.path).resolve()
        name = getattr(item, "originalname", None) or item.name.split("[", 1)[0]
        allowed = path.is_relative_to(TEST_ROOT / "native_results")
        if path.parent == TEST_ROOT:
            allowed = allowed or path.name in FULL_FILES
            allowed = allowed or (path.name == "test_retain_append_mode.py" and name in APPEND_NAMES)
            allowed = allowed or (path.name == "test_delta_retain.py" and name in DELTA_NAMES)
            if path.name == "test_worker.py":
                selector = item.nodeid.split("::", 1)[1].split("[", 1)[0]
                allowed = selector in WORKER_SELECTORS
        markers = {marker.name for marker in item.iter_markers()}
        fixtures = set(getattr(item, "fixturenames", ()))
        if not allowed or markers & FORBIDDEN_MARKERS or fixtures & FORBIDDEN_FIXTURES:
            rejected.append(item.nodeid)
    if rejected:
        raise pytest.UsageError("Unreviewed or real-provider G1 selectors refused:\n" + "\n".join(rejected[:12]))


def pytest_sessionfinish() -> None:
    global _patch
    if _patch is not None:
        _patch.module.LocalSTEmbeddings = _patch.embeddings_factory
        _patch.module.LocalSTCrossEncoder = _patch.cross_encoder_factory
        _patch.optional_imports.undo()
        _patch = None
