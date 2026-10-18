"""Freeze shared lifecycle validation counterexamples without importing runtime code."""

import json
from pathlib import Path


CASES = []


def case(kind, name, value, accepted):
    CASES.append({"kind": kind, "name": name, "value": value, "accepted": accepted})


case("trigger", "complete-preserved-trigger", {
    "mode": "delta", "refresh_after_consolidation": False, "refresh_cron": None,
    "fact_types": ["world", "observation"], "exclude_mental_models": True,
    "exclude_mental_model_ids": ["another-model"], "tags_match": "exact",
    "tag_groups": [{"and": [{"tags": ["one"], "match": "all_strict"},
        {"or": [{"tags": []}, {"not": {"tags": ["two"]}}]}]}],
    "include_chunks": True, "recall_max_tokens": 1024, "recall_chunks_max_tokens": 512,
    "response_schema": {"type": "object", "properties": {
        "__proto__": {"type": "string"}, "雪": {"type": "integer"}}, "required": ["__proto__"]},
    "keep_trace": True,
}, True)
case("trigger", "empty-trigger", {}, True)
case("trigger", "boundary-tag-list", {"tag_groups": [{"tags": ["😀" * 128] * 32}]}, True)
case("trigger", "unknown-nested-leaf-key", {"tag_groups": [{"tags": ["one"], "unexpected": True}]}, False)
case("trigger", "ambiguous-nested-group", {"tag_groups": [{"tags": ["one"], "and": []}]}, False)
case("trigger", "legacy-python-alias-is-not-wire", {"tag_groups": [{"filters": [{"tags": ["one"]}]}]}, False)
case("trigger", "too-many-nested-tags", {"tag_groups": [{"tags": ["one"] * 33}]}, False)
case("trigger", "oversized-nested-tag", {"tag_groups": [{"tags": ["😀" * 129]}]}, False)
case("trigger", "empty-nested-tag", {"tag_groups": [{"tags": [""]}]}, False)
case("trigger", "invalid-excluded-model-id", {"exclude_mental_model_ids": ["legacy_model"]}, False)
case("trigger", "oversized-excluded-model-id", {"exclude_mental_model_ids": ["a" * 257]}, False)
case("trigger", "unsafe-integer-budget", {"recall_max_tokens": 9007199254740992}, False)
case("trigger", "empty-structured-properties", {"response_schema": {"properties": {}}}, False)
case("trigger", "missing-structured-properties", {"response_schema": {"type": "object"}}, False)
case("trigger", "invalid-structured-property-type", {
    "response_schema": {"properties": {"answer": {"type": "invalid"}}}}, False)
case("trigger", "unknown-required-property", {
    "response_schema": {"properties": {"answer": {}}, "required": ["missing"]}}, False)

case("labels", "legacy-group-preserved", [{"key": "legacy", "free_values": True}], True)
case("labels", "complete-map-preserved", {"attributes": [{"key": "person", "type": "map", "fields": {
    "state": {"type": "value", "values": [{"value": "known", "description": "Exact value"}]}}}]}, True)
case("labels", "empty-label-list", [], True)
case("labels", "label-tombstone", None, True)
case("labels", "nested-duplicate-value", [{"key": "person", "fields": {
    "state": {"values": [{"value": "duplicate"}, {"value": "duplicate"}]}}}], False)
case("labels", "nested-description-type", [{"key": "person", "fields": {"state": {"description": 1}}}], False)
case("labels", "group-description-type", [{"key": "person", "description": 1}], False)
case("labels", "label-value-description-type", [{"key": "person", "values": [{"value": "known", "description": 1}]}], False)
case("labels", "nested-empty-field-key", [{"key": "person", "fields": {"": {}}}], False)

for key in ("retain_mission", "observations_instructions", "reflect_mission"):
    case("config", key + "-empty-text", {"key": key, "stored": {"kind": "value", "value": ""}}, True)
    case("config", key + "-numeric-value", {"key": key, "stored": {"kind": "value", "value": 7}}, False)
    case("config", key + "-inherit", {"key": key, "stored": {"kind": "absent"}}, True)
case("config", "labels-wrong-type", {"key": "entity_labels", "stored": {"kind": "value", "value": "text"}}, False)
case("config", "labels-duplicate-group", {"key": "entity_labels", "stored": {
    "kind": "value", "value": [{"key": "duplicate"}, {"key": "duplicate"}]}}, False)

text = json.dumps(CASES, ensure_ascii=False, indent=2) + "\n"
for destination in (
    Path("H:/TakiAgent/packages/shared/src/fixtures/hindsight-template-validation-cases.json"),
    Path("H:/hindsight/hindsight-api-slim/tests/native_results/template_validation_cases.json"),
):
    destination.write_text(text, encoding="utf-8")
print(f"Wrote {len(CASES)} byte-identical validation cases to both repositories")
