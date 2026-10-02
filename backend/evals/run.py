"""Minimal offline eval for the email-AI pipeline.

Runs the labelled cases in dataset.json through the REAL decision path
(classify -> new-intent check -> semantic template match) and asserts the
fields each case cares about, then prints a scorecard. Re-run it on every prompt
or model change to catch regressions before they reach a customer.

Usage (from backend/):
    GEMINI_API_KEY=<key> .venv-mac/bin/python evals/run.py

Needs a working GEMINI_API_KEY and DB access (reads templates + embeddings for
the inbox named in dataset.json). Read-only; writes nothing.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app import models  # noqa: E402
from app.pilot2 import pipeline  # noqa: E402
from app.pilot2.ai import classifier, embeddings  # noqa: E402


def _match_template_name(db, inbox, templates_by_id, subject, body):
    """Mirror the pipeline's matching: authoritative semantic match (a clear
    winner), else no template (holding reply)."""
    semantic = embeddings.semantic_match_template_ids(db, inbox, subject, body)
    if not semantic:  # None (unavailable) or [] (no clear winner)
        return None
    ids = [tid for tid in semantic if tid in templates_by_id]
    return templates_by_id[ids[0]].name if ids else None


def run() -> int:
    data = json.loads((pathlib.Path(__file__).parent / "dataset.json").read_text())
    inbox = data["inbox"]
    db = SessionLocal()
    try:
        templates = (
            db.query(models.EmailTemplate)
            .filter(models.EmailTemplate.status == "Active", models.EmailTemplate.account_email == inbox)
            .all()
        )
        by_id = {t.id: t for t in templates}
        known = set(pipeline.known_intent_names(db))
        print(f"Eval inbox {inbox}: {len(templates)} templates, {len(known)} known intents\n")

        passed = failed = 0
        failures = []
        for case in data["cases"]:
            subj, body = case["subject"], case["body"]
            c = classifier.classify("Test User", "test@example.com", subj, body, list(templates), known_intents=list(known))
            is_new = c.intent not in known
            template_name = _match_template_name(db, inbox, by_id, subj, body)

            got = {
                "should_ignore": c.should_ignore,
                "new_intent": is_new,
                "template": template_name,
                "urgent": c.urgent,
                "flag": c.flag,
            }
            print(f"  {case['name']}")
            print(f"     intent={c.intent!r} template={template_name!r} ignore={c.should_ignore} urgent={c.urgent} flag={c.flag}")
            for field, want in case.get("expect", {}).items():
                if got.get(field) == want:
                    passed += 1
                else:
                    failed += 1
                    failures.append(f"{case['name']} :: {field} got={got.get(field)!r} want={want!r} (intent={c.intent!r})")

        total = passed + failed
        print(f"\nRESULT: {passed}/{total} assertions passed")
        for f in failures:
            print("  ✗", f)
        return 0 if failed == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run())
