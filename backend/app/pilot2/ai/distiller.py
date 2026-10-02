"""Call 3 — offline distillation agent (the learning loop).

Runs on a schedule, never on the request path. It reads the raw draft-vs-sent
diffs accumulated since the last run and MERGES what they teach into the
per-intent guidance notes, which are hard-capped in count and length. Merging
instead of appending is the context-window guarantee: the notes get better
over time, never longer.

When the same template keeps being edited the same way, the lesson shouldn't
stay a prompt rule — the distiller proposes a template revision for the admin
to approve on the dashboard, and the learning graduates into the template
library itself.
"""

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app import models
from app.pilot2 import config
from app.pilot2.ai.client import generate_json, llm_available

logger = logging.getLogger(__name__)

# Edits smaller than this are greeting/punctuation noise, not learnable signal.
MIN_SIGNAL_EDIT_RATIO = 0.03


@dataclass
class DistillResult:
    edits_processed: int = 0
    intents_updated: list = field(default_factory=list)
    suggestions_created: int = 0


_SYSTEM = """You maintain the drafting guidance for an AI email assistant.
You receive the CURRENT RULES for one email intent and a batch of EDITS the
human admin made to AI drafts before sending them (unified diffs).

Produce an updated rule set that captures what the edits teach about wording,
tone, structure, and content. Requirements:
- MERGE new lessons into the existing rules: dedupe, generalise, and drop
  rules the edits contradict. Do NOT simply append.
- At most {max_rules} rules, each a single imperative sentence under
  {max_chars} characters, in English.
- Only include rules supported by the edits; ignore one-off idiosyncrasies.

Also: if several edits change the SAME template in the same way, that lesson
belongs in the template itself, not in a rule. Propose a template REVISION
instead (full corrected body, keeping {{{{placeholders}}}} intact). Only
propose revisions for template_ids that appear in the edits — never propose
brand-new templates here (those are created when Andrea sends a reply without
a matching template).

Return ONLY a JSON object:
- rules: array of strings
- template_suggestions: array of revision objects with keys template_id, name,
  subject, body, rationale (empty array if none). Every template_id MUST
  refer to an existing template from the edits."""


def run_distillation(db: Session) -> DistillResult:
    result = DistillResult()

    edits = (
        db.query(models.DraftEdit)
        .filter(models.DraftEdit.distilled.is_(False))
        .order_by(models.DraftEdit.created_at.asc())
        .limit(config.DISTILL_BATCH_SIZE)
        .all()
    )
    if not edits:
        return result

    now = datetime.now(timezone.utc)

    # Verbatim (or near-verbatim) sends confirm the draft was right — nothing
    # to learn, retire them from the queue.
    signal_edits = []
    for edit in edits:
        if edit.edit_ratio < MIN_SIGNAL_EDIT_RATIO:
            edit.distilled = True
        else:
            signal_edits.append(edit)

    if not llm_available():
        # Without the LLM we cannot interpret diffs; leave signal edits queued
        # so the next run with a key picks them up.
        db.add(models.ProcessingLog(
            timestamp=now, type="distillation_skipped",
            description="Distillation skipped: GEMINI_API_KEY not configured.",
        ))
        db.commit()
        return result

    templates_by_id = {t.id: t for t in db.query(models.EmailTemplate).all()}
    by_intent = defaultdict(list)
    for edit in signal_edits:
        by_intent[edit.intent or "Enquiry"].append(edit)

    for intent, intent_edits in by_intent.items():
        note = (
            db.query(models.GuidanceNote)
            .filter(models.GuidanceNote.intent == intent)
            .first()
        )
        current_rules = list(note.rules) if note else []

        edits_payload = [
            {
                "template": templates_by_id[e.template_id].name
                if e.template_id in templates_by_id else None,
                "template_id": e.template_id,
                "language": e.language,
                "diff": e.diff[:4000],
                "edit_ratio": e.edit_ratio,
            }
            for e in intent_edits
        ]
        prompt = (
            f"INTENT: {intent}\n\nCURRENT RULES:\n{json.dumps(current_rules, indent=2)}"
            f"\n\nEDITS ({len(edits_payload)}):\n{json.dumps(edits_payload, indent=2)}"
        )
        response = generate_json(
            config.DISTILLER_MODEL,
            _SYSTEM.format(max_rules=config.MAX_RULES_PER_INTENT, max_chars=config.MAX_RULE_CHARS),
            prompt,
            kind="distill",
        )
        if response is None:
            logger.warning("Distillation LLM call failed for intent %s; edits left queued", intent)
            continue

        # Enforce the caps ourselves — never trust the model to respect them.
        rules = [
            str(r).strip()[: config.MAX_RULE_CHARS]
            for r in (response.get("rules") or [])
            if str(r).strip()
        ][: config.MAX_RULES_PER_INTENT]

        if note is None:
            note = models.GuidanceNote(intent=intent, rules=rules, version=1, updated_at=now)
            db.add(note)
        else:
            note.rules = rules
            note.version += 1
            note.updated_at = now

        # Template revisions are only proposed, never applied — the admin
        # approves them on the dashboard.
        template_edit_counts = defaultdict(int)
        for e in intent_edits:
            if e.template_id:
                template_edit_counts[e.template_id] += 1
        for suggestion in response.get("template_suggestions") or []:
            template_id = suggestion.get("template_id")
            template = templates_by_id.get(template_id)
            if template is None:
                continue
            if template_edit_counts[template_id] < config.SUGGESTION_MIN_EDITS:
                continue
            pending_exists = (
                db.query(models.TemplateSuggestion)
                .filter(
                    models.TemplateSuggestion.template_id == template_id,
                    models.TemplateSuggestion.status == "pending",
                )
                .first()
            )
            if pending_exists:
                continue
            db.add(models.TemplateSuggestion(
                kind="revision",
                template_id=template_id,
                account_email=template.account_email,
                intent=intent,
                suggested_name=suggestion.get("name") or template.name,
                suggested_subject=suggestion.get("subject") or template.subject,
                suggested_body=str(suggestion.get("body") or "").strip() or template.body,
                rationale=suggestion.get("rationale"),
                status="pending",
                created_at=now,
            ))
            result.suggestions_created += 1

        for e in intent_edits:
            e.distilled = True
        result.edits_processed += len(intent_edits)
        result.intents_updated.append(intent)

        db.add(models.ProcessingLog(
            timestamp=now, type="guidance_updated",
            description=f"Guidance for '{intent}' updated to v{note.version} "
                        f"from {len(intent_edits)} admin edits.",
        ))

    result.edits_processed += len(edits) - len(signal_edits)
    db.commit()
    return result
