"""
Dashboard router — overview stats, message history, patient endpoints.
Mirrors Node.js: GET /api/dashboard/state, /history, /patients
"""

from fastapi import APIRouter, Query
from typing import Optional, List
from datetime import date
import httpx

from app.database import database, outbound_messages, patient_profiles, engagement_log, recall_schedule, follow_up_queue, callback_queue, broadcast_campaigns
from app import models
import sqlalchemy

OUTBOUND_URL = "http://localhost:3000"

router = APIRouter()


# ── Overview state ─────────────────────────────────────────────────────────────

@router.get("/state", response_model=models.DashboardState)
async def get_state():
    """Single endpoint the dashboard calls on load — all overview stats."""

    # Engagement stats by trigger type
    eng_query = sqlalchemy.text(
        "SELECT trigger_type, COUNT(*) AS n FROM engagement_log GROUP BY trigger_type ORDER BY n DESC"
    )
    eng_rows = await database.fetch_all(eng_query)

    # Dialer stats (last 7 days)
    dialer_query = sqlalchemy.text("""
        SELECT
            COUNT(*) FILTER (WHERE called_at >= NOW() - INTERVAL '7 days') AS total_calls,
            COUNT(*) FILTER (WHERE status='answered' AND called_at >= NOW() - INTERVAL '7 days') AS answered_calls,
            COUNT(*) FILTER (WHERE status='missed'   AND called_at >= NOW() - INTERVAL '7 days') AS missed_calls,
            COALESCE(ROUND(AVG(duration_sec) FILTER (WHERE status='answered')), 0) AS avg_duration_sec
        FROM dialer_calls
    """)
    dialer_row = await database.fetch_one(dialer_query)

    pending_callbacks = await database.fetch_val(
        "SELECT COUNT(*) FROM callback_queue WHERE status='pending'"
    )
    due_recalls = await database.fetch_val(
        "SELECT COUNT(*) FROM recall_schedule WHERE status='pending' AND recall_at <= NOW()"
    )
    pending_followups = await database.fetch_val(
        "SELECT COUNT(*) FROM follow_up_queue WHERE status='pending'"
    )
    messages_sent = await database.fetch_val(
        "SELECT COUNT(*) FROM outbound_messages"
    )
    patients_reached = await database.fetch_val(
        "SELECT COUNT(DISTINCT phone) FROM outbound_messages"
    )
    broadcasts_sent = await database.fetch_val(
        "SELECT COUNT(*) FROM broadcast_campaigns"
    )

    # Check outbound service health (WhatsApp sending)
    outbound_health = None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OUTBOUND_URL}/health")
            outbound_health = r.json()
    except Exception:
        outbound_health = {"status": "offline", "whatsapp": {"healthy": False}}

    # Delivery stats (last 7 days)
    delivery_rows = await database.fetch_all(sqlalchemy.text("""
        SELECT status, COUNT(*) as count
        FROM message_delivery
        WHERE updated_at >= NOW() - INTERVAL '7 days'
        GROUP BY status
    """))
    delivery_stats = {r["status"]: r["count"] for r in delivery_rows}

    # Consent count
    consent_count = await database.fetch_val(
        "SELECT COUNT(*) FROM consent_log"
    ) or 0

    return models.DashboardState(
        dialer_stats=models.DialerStats(
            total_calls=dialer_row["total_calls"] or 0,
            answered_calls=dialer_row["answered_calls"] or 0,
            missed_calls=dialer_row["missed_calls"] or 0,
            avg_duration_sec=int(dialer_row["avg_duration_sec"] or 0),
            pending_callbacks=pending_callbacks or 0,
        ),
        engagement_stats=[
            models.EngagementStat(trigger_type=r["trigger_type"], n=r["n"])
            for r in eng_rows
        ],
        pending_callbacks=pending_callbacks or 0,
        due_recalls=due_recalls or 0,
        pending_followups=pending_followups or 0,
        messages_sent=messages_sent or 0,
        patients_reached=patients_reached or 0,
        broadcasts_sent=broadcasts_sent or 0,
        outbound_healthy=outbound_health.get("status") == "ok",
        whatsapp_healthy=outbound_health.get("whatsapp", {}).get("healthy", False),
        whatsapp_error=outbound_health.get("whatsapp", {}).get("lastError"),
        delivery_stats=delivery_stats,
        consented_patients=consent_count,
    )


# ── Message history ────────────────────────────────────────────────────────────

@router.get("/history", response_model=List[models.OutboundMessageOut])
async def get_history(
    phone: Optional[str] = Query(None),
    date_filter: Optional[date] = Query(None, alias="date"),
    limit: int = Query(200, le=500),
):
    query = "SELECT * FROM outbound_messages WHERE 1=1"
    params: dict = {}

    if phone:
        query += " AND phone = :phone"
        params["phone"] = phone
    if date_filter:
        query += " AND DATE(sent_at) = :date_filter"
        params["date_filter"] = date_filter

    query += " ORDER BY sent_at DESC LIMIT :limit"
    params["limit"] = limit

    rows = await database.fetch_all(sqlalchemy.text(query), params)
    return [dict(r) for r in rows]


@router.get("/history/dates", response_model=List[models.MessageHistoryDateGroup])
async def get_history_by_date():
    """Returns message counts grouped by date — for the history date picker."""
    query = sqlalchemy.text("""
        SELECT DATE(sent_at) AS date,
               COUNT(*) AS total,
               COUNT(DISTINCT phone) AS patients
        FROM outbound_messages
        GROUP BY DATE(sent_at)
        ORDER BY date DESC
        LIMIT 60
    """)
    rows = await database.fetch_all(query)
    return [dict(r) for r in rows]


@router.get("/history/patient/{phone}", response_model=List[models.OutboundMessageOut])
async def get_patient_history(phone: str):
    """All messages sent to a single patient — for the thread view."""
    rows = await database.fetch_all(
        sqlalchemy.text(
            "SELECT * FROM outbound_messages WHERE phone=:phone ORDER BY sent_at ASC LIMIT 100"
        ),
        {"phone": phone},
    )
    return [dict(r) for r in rows]


# ── Patients ───────────────────────────────────────────────────────────────────

@router.get("/patients", response_model=List[models.PatientOut])
async def get_patients(
    specialty: Optional[str] = Query(None),
    doctor: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    query = "SELECT * FROM patient_profiles WHERE 1=1"
    params: dict = {}

    if specialty:
        query += " AND specialty = :specialty"
        params["specialty"] = specialty
    if doctor:
        query += " AND doctor = :doctor"
        params["doctor"] = doctor
    if search:
        query += " AND (name ILIKE :search OR phone ILIKE :search)"
        params["search"] = f"%{search}%"

    query += " ORDER BY last_contact DESC NULLS LAST LIMIT 500"
    rows = await database.fetch_all(sqlalchemy.text(query), params)
    return [dict(r) for r in rows]


@router.post("/patients", response_model=models.SuccessResponse)
async def upsert_patient(body: models.PatientUpsert):
    await database.execute(
        sqlalchemy.text("""
            INSERT INTO patient_profiles(phone, name, dob, specialty, doctor, branch, last_contact)
            VALUES(:phone, :name, :dob, :specialty, :doctor, :branch, NOW())
            ON CONFLICT(phone) DO UPDATE SET
                name        = COALESCE(EXCLUDED.name, patient_profiles.name),
                dob         = COALESCE(EXCLUDED.dob,  patient_profiles.dob),
                specialty   = COALESCE(EXCLUDED.specialty, patient_profiles.specialty),
                doctor      = COALESCE(EXCLUDED.doctor, patient_profiles.doctor),
                last_contact = NOW()
        """),
        {
            "phone": body.phone, "name": body.name, "dob": body.dob,
            "specialty": body.specialty, "doctor": body.doctor,
            "branch": body.branch or "Ambattur",
        },
    )
    return {"success": True}


@router.get("/patients/birthdays", response_model=List[models.PatientOut])
async def get_birthdays_today():
    """Patients whose birthday is today — used by the personalised tab."""
    rows = await database.fetch_all(
        sqlalchemy.text("""
            SELECT * FROM patient_profiles
            WHERE dob IS NOT NULL
              AND TO_CHAR(dob, 'MM-DD') = TO_CHAR(NOW(), 'MM-DD')
              AND opt_in = TRUE
            ORDER BY name
        """)
    )
    return [dict(r) for r in rows]
