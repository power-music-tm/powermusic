"""Seed Pilot 2 reference data: template library for connected inboxes.

Run from backend/:  python -m app.pilot2.seed
Idempotent — existing rows (matched by template name per inbox) are kept.
Inboxes are added via the Gmail accounts page (OAuth), not seeded here.
"""

from datetime import datetime, timezone

from app import models
from app.database import SessionLocal, engine
from app.pilot2 import pipeline

INBOXES: list[tuple[str, str]] = []

SIGNOFF = ""  # Reply signature is appended by the composer per inbox title.

TEMPLATES = [
    {
        "name": "Membership Enquiry", "category": "Membership", "intent": "Enquiry",
        "subject": "Re: Your membership enquiry",
        "body": "Hi {{first_name}},\n\nI'd be happy to help with your enquiry about joining {{club_name}}.\n\n"
                "We'd be delighted to help with your membership enquiry. Our current membership options "
                "are available on our website, and I'd be happy to walk you through the options that best "
                f"suit your needs.\n\nPlease let me know if you have any questions.\n\n{SIGNOFF}",
    },
    {
        "name": "Cancellation Acknowledgement", "category": "Membership", "intent": "Cancellation",
        "subject": "Re: Your cancellation request",
        "body": "Hi {{first_name}},\n\nWe've received your cancellation request for your {{membership_type}} "
                "membership at {{club_name}} and will process it within 5 business days.\n\n"
                f"If you change your mind, please don't hesitate to get in touch.\n\n{SIGNOFF}",
    },
    {
        "name": "Renewal Reminder", "category": "Membership", "intent": "Renewal",
        "subject": "Re: Your renewal",
        "body": "Hi {{first_name}},\n\nYour {{membership_type}} membership at {{club_name}} is due for renewal.\n\n"
                f"We'd love to keep you with us. Please find your renewal options below.\n\n{SIGNOFF}",
    },
    {
        "name": "Payment Failed Notice", "category": "Payments", "intent": "Finance",
        "subject": "Action required: Payment failed",
        "body": "Hi {{first_name}},\n\nUnfortunately your recent payment for your {{membership_type}} membership "
                "at {{club_name}} was unsuccessful.\n\nPlease update your payment details at your earliest "
                f"convenience to avoid any interruption to your membership.\n\n{SIGNOFF}",
    },
    {
        "name": "Invoice Query Response", "category": "Payments", "intent": "Finance",
        "subject": "Re: Invoice query",
        "body": "Hi {{first_name}},\n\nRegarding your invoice query for your {{membership_type}} "
                f"account at {{club_name}}.\n\nPlease find the requested information below.\n\n{SIGNOFF}",
    },
    {
        "name": "Event Invitation", "category": "Events", "intent": "Events",
        "subject": "You're invited: {{club_name}} event",
        "body": "Hi {{first_name}},\n\nWe'd like to invite you to an upcoming event at {{club_name}}.\n\n"
                f"Details will be shared shortly. We hope to see you there!\n\n{SIGNOFF}",
    },
    {
        "name": "Partnership Enquiry Response", "category": "Partnerships", "intent": "Partnership",
        "subject": "Re: Partnership opportunity",
        "body": "Hi {{first_name}},\n\nWe appreciate your interest in partnering with Power Music.\n\n"
                "We review every partnership enquiry carefully and a member of our team will be in touch "
                f"to arrange a conversation.\n\n{SIGNOFF}",
    },
    {
        "name": "General Enquiry Response", "category": "General Enquiries", "intent": "Enquiry",
        "subject": "Re: Your enquiry",
        "body": "Hi {{first_name}},\n\nWe've received your message and "
                f"will get back to you within 2 business days.\n\n{SIGNOFF}",
    },
]


def seed():
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    try:
        for email, title in INBOXES:
            exists = (
                db.query(models.EmailAccount)
                .filter(models.EmailAccount.email == email)
                .first()
            )
            if not exists:
                db.add(models.EmailAccount(
                    id=pipeline.next_id(db, models.EmailAccount, "inbox"),
                    email=email,
                    title=title,
                    status="Disconnected",
                ))
                db.commit()

        # Remove legacy placeholder inboxes that were never connected via OAuth.
        placeholders = (
            db.query(models.EmailAccount)
            .filter(
                models.EmailAccount.connected_at.is_(None),
                models.EmailAccount.status != "Connected",
            )
            .all()
        )
        for account in placeholders:
            db.query(models.EmailTemplate).filter(
                models.EmailTemplate.account_email == account.email
            ).delete(synchronize_session=False)
            db.query(models.Email).filter(
                models.Email.account_email == account.email
            ).delete(synchronize_session=False)
            db.delete(account)
        if placeholders:
            db.commit()

        accounts = (
            db.query(models.EmailAccount)
            .filter(models.EmailAccount.status == "Connected")
            .order_by(models.EmailAccount.id)
            .all()
        )
        template_count = 0
        for account in accounts:
            for spec in TEMPLATES:
                exists = (
                    db.query(models.EmailTemplate)
                    .filter(
                        models.EmailTemplate.name == spec["name"],
                        models.EmailTemplate.account_email == account.email,
                    )
                    .first()
                )
                if not exists:
                    db.add(models.EmailTemplate(
                        id=pipeline.next_id(db, models.EmailTemplate, "tmpl"),
                        account_email=account.email,
                        name=spec["name"],
                        category=spec["category"],
                        intent=spec["intent"],
                        status="Active",
                        subject=spec["subject"],
                        body=spec["body"],
                        times_used=0,
                        created_at=now,
                        last_updated=now,
                    ))
                    template_count += 1
                    db.commit()
        print(f"Seeded templates for {len(accounts)} connected inbox(es); added {template_count} new template(s).")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
