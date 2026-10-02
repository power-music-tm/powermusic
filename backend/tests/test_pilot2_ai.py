"""Unit tests for the Pilot 2 AI layer (no database or API key required).

These exercise the deterministic paths: diff capture, heuristic classifier
fallback, composer fallback, and the Gemini JSON parsing helper.
"""

from types import SimpleNamespace

from app.pilot2 import diffing
from app.pilot2.ai import classifier, composer
from app.pilot2.ai.client import _extract_json


def make_template(id="tmpl-001", name="Cancellation Acknowledgement",
                  intent="Cancellation", status="Active", category="Cancellation"):
    return SimpleNamespace(
        id=id, name=name, intent=intent, status=status, category=category,
        subject="Re: Your cancellation request",
        body="Hi {{first_name}},\n\nWe've received your cancellation request.\n\nKind regards,\nPower Music Team",
    )


class TestDiffing:
    def test_verbatim_send_has_zero_ratio(self):
        text = "Hi David,\n\nThanks for your email.\n"
        assert diffing.edit_ratio(text, text) == 0.0
        assert diffing.unified_diff(text, text) == ""

    def test_edit_produces_diff_and_ratio(self):
        draft = "Hi David,\n\nWe will process your request.\n"
        final = "Hi David,\n\nWe will process your request within 5 business days.\n"
        assert 0 < diffing.edit_ratio(draft, final) < 1
        diff = diffing.unified_diff(draft, final)
        assert "within 5 business days" in diff

    def test_full_rewrite_ratio_is_high(self):
        assert diffing.edit_ratio("aaaa aaaa aaaa", "zzzz yyyy xxxx") > 0.8


class TestHeuristicClassifier:
    def test_cancellation_intent_matches_template(self):
        result = classifier._heuristic(
            "James Walsh", "Cancellation request",
            "Please cancel membership #4421 immediately.", [make_template()],
        )
        assert result.intent == "Cancellation"
        assert result.template_ids == ["tmpl-001"]
        assert result.urgent is True
        assert result.sender_first_name == "James"

    def test_no_template_gets_flagged(self):
        result = classifier._heuristic(
            "Sarah", "Pricing question", "What are your prices?", [make_template(category="Cancellation")],
        )
        assert result.intent == "Enquiry"
        assert result.flag is True
        assert result.template_ids == []

    def test_refund_is_flagged_for_admin(self):
        result = classifier._heuristic(
            "Tom", "Refund", "I would like a refund for my invoice.", [],
        )
        assert result.intent == "Finance"
        assert result.flag is True
        assert "refund" in result.flag_reason.lower()

    def test_empty_body_is_ignored(self):
        result = classifier._heuristic("X", "hello", "   ", [])
        assert result.should_ignore is True


class TestComposerFallback:
    def make_classification(self, **overrides):
        defaults = dict(
            intent="Cancellation", confidence=90, language="en",
            sender_first_name="James", urgent=False, should_ignore=False,
            flag=False, flag_reason=None, template_ids=["tmpl-001"],
        )
        defaults.update(overrides)
        return classifier.Classification(**defaults)

    def test_no_template_yields_fallback_acknowledgement(self):
        draft = composer.compose(
            "body", "subject", self.make_classification(template_ids=[]), [], {}, [],
        )
        assert draft.tweak_level == "fallback"
        assert "Hi James," in draft.body

    def test_without_llm_template_is_filled_verbatim(self, monkeypatch):
        # Force the offline path even when a real API key is configured.
        monkeypatch.setattr(composer, "llm_available", lambda: False)
        draft = composer.compose(
            "body", "subject", self.make_classification(), [make_template()], {}, [],
        )
        assert draft.tweak_level == "verbatim"
        assert "Hi James," in draft.body
        assert "{{" not in draft.body


class TestJsonExtraction:
    def test_plain_json(self):
        assert _extract_json('{"a": 1}') == {"a": 1}

    def test_fenced_json(self):
        assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_json_with_prose(self):
        assert _extract_json('Here you go: {"a": 1}') == {"a": 1}

    def test_garbage_returns_none(self):
        assert _extract_json("not json at all") is None
