"""Compute overview insights for the admin dashboard."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.directory_person_match import (
    archived_snapshot_rows,
    directory_ledger_rows,
    removed_snapshot_rows,
    roster_snapshot_rows,
)
from app.manager_request_tags import (
    TAG_ALREADY_EXISTS,
    TAG_AUTO_MAIL,
    TAG_PARTNER_REQUEST,
    TAG_UNVERIFIED,
    TAG_VERIFIED,
)


def _day_start(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def build_dashboard_insights(
    db: Session,
    *,
    pending: List[models.ManagerRequest],
    pending_payloads: Optional[List[dict]] = None,
    partner_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict:
    pending_add = sum(1 for row in pending if (row.action or "").lower() == "add")
    pending_remove = sum(1 for row in pending if (row.action or "").lower() == "remove")

    # Prefer API payloads so "already exists" matches New requests (includes
    # directory-derived tags, not only rows that stored the tag in the DB).
    tag_rows = pending_payloads if pending_payloads is not None else [
        {"tags": list(row.tags or [])} for row in pending
    ]
    duplicates = sum(1 for row in tag_rows if TAG_ALREADY_EXISTS in (row.get("tags") or []))
    auto_mail = sum(1 for row in tag_rows if TAG_AUTO_MAIL in (row.get("tags") or []))
    partner_req = sum(1 for row in tag_rows if TAG_PARTNER_REQUEST in (row.get("tags") or []))
    awaiting_partner = sum(
        1
        for row in tag_rows
        if TAG_UNVERIFIED in (row.get("tags") or [])
        and TAG_AUTO_MAIL in (row.get("tags") or [])
        and TAG_PARTNER_REQUEST not in (row.get("tags") or [])
        and TAG_VERIFIED not in (row.get("tags") or [])
    )

    users_in_ledger = len(directory_ledger_rows(db, limit=10_000, partner_id=partner_id))
    users_archived = len(archived_snapshot_rows(db, limit=10_000, partner_id=partner_id))
    users_added = len(roster_snapshot_rows(db, limit=10_000, partner_id=partner_id))
    users_removed = len(removed_snapshot_rows(db, limit=10_000, partner_id=partner_id))

    now = datetime.now(timezone.utc)
    is_custom_or_filtered = bool(start_date and end_date)

    if is_custom_or_filtered:
        filter_start = datetime.fromisoformat(start_date.replace("Z", "+00:00")).astimezone(timezone.utc)
        filter_end = datetime.fromisoformat(end_date.replace("Z", "+00:00")).astimezone(timezone.utc)
    else:
        # "All Time": find earliest received_at or handled_at in DB
        min_recv_q = db.query(func.min(models.ManagerRequest.received_at))
        min_hand_q = db.query(func.min(models.ManagerRequest.handled_at))
        if partner_id:
            min_recv_q = min_recv_q.filter(models.ManagerRequest.partner_id == partner_id)
            min_hand_q = min_hand_q.filter(models.ManagerRequest.partner_id == partner_id)
        min_r = min_recv_q.scalar()
        min_h = min_hand_q.scalar()
        all_mins = [ts for ts in (min_r, min_h) if ts is not None]
        if all_mins:
            earliest = min(all_mins)
            if earliest.tzinfo is None:
                earliest = earliest.replace(tzinfo=timezone.utc)
            filter_start = _day_start(earliest)
        else:
            filter_start = _day_start(now) - timedelta(days=29)
        filter_end = now

    received_query = db.query(func.count(models.ManagerRequest.id)).filter(
        models.ManagerRequest.received_at >= filter_start,
        models.ManagerRequest.received_at <= filter_end,
    )
    handled_query = db.query(func.count(models.ManagerRequest.id)).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.handled_at >= filter_start,
        models.ManagerRequest.handled_at <= filter_end,
    )
    received_rows_query = db.query(models.ManagerRequest.received_at).filter(
        models.ManagerRequest.received_at >= filter_start,
        models.ManagerRequest.received_at <= filter_end,
    )
    handled_rows_query = db.query(models.ManagerRequest.handled_at).filter(
        models.ManagerRequest.status == "handled",
        models.ManagerRequest.handled_at >= filter_start,
        models.ManagerRequest.handled_at <= filter_end,
    )

    if partner_id:
        received_query = received_query.filter(models.ManagerRequest.partner_id == partner_id)
        handled_query = handled_query.filter(models.ManagerRequest.partner_id == partner_id)
        received_rows_query = received_rows_query.filter(models.ManagerRequest.partner_id == partner_id)
        handled_rows_query = handled_rows_query.filter(models.ManagerRequest.partner_id == partner_id)

    received_in_period = received_query.scalar() or 0
    handled_in_period = handled_query.scalar() or 0
    received_rows = received_rows_query.all()
    handled_rows = handled_rows_query.all()

    # Collect UTC datetimes for received and handled
    received_timestamps: List[datetime] = []
    for (ts,) in received_rows:
        if ts is not None:
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            received_timestamps.append(ts.astimezone(timezone.utc))

    handled_timestamps: List[datetime] = []
    for (ts,) in handled_rows:
        if ts is not None:
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            handled_timestamps.append(ts.astimezone(timezone.utc))

    days_delta = max((filter_end.date() - filter_start.date()).days + 1, 1)

    weekly_trend = []
    granularity = "daily"

    if days_delta <= 35:
        granularity = "daily"
        received_by_day: dict[str, int] = {}
        handled_by_day: dict[str, int] = {}
        for ts in received_timestamps:
            k = _day_start(ts).date().isoformat()
            received_by_day[k] = received_by_day.get(k, 0) + 1
        for ts in handled_timestamps:
            k = _day_start(ts).date().isoformat()
            handled_by_day[k] = handled_by_day.get(k, 0) + 1

        for offset in range(days_delta):
            day = filter_start + timedelta(days=offset)
            key = day.date().isoformat()
            label = day.strftime("%a") if days_delta <= 7 else (day.strftime("%a %d") if days_delta <= 14 else day.strftime("%d %b"))
            weekly_trend.append(
                {
                    "date": key,
                    "label": label,
                    "received": received_by_day.get(key, 0),
                    "handled": handled_by_day.get(key, 0),
                }
            )

    elif 36 <= days_delta <= 120:
        granularity = "weekly"
        # Bucket by weeks (Monday through Sunday)
        cur_week_start = filter_start.date() - timedelta(days=filter_start.date().weekday())
        while cur_week_start <= filter_end.date():
            cur_week_end = cur_week_start + timedelta(days=6)
            key = cur_week_start.isoformat()
            label = cur_week_start.strftime("%d %b")

            # Count events within this week window and bounded by overall filter
            rec_count = sum(
                1 for ts in received_timestamps
                if cur_week_start <= ts.date() <= cur_week_end and filter_start.date() <= ts.date() <= filter_end.date()
            )
            hnd_count = sum(
                1 for ts in handled_timestamps
                if cur_week_start <= ts.date() <= cur_week_end and filter_start.date() <= ts.date() <= filter_end.date()
            )
            weekly_trend.append(
                {
                    "date": key,
                    "label": label,
                    "received": rec_count,
                    "handled": hnd_count,
                }
            )
            cur_week_start += timedelta(days=7)

    elif 121 <= days_delta <= 730:
        granularity = "monthly"
        cur_year, cur_month = filter_start.year, filter_start.month
        end_year, end_month = filter_end.year, filter_end.month
        is_multi_year = (filter_start.year != filter_end.year)

        while (cur_year < end_year) or (cur_year == end_year and cur_month <= end_month):
            m_date = date(cur_year, cur_month, 1)
            key = f"{cur_year:04d}-{cur_month:02d}"
            label = m_date.strftime("%b %y") if is_multi_year else m_date.strftime("%b")

            rec_count = sum(
                1 for ts in received_timestamps
                if ts.year == cur_year and ts.month == cur_month and filter_start.date() <= ts.date() <= filter_end.date()
            )
            hnd_count = sum(
                1 for ts in handled_timestamps
                if ts.year == cur_year and ts.month == cur_month and filter_start.date() <= ts.date() <= filter_end.date()
            )
            weekly_trend.append(
                {
                    "date": key,
                    "label": label,
                    "received": rec_count,
                    "handled": hnd_count,
                }
            )
            cur_month += 1
            if cur_month > 12:
                cur_month = 1
                cur_year += 1

    else:
        granularity = "yearly"
        for y in range(filter_start.year, filter_end.year + 1):
            key = str(y)
            label = str(y)
            rec_count = sum(
                1 for ts in received_timestamps
                if ts.year == y and filter_start.date() <= ts.date() <= filter_end.date()
            )
            hnd_count = sum(
                1 for ts in handled_timestamps
                if ts.year == y and filter_start.date() <= ts.date() <= filter_end.date()
            )
            weekly_trend.append(
                {
                    "date": key,
                    "label": label,
                    "received": rec_count,
                    "handled": hnd_count,
                }
            )

    return {
        "pendingAdd": pending_add,
        "pendingRemove": pending_remove,
        "awaitingPartner": awaiting_partner,
        "duplicates": duplicates,
        "autoMail": auto_mail,
        "partnerReq": partner_req,
        "usersAdded": users_added,
        "usersRemoved": users_removed,
        "usersInLedger": users_in_ledger,
        "usersArchived": users_archived,
        "handledThisWeek": int(handled_in_period),
        "receivedThisWeek": int(received_in_period),
        "handledInPeriod": int(handled_in_period),
        "receivedInPeriod": int(received_in_period),
        "granularity": granularity,
        "weeklyTrend": weekly_trend,
    }
