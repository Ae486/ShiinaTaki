"""Bounded OpenBili wire projections and native feedback identity validation.

Native recommendation IDs and event receipts remain authoritative. No pool
state, synthetic exposure signal or bridge-owned preference score is created.
"""

from .contracts import BridgeError, json_object


ERRORS = {
    "openbili_not_configured": "OpenBili is not configured with an independent origin and available token.",
    "openbili_unavailable": "OpenBili could not be read; no native initialization or automatic retry was attempted.",
    "openbili_unauthorized": "OpenBili rejected its own credential; operator configuration is required.",
    "openbili_response_invalid": "OpenBili returned an invalid or oversized response; no partial result was accepted.",
    "openbili_input_invalid": "Use the documented bounds, native recommendation ID and retained feedback request_id.",
    "openbili_feedback_conflict": "This request_id belongs to different feedback. Do not reuse it for a changed payload.",
    "openbili_recommendation_not_found": "The native recommendation no longer exists; do not invent another ID.",
    "openbili_feedback_rejected": "OpenBili rejected this feedback. It was not acknowledged as queued.",
    "openbili_outcome_unknown": "The native side effect is unconfirmed. Do not replay list browsing; feedback may retry only the exact original payload and request_id.",
    "openbili_closed": "This bridge generation is closed; no native request was sent.",
}
FEEDBACK_TYPES = ("like", "dislike", "comment", "dismiss")


class OpenBiliError(RuntimeError):
    def __init__(self, code, *, request_id=None):
        self.code = code if code in ERRORS else "openbili_unavailable"
        self.request_id = request_id
        super().__init__(self.code)

    def public(self):
        result = {"ok": False, "source": "openbili", "error": {"code": self.code, "message": ERRORS[self.code]}}
        if self.request_id is not None:
            result["request_id"] = self.request_id
        return result


def object_body(content):
    try:
        return json_object(content)
    except BridgeError as exc:
        raise OpenBiliError("openbili_response_invalid") from exc


def positive_int(value, maximum=9007199254740991):
    return type(value) is int and 1 <= value <= maximum


def feedback_input(request_id, recommendation_id, feedback_type, note):
    # Native IdempotencyKey trims and accepts up to 400 characters. Preserve
    # that normalized key on every outcome; never generate a replacement here.
    if (not isinstance(request_id, str) or not 1 <= len(request_id.strip()) <= 400
            or not positive_int(recommendation_id) or feedback_type not in FEEDBACK_TYPES
            or not isinstance(note, str) or len(note) > 2000
            or (feedback_type == "comment" and not note.strip())):
        raise OpenBiliError("openbili_input_invalid")
    return {"request_id": request_id.strip(), "recommendation_id": recommendation_id,
        "feedback_type": feedback_type, "note": note.strip()}


def feedback_receipt(value, submitted):
    if (value.get("ok") is not True or value.get("recommendation_id") != submitted["recommendation_id"]
            or type(value.get("recommendation_id")) is not int
            or value.get("feedback_type") != submitted["feedback_type"]
            or not positive_int(value.get("event_id")) or type(value.get("duplicate")) is not bool
            or value.get("processing") != "queued"):
        raise OpenBiliError("openbili_response_invalid")
    return {"ok": True, "source": "openbili", "request_id": submitted["request_id"],
        **{key: value[key] for key in ("recommendation_id", "feedback_type", "event_id", "duplicate", "processing")},
        "profile_application": "not_confirmed"}


TEXT_FIELDS = {"bvid": 128, "item_key": 512, "title": 500, "up_name": 200, "expression": 2000,
    "topic_label": 200, "feedback_type": 32, "content_id": 256, "content_url": 2048,
    "source_platform": 64, "published_at": 64, "published_label": 100, "content_type": 64,
    "body_text": 2000}
COUNT_FIELDS = ("duration", "view_count", "like_count", "danmaku_count", "favorite_count",
    "comment_count", "share_count", "rating_count", "source_rank", "up_mid")


def recommendation_item(value):
    if not isinstance(value, dict) or not positive_int(value.get("id")) or not isinstance(value.get("bvid"), str):
        raise OpenBiliError("openbili_response_invalid")
    result, truncated = {"id": value["id"]}, False
    for key, cap in TEXT_FIELDS.items():
        if key not in value:
            continue
        if not isinstance(value[key], str):
            raise OpenBiliError("openbili_response_invalid")
        if len(value[key]) > cap:
            # Identity and URLs cannot be meaningfully truncated. Refuse them
            # instead of exposing a different target for feedback or analysis.
            if key in {"bvid", "item_key", "content_id", "content_url", "source_platform"}:
                raise OpenBiliError("openbili_response_invalid")
            truncated = True
        result[key] = value[key][:cap]
    for key in COUNT_FIELDS:
        if key in value:
            if type(value[key]) is not int or not 0 <= value[key] <= 9007199254740991:
                raise OpenBiliError("openbili_response_invalid")
            result[key] = value[key]
    if "presented" in value:
        if type(value["presented"]) is not bool:
            raise OpenBiliError("openbili_response_invalid")
        result["presented"] = value["presented"]
    return result, truncated


def recommendation_list(value, *, peek, limit):
    rows = value.get("items")
    if not isinstance(rows, list) or len(rows) > 20:
        raise OpenBiliError("openbili_response_invalid")
    total, has_more = len(rows), len(rows) > limit
    if peek:
        total, has_more = value.get("total"), value.get("has_more")
        if (value.get("source") != "existing_recommendations" or type(total) is not int
                or not len(rows) <= total <= 20 or len(rows) > limit
                or type(has_more) is not bool or has_more != (total > len(rows))):
            raise OpenBiliError("openbili_response_invalid")
    projected = [recommendation_item(row) for row in rows]
    if len({row["id"] for row, _cut in projected}) != len(projected):
        raise OpenBiliError("openbili_response_invalid")
    return {"ok": True, "source": "existing_recommendations" if peek else "native_user_list", "complete": False,
        "items": [row for row, _cut in projected[:limit]], "total": total, "has_more": has_more,
        "truncated": has_more or any(cut for _row, cut in projected[:limit]),
        "native_side_effects": "none" if peek else "may_top_up_and_serve_recommendations",
        "exposure_evidence": "not_established_by_this_read"}
