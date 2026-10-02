from datetime import datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.input_validation import (
    normalize_email,
    normalize_club_label,
    normalize_roster_person_location,
    normalize_roster_person_name,
    normalize_person_name,
    normalize_person_notes,
    normalize_text,
)


class BulkActionPayload(BaseModel):
    ids: List[str]


class SubmittedBy(BaseModel):
    firstName: Optional[str] = Field(default=None, max_length=100)
    lastName: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)
    club: Optional[str] = Field(default=None, max_length=200)

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def clean_submitter_name(cls, value, info):
        if value is None:
            return None
        return normalize_person_name(value, field_name=info.field_name)

    @field_validator("club", mode="before")
    @classmethod
    def clean_submitter_club(cls, value):
        if value is None:
            return None
        return normalize_club_label(value, field_name="club")

    @field_validator("email", mode="before")
    @classmethod
    def clean_submitter_email(cls, value):
        return normalize_email(value)


class PersonInfo(BaseModel):
    firstName: Optional[str] = Field(default=None, max_length=100)
    lastName: Optional[str] = Field(default=None, max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)
    # Stores "location" for PureGym and "client" for Health Fitness.
    # Partner-specific label is applied at the presentation layer.
    location: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=5000)
    directorFirst: Optional[str] = Field(default=None, max_length=100)
    directorLast: Optional[str] = Field(default=None, max_length=100)

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def clean_person_name(cls, value, info):
        if value is None:
            return None
        label = "User First Name" if info.field_name == "firstName" else "User Last Name"
        return normalize_roster_person_name(value, field_name=label)

    @field_validator("location", mode="before")
    @classmethod
    def clean_person_location(cls, value):
        if value is None:
            return None
        return normalize_roster_person_location(value, field_name="User Location")

    @field_validator("role", mode="before")
    @classmethod
    def clean_person_role(cls, value):
        if value is None:
            return None
        return normalize_text(value, max_length=200, allow_empty=True, field_name="role")

    @field_validator("notes", mode="before")
    @classmethod
    def clean_person_notes(cls, value):
        return normalize_person_notes(value, field_name="notes")

    @field_validator("email", mode="before")
    @classmethod
    def clean_person_email(cls, value):
        return normalize_email(value)


class PersonUpdateIn(BaseModel):
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    # For PureGym: location. For Health Fitness: client. For GLL: gym location (optional).
    # Stored in the same column; label applied at presentation layer.
    location: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=200)
    directorFirst: Optional[str] = Field(default=None, max_length=100)
    directorLast: Optional[str] = Field(default=None, max_length=100)

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def clean_person_name(cls, value, info):
        label = "User First Name" if info.field_name == "firstName" else "User Last Name"
        return normalize_roster_person_name(value, field_name=label)

    @field_validator("location", mode="before")
    @classmethod
    def clean_person_location(cls, value):
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return normalize_roster_person_location(value, field_name="User Location")

    @field_validator("role", mode="before")
    @classmethod
    def clean_person_role(cls, value):
        if value is None:
            return None
        return normalize_text(value, max_length=200, allow_empty=True, field_name="role")

    @field_validator("email", mode="before")
    @classmethod
    def clean_person_email(cls, value):
        return normalize_email(value)


class RequestIn(BaseModel):
    submittedBy: SubmittedBy
    person: PersonInfo
    action: Literal["Add", "Remove"]
    notes: Optional[str] = Field(default=None, max_length=5000)
    partnerId: Optional[str] = None

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value):
        return normalize_person_notes(value, field_name="notes")


def _validate_unique_person_emails(people: List[PersonInfo]) -> None:
    seen: set[str] = set()
    for person in people:
        email = (person.email or "").strip().lower()
        if not email:
            continue
        if email in seen:
            raise ValueError("Each request must use a different email address.")
        seen.add(email)


class ManualRequestIn(BaseModel):
    submittedBy: SubmittedBy
    people: List[PersonInfo] = Field(min_length=1, max_length=10)
    action: Literal["Add", "Remove"]
    notes: Optional[str] = Field(default=None, max_length=5000)
    partnerId: Optional[str] = None

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value):
        return normalize_person_notes(value, field_name="notes")

    @model_validator(mode="after")
    def ensure_unique_emails(self) -> "ManualRequestIn":
        _validate_unique_person_emails(self.people)
        return self


class ManagerBatchRequestIn(BaseModel):
    submittedBy: SubmittedBy
    people: List[PersonInfo] = Field(min_length=1, max_length=10)
    action: Literal["Add", "Remove"]
    notes: Optional[str] = Field(default=None, max_length=5000)
    partnerId: Optional[str] = None

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value):
        return normalize_person_notes(value, field_name="notes")

    @model_validator(mode="after")
    def ensure_unique_emails(self) -> "ManagerBatchRequestIn":
        _validate_unique_person_emails(self.people)
        return self


class PersonFieldMatchOut(BaseModel):
    field: str
    label: str
    status: Literal["same", "differs"]
    leftValue: str = ""
    rightValue: str = ""
    leftLabel: str = ""
    rightLabel: str = ""


class RequestMatchOut(BaseModel):
    kind: str
    allMatch: bool
    summary: str
    fields: List[PersonFieldMatchOut] = []


class DirectoryMatchOut(RequestMatchOut):
    directoryId: Optional[str] = None
    directoryName: Optional[str] = None


class AutomatedEmailOut(BaseModel):
    fromEmail: str = ""
    subject: str = ""
    receivedAt: Optional[datetime] = None
    inboxEmail: str = ""
    details: str = ""


class RequestOut(BaseModel):
    id: str
    displayId: int
    receivedAt: Optional[datetime] = None
    handledAt: Optional[datetime] = None
    submittedBy: SubmittedBy
    person: PersonInfo
    action: str
    notes: Optional[str] = None
    tags: List[str] = []
    createdBy: Optional[str] = None
    status: str
    handledBy: Optional[str] = None
    managerId: Optional[str] = None
    handledByAdminId: Optional[str] = None
    partnerId: Optional[str] = None
    intakeMatch: Optional[RequestMatchOut] = None
    directoryMatch: Optional[DirectoryMatchOut] = None
    automatedEmail: Optional[AutomatedEmailOut] = None
    adminPerson: Optional[PersonInfo] = None
    adminSubmittedBy: Optional[SubmittedBy] = None
    # Duplicate-group fields — populated for requests that belong to a group.
    duplicateGroupId: Optional[str] = None
    needsReview: bool = False
    groupMemberCount: int = 0
    # Aggregated classification counts for grouped representative requests.
    # { alreadyExists: bool, duplicateCount: int, potentialCount: int }
    groupClassificationSummary: Optional[Any] = None

    @model_validator(mode="before")
    @classmethod
    def transform_flat_to_nested(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "submittedBy" in data and "person" in data:
                return data
            return {
                "id": data.get("id"),
                "displayId": data.get("displayId", 0),
                "receivedAt": data.get("received_at"),
                "handledAt": data.get("handled_at"),
                "submittedBy": data.get("submittedBy") or {
                    "firstName": "",
                    "lastName": "",
                    "email": "",
                    "club": "",
                },
            "person": {
                    "firstName": data.get("person_first_name"),
                    "lastName": data.get("person_last_name"),
                    "email": data.get("person_email"),
                    "location": data.get("person_location"),
                },
                "action": data.get("action"),
                "notes": data.get("notes"),
                "tags": data.get("tags") or [],
                "createdBy": data.get("created_by"),
                "status": data.get("status"),
                "partnerId": data.get("partnerId") or data.get("partner_id"),
            }

        return {
            "id": getattr(data, "id", None),
            "displayId": getattr(data, "displayId", None) or 0,
            "receivedAt": getattr(data, "received_at", None),
            "handledAt": getattr(data, "handled_at", None),
            "submittedBy": {
                "firstName": "",
                "lastName": "",
                "email": "",
                "club": "",
            },
            "person": {
                "firstName": getattr(data, "person_first_name", None),
                "lastName": getattr(data, "person_last_name", None),
                "email": getattr(data, "person_email", None),
                "location": getattr(data, "person_location", None),
            },
            "action": getattr(data, "action", None),
            "notes": getattr(data, "notes", None),
            "tags": getattr(data, "tags", None) or [],
            "createdBy": None,
            "status": getattr(data, "status", None),
            "partnerId": getattr(data, "partner_id", None),
        }


class PersonHistoryEventOut(BaseModel):
    id: str
    type: str
    at: Optional[datetime] = None
    requestId: Optional[str] = None
    displayId: Optional[int] = None
    action: Optional[str] = None
    title: str
    detail: Optional[str] = None
    managerName: Optional[str] = None
    handledBy: Optional[str] = None
    outcome: Optional[str] = None
    fromEmail: Optional[str] = None
    subject: Optional[str] = None
    inboxEmail: Optional[str] = None


class PersonOut(BaseModel):
    id: str
    displayId: int
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    # label is "Location" for PureGym, "Client" for Health Fitness (presentation layer)
    location: Optional[str] = None
    role: Optional[str] = None
    directorFirst: Optional[str] = None
    directorLast: Optional[str] = None
    status: str
    action: Optional[str] = None
    dateAdded: Optional[datetime] = None
    addedBy: Optional[str] = None
    managerName: Optional[str] = None
    handledBy: Optional[str] = None
    managerEmail: Optional[str] = None
    club: Optional[str] = None
    sourceRequestId: Optional[str] = None
    sourceRequestNumber: Optional[int] = None
    requestReceivedAt: Optional[datetime] = None
    managerNotes: Optional[str] = None
    adminNotes: Optional[str] = None
    notes: Optional[str] = None  # alias for managerNotes (legacy)
    archivedAt: Optional[datetime] = None
    requestHistory: List[PersonHistoryEventOut] = []
    partnerId: Optional[str] = None
    partnerName: Optional[str] = None
    partnerSlug: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def transform_person(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "firstName" in data:
                mgr = data.get("managerNotes") or data.get("notes")
                adm = data.get("adminNotes")
                return {
                    **data,
                    "managerNotes": mgr,
                    "adminNotes": adm,
                    "notes": mgr,
                    "role": data.get("role"),
                    "directorFirst": data.get("directorFirst"),
                    "directorLast": data.get("directorLast"),
                }
            mgr_notes = data.get("notes")
            adm_notes = data.get("admin_notes")
            return {
                "id": data.get("id"),
                "displayId": data.get("displayId", 0),
                "firstName": data.get("first_name"),
                "lastName": data.get("last_name"),
                "email": data.get("email"),
                "location": data.get("location"),
                "role": data.get("role"),
                "directorFirst": data.get("directorFirst") or data.get("director_first_name"),
                "directorLast": data.get("directorLast") or data.get("director_last_name"),
                "status": data.get("status"),
                "dateAdded": data.get("date_added"),
                "addedBy": data.get("handled_by") or data.get("added_by"),
                "managerName": data.get("manager_name") or data.get("added_by"),
                "handledBy": data.get("handled_by"),
                "managerEmail": data.get("manager_email"),
                "club": data.get("club"),
                "sourceRequestId": data.get("source_request_id"),
                "sourceRequestNumber": data.get("sourceRequestNumber"),
                "requestReceivedAt": data.get("request_received_at") or data.get("requestReceivedAt"),
                "managerNotes": mgr_notes,
                "adminNotes": adm_notes,
                "notes": mgr_notes,
                "requestHistory": data.get("requestHistory") or data.get("request_history") or [],
                "partnerId": data.get("partner_id") or data.get("partnerId"),
                "partnerName": data.get("partnerName"),
                "partnerSlug": data.get("partnerSlug"),
            }

        mgr_notes = getattr(data, "notes", None)
        adm_notes = getattr(data, "admin_notes", None)
        return {
            "id": getattr(data, "id", None),
            "displayId": getattr(data, "displayId", None) or 0,
            "firstName": getattr(data, "first_name", None),
            "lastName": getattr(data, "last_name", None),
            "email": getattr(data, "email", None),
            "location": getattr(data, "location", None),
            "role": getattr(data, "role", None),
            "directorFirst": getattr(data, "directorFirst", None) or getattr(data, "director_first_name", None),
            "directorLast": getattr(data, "directorLast", None) or getattr(data, "director_last_name", None),
            "status": getattr(data, "status", None),
            "dateAdded": getattr(data, "date_added", None),
            "addedBy": getattr(data, "handled_by", None) or getattr(data, "added_by", None),
            "managerName": getattr(data, "manager_name", None) or getattr(data, "added_by", None),
            "handledBy": getattr(data, "handled_by", None),
            "managerEmail": getattr(data, "manager_email", None),
            "club": getattr(data, "club", None),
            "sourceRequestId": getattr(data, "source_request_id", None),
            "sourceRequestNumber": getattr(data, "sourceRequestNumber", None),
            "requestReceivedAt": getattr(data, "request_received_at", None),
            "managerNotes": mgr_notes,
            "adminNotes": adm_notes,
            "notes": mgr_notes,
            "partnerId": getattr(data, "partner_id", None) or getattr(data, "partnerId", None),
            "partnerName": getattr(data, "partnerName", None),
            "partnerSlug": getattr(data, "partnerSlug", None),
        }

class ActivityOut(BaseModel):
    id: str
    timestamp: datetime
    type: str
    description: Optional[str] = None
    linkedRequestId: Optional[str] = None

class KpiOut(BaseModel):
    pendingRequests: int
    usersInLedger: int


class DashboardTrendDayOut(BaseModel):
    date: str
    label: str
    received: int
    handled: int


class DashboardInsightsOut(BaseModel):
    pendingAdd: int = 0
    pendingRemove: int = 0
    awaitingPartner: int = 0
    duplicates: int = 0
    autoMail: int = 0
    partnerReq: int = 0
    usersAdded: int = 0
    usersRemoved: int = 0
    usersInLedger: int = 0
    usersArchived: int = 0
    handledThisWeek: int = 0
    receivedThisWeek: int = 0
    handledInPeriod: int = 0
    receivedInPeriod: int = 0
    granularity: str = "daily"
    weeklyTrend: List[DashboardTrendDayOut] = Field(default_factory=list)


class DashboardOut(BaseModel):
    kpis: KpiOut
    pendingRequests: List[RequestOut]
    activity: List[ActivityOut]
    insights: DashboardInsightsOut = Field(default_factory=DashboardInsightsOut)


class NewRequestsPageOut(BaseModel):
    requests: List[RequestOut]
    persons: List[PersonOut]


class MarkHandledIn(BaseModel):
    adminNote: Optional[str] = Field(default=None, max_length=5000)
    finalValues: Optional[PersonInfo] = None

    @field_validator("adminNote", mode="before")
    @classmethod
    def clean_admin_note(cls, value):
        return normalize_text(value, max_length=5000, allow_empty=True, field_name="adminNote")


class ManagerRequestListItemOut(BaseModel):
    id: str
    displayId: int
    receivedAt: Optional[datetime] = None
    handledAt: Optional[datetime] = None
    person: PersonInfo
    action: str
    status: str
    outcome: Optional[str] = None
    notes: Optional[str] = None
    isUnread: bool = False
    partnerId: Optional[str] = None


class ManagerRequestsPageOut(BaseModel):
    items: List[ManagerRequestListItemOut]
    total: int
    page: int
    limit: int
    unreadCount: int
    pendingCount: int = 0


class ManagerRequestsSummaryOut(BaseModel):
    total: int
    pendingCount: int = 0


class ManagerSubmissionJobOut(BaseModel):
    jobId: str
    status: Literal["pending", "processing", "done", "failed"]
    count: int = 0
    error: Optional[str] = None
    items: Optional[List[RequestOut]] = None


class DuplicateCheckIn(BaseModel):
    email: Optional[str] = Field(default=None, max_length=254)
    firstName: Optional[str] = Field(default=None, max_length=100)
    lastName: Optional[str] = Field(default=None, max_length=100)
    # For PureGym: location. For Health Fitness: client (same physical field).
    location: Optional[str] = Field(default=None, max_length=100)
    partnerId: Optional[str] = None

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value):
        return normalize_email(value)

    @field_validator("firstName", "lastName", mode="before")
    @classmethod
    def clean_names(cls, value, info):
        return normalize_person_name(value, field_name=info.field_name)

    @field_validator("location", mode="before")
    @classmethod
    def clean_location(cls, value):
        return normalize_text(value, max_length=100, allow_empty=True, field_name="location")


class DuplicateCheckOut(BaseModel):
    duplicate: bool
    id: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    dateAdded: Optional[datetime] = None
    location: Optional[str] = None
    partnerId: Optional[str] = None


class PersonSearchOut(BaseModel):
    id: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    location: Optional[str] = None
    status: str
    dateAdded: Optional[datetime] = None
    partnerId: Optional[str] = None


class PersonMatchCandidateOut(PersonSearchOut):
    matchReasons: List[str] = Field(default_factory=list)


class ManagerAllowedDomainOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    partnerId: Optional[str] = Field(default=None, validation_alias="partner_id")
    domain: str
    createdAt: datetime = Field(validation_alias="created_at")


class ManagerAllowedDomainCreateIn(BaseModel):
    domain: str
    partnerId: Optional[str] = None


class ManagerAllowedDomainsPublicOut(BaseModel):
    domains: List[str] = Field(default_factory=list)


class AutomatedRosterSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    partnerId: Optional[str] = Field(default=None, validation_alias="partner_id")
    kind: str
    pattern: str
    createdAt: datetime = Field(validation_alias="created_at")


class AutomatedRosterSourceCreateIn(BaseModel):
    pattern: str
    partnerId: Optional[str] = None


class PartnerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    name: str
    createdAt: datetime = Field(validation_alias="created_at")
    updatedAt: datetime = Field(validation_alias="updated_at")


class PartnerCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    allowedDomains: List[str] = Field(default_factory=list, max_length=20)
    automatedSources: List[str] = Field(default_factory=list, max_length=50)


class PartnerUpdateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


# ── Duplicate group schemas ───────────────────────────────────────────────────


class DuplicateGroupMemberOut(BaseModel):
    """Lightweight member row inside a group detail response."""

    id: str
    displayId: int
    receivedAt: Optional[datetime] = None
    person: PersonInfo
    action: str
    status: str
    isRepresentative: bool = False
    submittedBy: Optional[SubmittedBy] = None
    notes: Optional[str] = None
    tags: List[str] = []
    createdBy: Optional[str] = None
    directorFirst: Optional[str] = None
    directorLast: Optional[str] = None


class DuplicateGroupDetailOut(BaseModel):
    """Full group detail with member list (used by GET /api/duplicate-groups/{id})."""

    id: str
    partnerId: Optional[str] = None
    classification: str
    status: str
    createdAt: Optional[datetime] = None
    resolvedAt: Optional[datetime] = None
    directoryPersonId: Optional[str] = None
    directoryPerson: Optional[Any] = None
    representativeRequestId: Optional[str] = None
    members: List[DuplicateGroupMemberOut] = []
    # Aggregated classification counts: { alreadyExists, duplicateCount, potentialCount }
    classificationSummary: Optional[Any] = None


class DuplicateGroupSummaryOut(BaseModel):
    """Lightweight group row for the group list endpoint."""

    id: str
    partnerId: Optional[str] = None
    classification: str
    status: str
    createdAt: Optional[datetime] = None
    memberCount: int = 0
    representativeRequestId: Optional[str] = None
    directoryPersonId: Optional[str] = None
    representativePerson: Optional[PersonInfo] = None


class UnlinkDuplicateIn(BaseModel):
    """Payload for POST /api/duplicate-groups/{id}/unlink."""

    requestId1: str
    requestId2: str
    strictSingle: bool = False


class DismissImpactOut(BaseModel):
    """Preview for deleting a request that may sit in a duplicate group.

    Confirmed-match siblings are deleted with the target. Potential-only siblings stay.
    """

    requestId: str
    confirmedSiblingIds: List[str] = []
    potentialSiblingIds: List[str] = []
    confirmedSiblingCount: int = 0
    potentialSiblingCount: int = 0


# ── Resolution action schemas (Task 2) ───────────────────────────────────────


class ResolveAndAddIn(BaseModel):
    """POST /api/duplicate-groups/{id}/resolve-add (Case A — no Directory match yet).

    finalValues must contain all four identity fields; the backend validates them
    before creating the Directory record. The frontend pre-fills from the latest
    request but the admin may have edited any field — never assume "latest wins".

    sourceRequestId is the current request the admin clicked Merge on — its manager
    attribution is copied onto the Directory record.
    """

    finalValues: PersonInfo
    adminNote: Optional[str] = Field(default=None, max_length=5000)
    sourceRequestId: Optional[str] = None


class ResolveAndUpdateIn(BaseModel):
    """POST /api/duplicate-groups/{id}/resolve-update (Case B — Directory person exists).

    directoryPersonId must match group.directory_person_id. The endpoint rejects the
    request if the group has no linked Directory person rather than silently creating one.

    sourceRequestId is the current request the admin clicked Merge on — its manager
    attribution is copied onto the Directory record.
    """

    directoryPersonId: str
    finalValues: PersonInfo
    adminNote: Optional[str] = Field(default=None, max_length=5000)
    sourceRequestId: Optional[str] = None


class ResolveAndUpdatePreviewIn(BaseModel):
    """POST /api/duplicate-groups/{id}/resolve-update/preview (dry run — no writes).

    Returns current Directory values alongside the proposed final values so the frontend
    can render a side-by-side confirmation dialog.
    """

    directoryPersonId: str
    finalValues: PersonInfo


class ResolveKeepExistingIn(BaseModel):
    """POST /api/duplicate-groups/{id}/resolve-keep-existing (Case C — discard new data).

    No finalValues required: the Directory record is intentionally left unchanged.
    """

    adminNote: Optional[str] = Field(default=None, max_length=5000)


class ResolveDeleteIn(BaseModel):
    """POST /api/duplicate-groups/{id}/resolve-delete-directory (Case D).
    
    directoryPersonId must match group.directory_person_id.
    """

    directoryPersonId: str
    finalValues: PersonInfo
    adminNote: Optional[str] = Field(default=None, max_length=5000)
    sourceRequestId: Optional[str] = None


class ResolveMarkRemovedIn(BaseModel):
    """POST /api/duplicate-groups/{id}/resolve-mark-removed (Case E)."""

    finalValues: PersonInfo
    adminNote: Optional[str] = Field(default=None, max_length=5000)
    sourceRequestId: Optional[str] = None


class FieldDiffOut(BaseModel):
    """One field in a resolve-update preview, with before/after values."""

    field: str
    label: str
    currentValue: str
    proposedValue: str
    changed: bool


class ResolvePreviewOut(BaseModel):
    """Response from resolve-update/preview — side-by-side before/after values."""

    directoryPersonId: str
    currentValues: PersonInfo
    proposedValues: PersonInfo
    fields: List[FieldDiffOut] = Field(default_factory=list)
    anyChanged: bool = False


class ResolveGroupResultOut(BaseModel):
    """Generic response returned by all three resolve endpoints."""

    status: str  # "resolved"
    groupId: str
    resolutionType: str  # "add" | "update" | "keep_existing"
    directoryPersonId: Optional[str] = None  # new or existing dir row id
    resolvedRequestCount: int = 0


class PartnerCustomFormOut(BaseModel):
    partner_id: str
    logo_url: Optional[str] = None
    logo_data_url: Optional[str] = None
    fields: list = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class PartnerCustomFormIn(BaseModel):
    logo_url: Optional[str] = None
    logo_data_url: Optional[str] = None
    fields: list = Field(default_factory=list)


class PartnerLogoUploadIn(BaseModel):
    logo_data_url: str


class PartnerLogoUploadOut(BaseModel):
    partner_id: str
    logo_url: str
