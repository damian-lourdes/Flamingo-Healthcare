"""
Pydantic models — request bodies and response schemas.
"""

from __future__ import annotations
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel


# ── Shared ─────────────────────────────────────────────────────────────────────

class SuccessResponse(BaseModel):
    success: bool = True
    message: Optional[str] = None


# ── Patients ───────────────────────────────────────────────────────────────────

class PatientUpsert(BaseModel):
    phone: str
    name: Optional[str] = None
    dob: Optional[date] = None
    specialty: Optional[str] = None
    doctor: Optional[str] = None
    branch: Optional[str] = "Ambattur"


class PatientOut(BaseModel):
    id: int
    phone: str
    name: Optional[str]
    dob: Optional[date]
    specialty: Optional[str]
    doctor: Optional[str]
    branch: Optional[str]
    opt_in: Optional[bool]
    last_contact: Optional[datetime]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Outbound messages ──────────────────────────────────────────────────────────

class OutboundMessageOut(BaseModel):
    id: int
    phone: str
    patient_name: Optional[str]
    trigger_type: str
    message: str
    sent_at: Optional[datetime]

    class Config:
        from_attributes = True


class MessageHistoryDateGroup(BaseModel):
    date: date
    total: int
    patients: int


# ── Dashboard state ────────────────────────────────────────────────────────────

class EngagementStat(BaseModel):
    trigger_type: str
    n: int


class DialerStats(BaseModel):
    total_calls: int
    answered_calls: int
    missed_calls: int
    avg_duration_sec: int
    pending_callbacks: int


class DashboardState(BaseModel):
    dialer_stats: DialerStats
    engagement_stats: List[EngagementStat]
    pending_callbacks: int
    due_recalls: int
    pending_followups: int
    messages_sent: int
    patients_reached: int
    broadcasts_sent: int


# ── Dialer ─────────────────────────────────────────────────────────────────────

class CallLogIn(BaseModel):
    phone: str
    caller_name: Optional[str] = None
    duration_sec: Optional[int] = None
    status: str  # answered | missed | abandoned
    agent: Optional[str] = None
    notes: Optional[str] = None


class CallOut(BaseModel):
    id: int
    phone: str
    caller_name: Optional[str]
    duration_sec: Optional[int]
    status: str
    agent: Optional[str]
    notes: Optional[str]
    called_at: Optional[datetime]

    class Config:
        from_attributes = True


class CallbackOut(BaseModel):
    id: int
    phone: str
    caller_name: Optional[str]
    missed_at: Optional[datetime]
    status: str

    class Config:
        from_attributes = True


class CallbackDoneIn(BaseModel):
    status: str = "called_back"  # called_back | ignored


# ── Recalls ────────────────────────────────────────────────────────────────────

class RecallOut(BaseModel):
    id: int
    phone: str
    name: Optional[str]
    specialty: Optional[str]
    recall_at: Optional[datetime]
    recall_days: Optional[int]
    status: str

    class Config:
        from_attributes = True


class FollowUpOut(BaseModel):
    id: int
    phone: str
    name: Optional[str]
    doctor: Optional[str]
    specialty: Optional[str]
    original_dt: Optional[str]
    status: str
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Broadcast ──────────────────────────────────────────────────────────────────

class BroadcastRecipient(BaseModel):
    phone: str
    name: Optional[str] = None


class HealthTipIn(BaseModel):
    campaign_name: str
    message: str
    recipients: List[BroadcastRecipient]


class OfferIn(BaseModel):
    offer_title: str
    offer_details: str
    valid_till: Optional[date] = None
    recipients: List[BroadcastRecipient]


class PersonalisedIn(BaseModel):
    phone: str
    name: str
    message: str


class BroadcastListIn(BaseModel):
    name: str
    description: Optional[str] = None
    phones: List[str] = []


class BroadcastListOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    phone_count: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class BroadcastCampaignOut(BaseModel):
    id: int
    name: Optional[str]
    message: Optional[str]
    recipient_count: Optional[int]
    sent_count: Optional[int]
    failed_count: Optional[int]
    sent_at: Optional[datetime]

    class Config:
        from_attributes = True


class BroadcastSendResult(BaseModel):
    success: bool
    sent: int
    failed: int
    total: int


# ── Engagement triggers ────────────────────────────────────────────────────────

class PostConsultationIn(BaseModel):
    phone: str
    name: str
    doctor: str
    specialty: str
    follow_up_date: Optional[str] = None


class LabReportIn(BaseModel):
    phone: str
    name: str
    test_name: str
    doctor: str
    lab_visit_id: Optional[str] = None


class DischargeIn(BaseModel):
    phone: str
    patient_name: str
    doctor: str
    specialty: str
    admission_id: Optional[str] = None


# ── Scheduler ──────────────────────────────────────────────────────────────────

class SchedulerRunIn(BaseModel):
    job: str = "all"  # all | birthdays | festivals | recalls


class SchedulerRunOut(BaseModel):
    success: bool
    message: str
