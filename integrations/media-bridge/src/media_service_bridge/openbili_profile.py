"""Small source-attributed projection of native profile inference and evidence.

No user fact, Memory write or preference score is derived here. Native profile
fields can include manual overrides; this view does not infer their provenance.
"""

from datetime import datetime, timezone

from .openbili_contracts import OpenBiliError


class ProfileProjection:
    def __init__(self):
        self.truncated = False

    def text(self, value, cap=500):
        if not isinstance(value, str):
            raise OpenBiliError("openbili_response_invalid")
        self.truncated |= len(value) > cap
        return value[:cap]

    def rows(self, value, cap=3):
        if not isinstance(value, list):
            raise OpenBiliError("openbili_response_invalid")
        self.truncated |= len(value) > cap
        return value[:cap]

    def record(self, value, fields):
        if not isinstance(value, dict):
            raise OpenBiliError("openbili_response_invalid")
        return {key: self.text(value[key]) for key in fields if key in value}

    def domains(self, rows):
        result = []
        for value in self.rows(rows, 6):
            item = self.record(value, ("domain", "reason"))
            item["specifics"] = [self.record(row, ("name",)) for row in self.rows(value.get("specifics", []))]
            result.append(item)
        return result


def profile_summary(value, *, read_at=None):
    if type(value.get("initialized")) is not bool:
        raise OpenBiliError("openbili_response_invalid")
    projection = ProfileProjection()
    profile = {}
    if value["initialized"]:
        for key in ("likes", "dislikes", "speculative_interests", "speculative_avoidances"):
            profile[key] = projection.domains(value.get(key, []))
        profile["favorite_up_users"] = [projection.text(row, 200)
            for row in projection.rows(value.get("favorite_up_users", []), 6)]
        profile["style"] = projection.record(value.get("style", {}), ("preferred_duration", "preferred_pace"))
        profile["recent_cognition_updates"] = [projection.record(row,
            ("summary", "evidence", "source", "source_label", "created_at"))
            for row in projection.rows(value.get("recent_cognition_updates", []))]
        insights = []
        for row in projection.rows(value.get("active_insights", [])):
            item = projection.record(row, ("hypothesis", "created_at"))
            item["evidence"] = [projection.text(text) for text in projection.rows(row.get("evidence", []))]
            insights.append(item)
        profile["active_insights"] = insights
    if type(value.get("has_more_cognition_updates", False)) is not bool:
        raise OpenBiliError("openbili_response_invalid")
    return {"ok": True, "source": "openbili", "source_endpoint": "/api/profile-summary",
        "read_at_utc": read_at or datetime.now(timezone.utc).isoformat(),
        "evidence_kind": "native_inferred_profile",
        "provenance_note": "Native inference may include user overrides; this projection is not verified user facts.",
        "initialized": value["initialized"],
        "availability": "available" if value["initialized"] else "not_initialized_or_native_read_failed",
        "complete": False, "truncated": projection.truncated or value.get("has_more_cognition_updates", False),
        "profile": profile}
