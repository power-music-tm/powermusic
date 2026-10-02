"""Unit tests for automated roster email intake (fully deterministic pipeline).

No AI / LLM is involved, so no patching is required.
"""

from app.automated_person_intake import (
    PUREGYM_LEAVER_SENDER,
    classify_puregym_roster_email,
    is_puregym_roster_notification,
    make_source,
    parse_puregym_roster_email,
)

ADD_BODY = """\
Name: Nik Hall
Email: nik1285@hotmail.co.uk
Club: Alfreton
"""

REMOVE_BODY = """\
Name: Jess Randle
Email: wellnesswithjess@gmail.com
Club: Witney
Leave date: 2024-08-14
"""

DEFAULT_SOURCES = [
    make_source(kind="domain", pattern="puregym.com"),
    make_source(kind="email", pattern=PUREGYM_LEAVER_SENDER),
    make_source(kind="email", pattern="rubabzahra248@gmail.com"),
]


class TestAutomatedPersonIntake:
    # ── Add / Joinee subjects ──────────────────────────────────────────────

    def test_classifies_new_puregym_user_as_add(self):
        assert classify_puregym_roster_email(
            "notifications@puregym.com",
            "New PureGym user",
            ADD_BODY,
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        ) == "Add"

    def test_classifies_puregym_joinee_as_add(self):
        assert classify_puregym_roster_email(
            "notifications@puregym.com",
            "PureGym Joinee",
            ADD_BODY,
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        ) == "Add"

    def test_classifies_puregym_new_member_as_add(self):
        assert classify_puregym_roster_email(
            "notifications@puregym.com",
            "PureGym New Member",
            ADD_BODY,
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        ) == "Add"

    # ── Remove / Leaver subjects ───────────────────────────────────────────

    def test_classifies_puregym_leaver_as_remove(self):
        assert classify_puregym_roster_email(
            PUREGYM_LEAVER_SENDER,
            "PureGym Leaver",
            REMOVE_BODY,
            sources=DEFAULT_SOURCES,
        ) == "Remove"

    # ── Field extraction ───────────────────────────────────────────────────

    def test_parses_add_request_fields(self):
        parsed = parse_puregym_roster_email(
            "New PureGym user",
            ADD_BODY,
            sender_email="notifications@puregym.com",
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        )
        assert parsed is not None
        person, action = parsed
        assert action == "Add"
        assert person.firstName == "Nik"
        assert person.lastName == "Hall"
        assert person.email == "nik1285@hotmail.co.uk"
        assert person.location == "Alfreton"

    def test_parses_joinee_request_fields(self):
        parsed = parse_puregym_roster_email(
            "PureGym Joinee",
            ADD_BODY,
            sender_email="notifications@puregym.com",
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        )
        assert parsed is not None
        person, action = parsed
        assert action == "Add"
        assert person.firstName == "Nik"
        assert person.lastName == "Hall"
        assert person.email == "nik1285@hotmail.co.uk"
        assert person.location == "Alfreton"

    def test_parses_remove_request_fields(self):
        parsed = parse_puregym_roster_email(
            "PureGym Leaver",
            REMOVE_BODY,
            sender_email=PUREGYM_LEAVER_SENDER,
            sources=DEFAULT_SOURCES,
        )
        assert parsed is not None
        person, action = parsed
        assert action == "Remove"
        assert person.firstName == "Jess"
        assert person.lastName == "Randle"
        assert person.email == "wellnesswithjess@gmail.com"
        assert person.location == "Witney"

    # ── Rejection / allowlist ──────────────────────────────────────────────

    def test_ignores_unrelated_puregym_mail(self):
        assert not is_puregym_roster_notification(
            "ops@puregym.com",
            "Partnership review Q3",
            "We would like to schedule a Q3 partnership review.",
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        )

    def test_ignores_wrong_sender_for_leaver(self):
        assert classify_puregym_roster_email(
            "noreply@example.com",
            "PureGym Leaver",
            REMOVE_BODY,
            sources=DEFAULT_SOURCES,
        ) is None

    def test_subject_normalization(self):
        assert classify_puregym_roster_email(
            "notifications@puregym.com",
            "  new   PureGym   user  ",
            ADD_BODY,
            from_name="PureGym",
            sources=DEFAULT_SOURCES,
        ) == "Add"

    def test_allowlisted_gmail_add(self):
        assert classify_puregym_roster_email(
            "rubabzahra248@gmail.com",
            "New user",
            ADD_BODY,
            sources=DEFAULT_SOURCES,
        ) == "Add"

    def test_allowlisted_gmail_remove(self):
        assert classify_puregym_roster_email(
            "rubabzahra248@gmail.com",
            "Remove user",
            REMOVE_BODY,
            sources=DEFAULT_SOURCES,
        ) == "Remove"

    def test_rejects_non_allowlisted_sender(self):
        assert classify_puregym_roster_email(
            "someone@random.com",
            "New PureGym user",
            ADD_BODY,
            sources=DEFAULT_SOURCES,
        ) is None

    def test_rejects_allowlisted_sender_without_roster_signal(self):
        assert classify_puregym_roster_email(
            "rubabzahra248@gmail.com",
            "Hello",
            "Rubab Zahra\nrubab@example.com\nRawalpindi\n",
            sources=DEFAULT_SOURCES,
        ) is None

    # ── Case-insensitivity of subjects ────────────────────────────────────

    def test_joinee_subject_case_insensitive(self):
        assert classify_puregym_roster_email(
            "notifications@puregym.com",
            "puregym joinee",
            ADD_BODY,
            sources=DEFAULT_SOURCES,
        ) == "Add"

    def test_new_member_subject_case_insensitive(self):
        assert classify_puregym_roster_email(
            "notifications@puregym.com",
            "PUREGYM NEW MEMBER",
            ADD_BODY,
            sources=DEFAULT_SOURCES,
        ) == "Add"

    def test_leaver_subject_case_insensitive(self):
        assert classify_puregym_roster_email(
            PUREGYM_LEAVER_SENDER,
            "puregym leaver",
            REMOVE_BODY,
            sources=DEFAULT_SOURCES,
        ) == "Remove"
