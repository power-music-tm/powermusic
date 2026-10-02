"""Duplicate matching logic supporting name derivatives, location probes, and false-positive dismissal checks.

PureGym and Health Fitness share the same 4-field duplicate matching:
  first name, last name, email, location

For Health Fitness, the "location" field stores what the partner calls "client".

GLL uses a 3-field model (first name, last name, email) with no location scoring:
  Last Name  = 35 pts  (Jaro-Winkler)
  First Name = 30 pts  (Jaro-Winkler)
  Email      = 10 pts  (exact match)
  Max score  = 75 pts

Partner isolation is enforced by the caller filtering to the correct partner_id
before comparing requests; these functions receive already-filtered sets.
"""

from __future__ import annotations

from typing import Callable, List, Optional, Set, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app import models, schemas


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
    rows = db.query(models.DismissedDuplicateMatch).all()
    pairs = set()
    for r in rows:
        pairs.add((r.request_id_1, r.request_id_2))
        pairs.add((r.request_id_2, r.request_id_1))
    return pairs


def are_requests_dismissed(
    db: Session,
    req_id_1: str,
    req_id_2: str,
    dismissed_set: Optional[Set[Tuple[str, str]]] = None,
) -> bool:
    """True if admin previously unlinked/dismissed a match between these two requests."""
    if not req_id_1 or not req_id_2:
        return False
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

# Minimum Jaro-Winkler similarity for the first name to count as matching.
# Rounded to 6 d.p. before comparison to avoid floating-point boundary instability.
FIRST_NAME_MATCH_MIN = 0.60

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
                  round(jaro_winkler(first_l, first_r), 6) >= FIRST_NAME_MATCH_MIN.
    same_email  : both emails non-empty after _norm() AND exactly equal.
    same_loc    : only evaluated when use_location=True;
                  both locations non-empty after _norm() AND exactly equal.
                  Always False when use_location=False.

    Empty strings, None, and whitespace-only values NEVER count as a match,
    even when both sides are empty/None.
    """
    first_l = _norm(left.firstName)
    last_l  = _norm(left.lastName)
    email_l = _norm(left.email)

    first_r = _norm(right.firstName)
    last_r  = _norm(right.lastName)
    email_r = _norm(right.email)

    same_last   = bool(last_l  and last_r  and last_l  == last_r)
    same_email  = bool(email_l and email_r and email_l == email_r)
    first_match = bool(
        first_l and first_r
        and round(jaro_winkler(first_l, first_r), 6) >= FIRST_NAME_MATCH_MIN
    )

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
      same first AND same last AND same email AND same location
      (exact equality — unchanged from previous behaviour)

    Potential duplicate:
      number of True field flags >= MIN_MATCHED_FIELDS_FOR_POTENTIAL
      AND (same_last OR same_email)

    The numeric score is still computed with the original weights and returned
    for display/debugging.  It no longer gates the classification decision.
    """
    first_l, last_l, email_l, loc_l = _norm(left.firstName), _norm(left.lastName), _norm(left.email), _norm(left.location)
    first_r, last_r, email_r, loc_r = _norm(right.firstName), _norm(right.lastName), _norm(right.email), _norm(right.location)

    if not last_l or not last_r:
        return None, 0.0

    # ── Preserve exact confirmed-duplicate rule ──────────────────────────────
    same_first       = (first_l == first_r)
    same_last_exact  = (last_l  == last_r)
    same_email_exact = bool(email_l and email_r and email_l == email_r)
    same_loc_exact   = bool(loc_l   and loc_r   and loc_l   == loc_r)

    # Score (display only — weights unchanged)
    first_name_score = jaro_winkler(first_l, first_r) * 30.0
    last_name_score  = jaro_winkler(last_l,  last_r)  * 35.0
    loc_score        = 25.0 if same_loc_exact   else 0.0
    email_score      = 10.0 if same_email_exact else 0.0

    total_score = first_name_score + last_name_score + email_score + loc_score

    # 1. Confirmed Duplicate (strict rule — evaluated first, unchanged)
    if same_first and same_last_exact and same_email_exact and same_loc_exact:
        return "confirmed_duplicate", total_score

    # 2. Potential Duplicate — field-flag rule (replaces threshold gate)
    flags    = _field_flags(left, right, use_location=True)
    matched  = sum(flags.values())
    anchored = flags["same_last"] or flags["same_email"]

    if matched >= MIN_MATCHED_FIELDS_FOR_POTENTIAL and anchored:
        return "potential_duplicate", total_score

    return None, total_score


def match_classification_gll(
    left: schemas.PersonInfo,
    right: schemas.PersonInfo,
) -> Tuple[Optional[str], float]:
    """GLL-specific 3-field matching (First Name, Last Name, Email — no Location).

    Weights (display only — score no longer gates classification):
      Last Name  = 35 pts  (Jaro-Winkler, max)
      First Name = 30 pts  (Jaro-Winkler, max)
      Email      = 10 pts  (exact match)
      Max total  = 75 pts

    Classification rule
    -------------------
    Confirmed duplicate (evaluated FIRST):
      exact match on all three fields (unchanged from previous behaviour).

    Potential duplicate:
      number of True field flags >= MIN_MATCHED_FIELDS_FOR_POTENTIAL
      AND (same_last OR same_email)
      Location is never used — GLL records have NULL location.
    """
    first_l = _norm(left.firstName)
    last_l  = _norm(left.lastName)
    email_l = _norm(left.email)

    first_r = _norm(right.firstName)
    last_r  = _norm(right.lastName)
    email_r = _norm(right.email)

    if not last_l or not last_r:
        return None, 0.0

    same_last_exact  = (last_l == last_r)
    same_first_exact = (first_l == first_r)
    same_email_exact = bool(email_l and email_r and email_l == email_r)

    # Confirmed Duplicate: exact match across all three identity fields (unchanged)
    if same_first_exact and same_last_exact and same_email_exact:
        first_name_score = 30.0
        last_name_score  = 35.0
        email_score      = 10.0
        return "confirmed_duplicate", first_name_score + last_name_score + email_score

    # Score (display only — weights unchanged)
    first_name_score = jaro_winkler(first_l, first_r) * 30.0
    last_name_score  = jaro_winkler(last_l,  last_r)  * 35.0
    email_score      = 10.0 if same_email_exact else 0.0

    total_score = first_name_score + last_name_score + email_score

    # Potential Duplicate — field-flag rule (replaces threshold gate)
    # use_location=False: location is never part of the GLL identity model
    flags    = _field_flags(left, right, use_location=False)
    matched  = sum(flags.values())
    anchored = flags["same_last"] or flags["same_email"]

    if matched >= MIN_MATCHED_FIELDS_FOR_POTENTIAL and anchored:
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

    * GLL (is_gll=True)  → 3-field engine (no location, max 75 pts)
    * All others          → shared 4-field engine (PureGym / Health Fitness)

    The is_healthtech flag is accepted for backwards compatibility but no longer
    selects a different algorithm — PureGym and Health Fitness share the same
    4-field match_classification().
    """
    if is_gll:
        return match_classification_gll(left, right)
    return match_classification(left, right)
