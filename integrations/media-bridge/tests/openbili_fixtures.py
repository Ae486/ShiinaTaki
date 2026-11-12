"""Synthetic native wire facts; never imports or initializes OpenBili."""

from copy import deepcopy
import json

import httpx

from media_service_bridge.openbili_config import OpenBiliConfig


TOKEN = "synthetic-openbili-token"
ITEM = {"id": 17, "bvid": "BVfixture", "item_key": "bilibili:BVfixture", "title": "Selected video",
    "content_id": "BVfixture", "content_url": "https://www.bilibili.com/video/BVfixture?p=1",
    "source_platform": "bilibili", "up_name": "Native author", "content_type": "video",
    "duration": 300, "expression": "Native recommendation reason", "presented": False}
PROFILE = {"initialized": True, "likes": [{"domain": "Music", "weight": 0.7,
    "specifics": [{"name": "Guitar", "weight": 0.6}]}],
    "recent_cognition_updates": [{"summary": "May enjoy guitar", "evidence": "Native evidence",
        "source": "content_feedback", "source_label": "Feedback", "created_at": "2026-10-18T00:00:00Z"}],
    "active_insights": [{"hypothesis": "Music interest", "evidence": ["One native event"], "validated": False}],
    "speculative_interests": [{"domain": "Jazz", "reason": "Related to music", "confidence": 0.4}],
    "overrides": {"private_unknown_field": "must-not-leak"}, "unknown_secret": "must-not-leak"}


def openbili_config(**changes):
    return OpenBiliConfig.from_document({"backend_url": "http://127.0.0.1:8123",
        "auth_token_env": "OPENBILI_TEST_TOKEN", **changes})


class OpenBiliStub:
    def __init__(self):
        self.calls = []
        self.items = [deepcopy(ITEM)]
        self.profile = deepcopy(PROFILE)
        self.feedback = {}
        self.hook = None
        self.lose_next_feedback = False

    async def __call__(self, request):
        self.calls.append(request)
        assert request.headers["authorization"] == "Bearer " + TOKEN
        assert request.url.host == "127.0.0.1" and request.url.port == 8123
        if self.hook is not None:
            special = await self.hook(request)
            if special is not None:
                return special
        if request.url.path == "/api/recommendations/peek":
            limit = int(request.url.params["limit"])
            return httpx.Response(200, json={"items": self.items[:limit], "source": "existing_recommendations",
                "total": len(self.items), "has_more": len(self.items) > limit})
        if request.url.path == "/api/recommendations":
            assert not request.url.query
            return httpx.Response(200, json={"items": self.items})
        if request.url.path == "/api/profile-summary":
            assert request.url.params["limit"] == "3"
            return httpx.Response(200, json=self.profile)
        assert request.url.path == "/api/feedback" and request.method == "POST"
        body = json.loads(request.content)
        previous = self.feedback.get(body["request_id"])
        if previous is not None and previous != body:
            return httpx.Response(409, json={"detail": "request_id was already used for different feedback"})
        self.feedback[body["request_id"]] = body
        if self.lose_next_feedback:
            self.lose_next_feedback = False
            raise httpx.ReadError("lost feedback response after durable acceptance " + TOKEN)
        return httpx.Response(200, json={"ok": True, "recommendation_id": body["recommendation_id"],
            "feedback_type": body["feedback_type"], "event_id": 23, "duplicate": previous is not None,
            "processing": "queued"})
