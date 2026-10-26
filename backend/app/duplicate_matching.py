"""Duplicate matching logic supporting name derivatives, location probes, and false-positive dismissal checks.

PureGym and Health Fitness share the same duplicate matching model with
name treated as ONE entity (first+last), plus email and location:
  Name (first nickname-match AND last exact), email, location

Exact same non-empty email is always a confirmed duplicate (complete match),
even when name and location differ.

For Health Fitness, the "location" field stores what the partner calls "client".

GLL uses first, last, email, and optional location (only when both sides filled):
  Exact same email is confirmed.
  Potential when an allowed field pair/triple matches (first may use nicknames).
  Last+location alone is never a match.

Partner isolation is enforced by the caller filtering to the correct partner_id
before comparing requests; these functions receive already-filtered sets.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, List, Optional, Set, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app import models, read_cache, schemas


import re

# ---------------------------------------------------------------------------
# Partner detection (retained for call-site compatibility)
# ---------------------------------------------------------------------------

_HEALTHTECH_PARTNER_CACHE: dict[str, bool] = {}
_GLL_PARTNER_CACHE: dict[str, bool] = {}


def is_healthtech_partner(db: Session, partner_id: Optional[str]) -> bool:
    """Return True when *partner_id* belongs to the Health Fitness partner.

    The check is name-based (case-insensitive substring) so it survives
    partner renames as long as 'healthtech', 'health tech', or 'health fitness'
    is present in the name.
    Results are cached for the lifetime of the process (partners don't change
    at runtime).

    NOTE: Health Fitness now uses the same matching algorithm as PureGym.
    This function is retained so all existing call-sites remain unchanged.
    """
    if not partner_id:
        return False
    if partner_id in _HEALTHTECH_PARTNER_CACHE:
        return _HEALTHTECH_PARTNER_CACHE[partner_id]
    partner = db.query(models.Partner).filter(models.Partner.id == partner_id).first()
    name_lower = (partner.name if partner else "").lower()
    result = (
        "healthtech" in name_lower
        or "health tech" in name_lower
        or "health fitness" in name_lower
    )
    _HEALTHTECH_PARTNER_CACHE[partner_id] = result
    return result


def is_gll_partner(db: Session, partner_id: Optional[str]) -> bool:
    """Return True when *partner_id* belongs to the GLL partner.

    The check is name-based (case-insensitive substring) so it survives
    partner renames as long as 'gll' is present in the name or slug.
    Results are cached for the lifetime of the process.
    """
    if not partner_id:
        return False
    if partner_id in _GLL_PARTNER_CACHE:
        return _GLL_PARTNER_CACHE[partner_id]
    partner = db.query(models.Partner).filter(models.Partner.id == partner_id).first()
    name_lower = (partner.name if partner else "").lower()
    result = "gll" in name_lower
    _GLL_PARTNER_CACHE[partner_id] = result
    return result


def is_gll_from_request(db: Session, req: models.ManagerRequest) -> bool:
    """Convenience wrapper — detect GLL from a ManagerRequest instance."""
    return is_gll_partner(db, req.partner_id)


def is_healthtech_from_request(db: Session, req: models.ManagerRequest) -> bool:
    """Convenience wrapper — detect Health Fitness from a ManagerRequest instance."""
    return is_healthtech_partner(db, req.partner_id)


def _norm(val: Optional[str]) -> str:
    if not val:
        return ""
    val = val.strip().lower()
    return re.sub(r'\s+', ' ', val)


def jaro_winkler(s1: str, s2: str) -> float:
    if s1 == s2:
        return 1.0
    if not s1 or not s2:
        return 0.0

    len1, len2 = len(s1), len(s2)
    match_distance = max(len1, len2) // 2 - 1

    matches = 0
    hash1 = [False] * len1
    hash2 = [False] * len2

    for i in range(len1):
        start = max(0, i - match_distance)
        end = min(len2, i + match_distance + 1)
        for j in range(start, end):
            if not hash2[j] and s1[i] == s2[j]:
                hash1[i] = True
                hash2[j] = True
                matches += 1
                break

    if matches == 0:
        return 0.0

    t = 0
    point = 0
    for i in range(len1):
        if hash1[i]:
            while not hash2[point]:
                point += 1
            if s1[i] != s2[point]:
                t += 1
            point += 1
    t /= 2

    m = float(matches)
    jaro = (m / len1 + m / len2 + (m - t) / m) / 3.0

    prefix = 0
    for i in range(min(4, min(len1, len2))):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break

    return jaro + prefix * 0.1 * (1.0 - jaro)


def get_all_dismissed_pairs(db: Session) -> Set[Tuple[str, str]]:
    """Fetch all dismissed duplicate match pairs as a set of (id1, id2) tuples."""

    def load() -> Set[Tuple[str, str]]:
        pairs = set()
        for r in db.query(models.DismissedDuplicateMatch).all():
            pairs.add((r.request_id_1, r.request_id_2))
            pairs.add((r.request_id_2, r.request_id_1))
        return pairs

    return set(read_cache.cached(("dismissed_pairs",), load))


def get_all_rejected_nickname_pairs(db: Session) -> Set[Tuple[str, str]]:
    """Ordered (name_a, name_b) pairs admin marked as different nicknames."""

    def load() -> Set[Tuple[str, str]]:
        # Use a SAVEPOINT so a missing table (pre-migration) does not poison the
        # outer transaction — critical for SQLite in-memory tests and mid-deploy.
        try:
            with db.begin_nested():
                rows = db.query(models.RejectedNicknamePair).all()
                return {(r.name_a, r.name_b) for r in rows if r.name_a and r.name_b}
        except Exception:
            return set()

    return set(read_cache.cached(("rejected_nickname_pairs",), load))


def get_all_confirmed_nickname_pairs(db: Session) -> Set[Tuple[str, str]]:
    """Ordered (name_a, name_b) pairs admin confirmed as the same person."""
    try:
        with db.begin_nested():
            rows = db.query(models.ConfirmedNicknamePair).all()
            return {(r.name_a, r.name_b) for r in rows if r.name_a and r.name_b}
    except Exception:
        return set()


def get_answered_nickname_pair_keys(db: Session) -> Set[str]:
    """Normalized ``a|b`` keys for pairs already answered (Yes or No)."""
    keys: Set[str] = set()
    for a, b in get_all_rejected_nickname_pairs(db):
        keys.add(f"{a}|{b}")
    for a, b in get_all_confirmed_nickname_pairs(db):
        keys.add(f"{a}|{b}")
    return keys


def _admin_uuid(admin_id: Optional[str]):
    if not admin_id or admin_id == "dev-bypass":
        return None
    try:
        from uuid import UUID
        return UUID(admin_id)
    except ValueError:
        return None


def record_rejected_nickname_pair(
    db: Session,
    left: Optional[str],
    right: Optional[str],
    *,
    admin_id: Optional[str] = None,
    source_group_id: Optional[str] = None,
) -> Optional[models.RejectedNicknamePair]:
    """Persist that two nickname-linked first names are different people.

    No-op when names are empty, exact after normalize, or already stored.
    Clears a prior Yes (confirmed) answer for the same pair.
    """
    from app.nickname_match import is_nickname_only_first_match, ordered_nickname_pair
    import uuid as _uuid

    key = ordered_nickname_pair(left, right)
    if not key:
        return None
    if not is_nickname_only_first_match(left, right):
        return None

    # Opposite answer wins — drop confirmed if present.
    db.query(models.ConfirmedNicknamePair).filter(
        models.ConfirmedNicknamePair.name_a == key[0],
        models.ConfirmedNicknamePair.name_b == key[1],
    ).delete(synchronize_session=False)

    existing = (
        db.query(models.RejectedNicknamePair)
        .filter(
            models.RejectedNicknamePair.name_a == key[0],
            models.RejectedNicknamePair.name_b == key[1],
        )
        .first()
    )
    if existing:
        return existing

    row = models.RejectedNicknamePair(
        id=f"rnick-{_uuid.uuid4().hex[:12]}",
        name_a=key[0],
        name_b=key[1],
        rejected_by_admin_id=_admin_uuid(admin_id),
        source_group_id=source_group_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    return row


def record_confirmed_nickname_pair(
    db: Session,
    left: Optional[str],
    right: Optional[str],
    *,
    admin_id: Optional[str] = None,
    source_group_id: Optional[str] = None,
) -> Optional[models.ConfirmedNicknamePair]:
    """Persist that two nickname-linked first names are the same person.

    Skips the confirmation modal next time. Clears a prior No (rejected) answer.
    """
    from app.nickname_match import is_nickname_only_first_match, ordered_nickname_pair
    import uuid as _uuid

    key = ordered_nickname_pair(left, right)
    if not key:
        return None
    if not is_nickname_only_first_match(left, right):
        return None

    db.query(models.RejectedNicknamePair).filter(
        models.RejectedNicknamePair.name_a == key[0],
        models.RejectedNicknamePair.name_b == key[1],
    ).delete(synchronize_session=False)

    existing = (
        db.query(models.ConfirmedNicknamePair)
        .filter(
            models.ConfirmedNicknamePair.name_a == key[0],
            models.ConfirmedNicknamePair.name_b == key[1],
        )
        .first()
    )
    if existing:
        return existing

    row = models.ConfirmedNicknamePair(
        id=f"cnick-{_uuid.uuid4().hex[:12]}",
        name_a=key[0],
        name_b=key[1],
        confirmed_by_admin_id=_admin_uuid(admin_id),
        source_group_id=source_group_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    return row


def are_requests_dismissed(
    db: Session,
    req_id_1: str,
    req_id_2: str,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> bool:
    """True if admin previously unlinked/dismissed a match between these two requests."""
    if not req_id_1 or not req_id_2:
        return False
    if dismissed_set is None and read_cache.is_active():
        dismissed_set = get_all_dismissed_pairs(db)
    if dismissed_set is not None:
        return (req_id_1, req_id_2) in dismissed_set
    existing = (
        db.query(models.DismissedDuplicateMatch)
        .filter(
            or_(
                (models.DismissedDuplicateMatch.request_id_1 == req_id_1) & (models.DismissedDuplicateMatch.request_id_2 == req_id_2),
                (models.DismissedDuplicateMatch.request_id_1 == req_id_2) & (models.DismissedDuplicateMatch.request_id_2 == req_id_1),
            )
        )
        .first()
    )
    return existing is not None


def get_dismissed_request_ids_for(db: Session, req_id: str) -> Set[str]:
    """Set of all request IDs dismissed against req_id."""
    if not req_id:
        return set()
    rows = (
        db.query(models.DismissedDuplicateMatch)
        .filter(
            or_(
                models.DismissedDuplicateMatch.request_id_1 == req_id,
                models.DismissedDuplicateMatch.request_id_2 == req_id,
            )
        )
        .all()
    )
    dismissed = set()
    for row in rows:
        dismissed.add(row.request_id_2 if row.request_id_1 == req_id else row.request_id_1)
    return dismissed


# ---------------------------------------------------------------------------
# Scoring constants  (kept for display / debugging — no longer gate classification)
# ---------------------------------------------------------------------------

# 4-field partners: max score = 30 (first) + 35 (last) + 10 (email) + 25 (loc) = 100
POTENTIAL_DUPLICATE_THRESHOLD = 45.0

# GLL: max score = 30 (first) + 35 (last) + 10 (email) = 75
GLL_POTENTIAL_DUPLICATE_THRESHOLD = 33.75

# ---------------------------------------------------------------------------
# Field-match classification constants
# ---------------------------------------------------------------------------

# Deprecated: first-name Potential matching no longer uses Jaro-Winkler.
# Kept so older tests/imports that reference the constant do not break.
FIRST_NAME_MATCH_MIN = 0.65

# Minimum number of True field flags required for a potential-duplicate verdict.
MIN_MATCHED_FIELDS_FOR_POTENTIAL = 2


# ---------------------------------------------------------------------------
# Shared field-flag helper
# ---------------------------------------------------------------------------

def _field_flags(
    left: schemas.PersonInfo,
    right: schemas.PersonInfo,
    *,
    use_location: bool,
) -> dict:
    """Compute boolean field-match flags for two person records.

    Both classifiers (4-field and GLL) MUST call this helper so their
    field-match decisions cannot diverge.

    Rules
    -----
    same_last   : both last names non-empty after _norm() AND exactly equal.
                  Fuzzy matching is NOT used for last names.
    first_match : both first names non-empty after _norm() AND
                  (exact equal OR nickname-dataset related).
                  Jaro-Winkler is NOT used for this flag.
    same_email  : both emails non-empty after _norm() AND exactly equal.
    same_loc    : only evaluated when use_location=True;
                  both locations non-empty after _norm() AND exactly equal.
                  Always False when use_location=False.

    Empty strings, None, and whitespace-only values NEVER count as a match,
    even when both sides are empty/None.
    """
    from app.nickname_match import first_names_nickname_match, normalize_first_name

    # First names: case + spacing insensitive ("RUBAB" / "ru bab" / "rubab").
    first_l = normalize_first_name(left.firstName)
    first_r = normalize_first_name(right.firstName)
    last_l  = _norm(left.lastName)
    email_l = _norm(left.email)

    last_r  = _norm(right.lastName)
    email_r = _norm(right.email)

    same_last   = bool(last_l  and last_r  and last_l  == last_r)
    same_email  = bool(email_l and email_r and email_l == email_r)
    first_match = bool(first_l and first_r and first_names_nickname_match(first_l, first_r))

    if use_location:
        loc_l    = _norm(left.location)
        loc_r    = _norm(right.location)
        same_loc = bool(loc_l and loc_r and loc_l == loc_r)
    else:
        same_loc = False

    return {
        "same_last":   same_last,
        "first_match": first_match,
        "same_email":  same_email,
        "same_loc":    same_loc,
    }


def match_classification(
    left: schemas.PersonInfo,
    right: schemas.PersonInfo,
) -> Tuple[Optional[str], float]:
    """Returns ('confirmed_duplicate' | 'potential_duplicate' | None, score).

    Shared 4-field implementation for PureGym and Health Fitness.
    For Health Fitness, the "location" field stores what the partner calls "client".
    The stored value and matching logic are identical — only the UI label differs.

    Classification rule
    -------------------
    Confirmed duplicate (evaluated FIRST):
      exact same non-empty email (complete match on its own).

    Potential duplicate (name treated as ONE entity; only when emails differ):
      Entities: Name, Email, Location
      Name matches only when first_match AND same_last are both True
        (first uses nickname matching; last is exact).
      Potential when at least two of those three entities match.
      Examples: Name+Location (different emails).
      Name alone (first+last, different email/location) is NOT enough.

    The numeric score is still computed with the original weights and returned
    for display/debugging.  It no longer gates the classification decision.
    """
    from app.nickname_match import normalize_first_name

    first_l = normalize_first_name(left.firstName)
    first_r = normalize_first_name(right.firstName)
    last_l, email_l, loc_l = _norm(left.lastName), _norm(left.email), _norm(left.location)
    last_r, email_r, loc_r = _norm(right.lastName), _norm(right.email), _norm(right.location)

    if not last_l or not last_r:
        return None, 0.0

    same_email_exact = bool(email_l and email_r and email_l == email_r)
    same_loc_exact   = bool(loc_l   and loc_r   and loc_l   == loc_r)

    # Score (display only — weights unchanged)
    first_name_score = jaro_winkler(first_l, first_r) * 30.0
    last_name_score  = jaro_winkler(last_l,  last_r)  * 35.0
    loc_score        = 25.0 if same_loc_exact   else 0.0
    email_score      = 10.0 if same_email_exact else 0.0

    total_score = first_name_score + last_name_score + email_score + loc_score

    # 1. Confirmed Duplicate — exact same non-empty email is a complete match
    # (covers the former all-four-identity confirmed case as well).
    if same_email_exact:
        return "confirmed_duplicate", total_score

    # 2. Potential Duplicate — name is one entity among {Name, Email, Location}
    # (emails already differ / are empty — same_email cannot contribute here).
    flags = _field_flags(left, right, use_location=True)
    name_match = flags["first_match"] and flags["same_last"]
    entity_matched = sum((name_match, flags["same_email"], flags["same_loc"]))

    if entity_matched >= MIN_MATCHED_FIELDS_FOR_POTENTIAL:
        return "potential_duplicate", total_score

    return None, total_score


def _gll_allowed_field_combo(
    *,
    first_match: bool,
    same_last: bool,
    same_email: bool,
    same_loc: bool,
) -> bool:
    """True when GLL flags form an allowed matching combination.

    Allowed pairs (and any superset):
      first+last, first+email, first+location, last+email, email+location
    Forbidden:
      last+location alone (too common without first/email)
    """
    if same_last and same_loc and not first_match and not same_email:
        return False
    return (
        (first_match and same_last)
        or (first_match and same_email)
        or (first_match and same_loc)
        or (same_last and same_email)
        or (same_email and same_loc)
    )


def match_classification_gll(
    left: schemas.PersonInfo,
    right: schemas.PersonInfo,
) -> Tuple[Optional[str], float]:
    """GLL matching: first, last, email, optional location.

    Weights (display only — score no longer gates classification):
      Last Name  = 35 pts  (Jaro-Winkler, max)
      First Name = 30 pts  (Jaro-Winkler, max)
      Email      = 10 pts  (exact match)
      Max total  = 75 pts
      Location does not change the numeric score.

    Classification rule
    -------------------
    Confirmed duplicate (evaluated FIRST):
      exact same non-empty email (complete match on its own).

    Potential duplicate (only when emails differ / are empty):
      Allowed field combos (first may nickname-match; location only if both filled):
        first+last, first+email, first+location, last+email, email+location
        (and any three-/four-field superset of those).
      Never: last+location alone.
    """
    from app.nickname_match import normalize_first_name

    first_l = normalize_first_name(left.firstName)
    first_r = normalize_first_name(right.firstName)
    last_l  = _norm(left.lastName)
    email_l = _norm(left.email)

    last_r  = _norm(right.lastName)
    email_r = _norm(right.email)

    if not last_l or not last_r:
        return None, 0.0

    same_email_exact = bool(email_l and email_r and email_l == email_r)

    # Score (display only — weights unchanged; location excluded from score)
    first_name_score = jaro_winkler(first_l, first_r) * 30.0
    last_name_score  = jaro_winkler(last_l,  last_r)  * 35.0
    email_score      = 10.0 if same_email_exact else 0.0

    total_score = first_name_score + last_name_score + email_score

    # Confirmed Duplicate — exact email alone is complete.
    if same_email_exact:
        return "confirmed_duplicate", total_score

    # Potential — optional location counts only when both sides have it.
    flags = _field_flags(left, right, use_location=True)
    if _gll_allowed_field_combo(
        first_match=flags["first_match"],
        same_last=flags["same_last"],
        same_email=flags["same_email"],
        same_loc=flags["same_loc"],
    ):
        return "potential_duplicate", total_score

    return None, total_score


def match_classification_for_partner(
    left: schemas.PersonInfo,
    right: schemas.PersonInfo,
    *,
    is_healthtech: bool = False,
    is_gll: bool = False,
) -> Tuple[Optional[str], float]:
    """Partner-aware classification wrapper.

    * GLL (is_gll=True)  → GLL engine (first/last/email + optional location)
    * All others          → shared 4-field engine (PureGym / Health Fitness)

    The is_healthtech flag is accepted for backwards compatibility but no longer
    selects a different algorithm — PureGym and Health Fitness share the same
    4-field match_classification().
    """
    if is_gll:
        return match_classification_gll(left, right)
    return match_classification(left, right)
