"""
Dialer router — call logging, callback queue, dialer stats.
Mirrors Node.js: /api/dialer/*
PBX webhooks POST to /api/dialer/call (Exotel / Knowlarity / MyOperator compatible).
"""

from fastapi import APIRouter, BackgroundTasks
from typing import List

from app.database import database
from app import models
import sqlalchemy

router = APIRouter()


# ── Stats ──────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=models.DialerStats)
async def get_stats():
    row = await database.fetch_one(sqlalchemy.text("""
        SELECT
            COUNT(*) FILTER (WHERE called_at >= NOW() - INTERVAL '7 days') AS total_calls,
            COUNT(*) FILTER (WHERE status='answered' AND called_at >= NOW() - INTERVAL '7 days') AS answered_calls,
            COUNT(*) FILTER (WHERE status='missed'   AND called_at >= NOW() - INTERVAL '7 days') AS missed_calls,
            COALESCE(ROUND(AVG(duration_sec) FILTER (WHERE status='answered')), 0) AS avg_duration_sec
        FROM dialer_calls
    """))
    pending = await database.fetch_val(
        "SELECT COUNT(*) FROM callback_queue WHERE status='pending'"
    )
    return models.DialerStats(
        total_calls=row["total_calls"] or 0,
        answered_calls=row["answered_calls"] or 0,
        missed_calls=row["missed_calls"] or 0,
        avg_duration_sec=int(row["avg_duration_sec"] or 0),
        pending_callbacks=pending or 0,
    )


# ── Call log ───────────────────────────────────────────────────────────────────

@router.get("/calls", response_model=List[models.CallOut])
async def get_calls(limit: int = 200):
    rows = await database.fetch_all(
        sqlalchemy.text("SELECT * FROM dialer_calls ORDER BY called_at DESC LIMIT :limit"),
        {"limit": min(limit, 500)},
    )
    return [dict(r) for r in rows]


# ── Inbound call webhook (PBX → FastAPI) ──────────────────────────────────────

@router.post("/call", status_code=200)
async def receive_call(body: models.CallLogIn, background_tasks: BackgroundTasks):
    """
    PBX posts here on every call event.
    Responds immediately (PBX has short timeout), processes async.
    Compatible with Exotel, Knowlarity, MyOperator, Ozonetel payloads
    — normalise your webhook fields in the PBX config to match this schema.
    """
    background_tasks.add_task(_process_call, body)
    return {"status": "received"}


async def _process_call(body: models.CallLogIn):
    phone = _normalise_phone(body.phone)
    call_id = await database.fetch_val(
        sqlalchemy.text("""
            INSERT INTO dialer_calls(phone, caller_name, duration_sec, status, agent, notes)
            VALUES(:phone, :caller_name, :duration_sec, :status, :agent, :notes)
            RETURNING id
        """),
        {
            "phone": phone,
            "caller_name": body.caller_name,
            "duration_sec": body.duration_sec,
            "status": body.status.lower(),
            "agent": body.agent,
            "notes": body.notes,
        },
    )

    if body.status.lower() == "missed":
        await database.execute(
            sqlalchemy.text(
                "INSERT INTO callback_queue(phone, caller_name, call_id) VALUES(:phone, :name, :call_id)"
            ),
            {"phone": phone, "name": body.caller_name, "call_id": call_id},
        )
        print(f"[dialer] Missed call queued for callback: {phone}")

    print(f"[dialer] {body.status} call logged: {phone}")


# ── Manual call log (from dashboard form) ─────────────────────────────────────

@router.post("/call/manual", response_model=models.SuccessResponse)
async def log_call_manual(body: models.CallLogIn):
    """Reception manually logs a call — same processing as PBX webhook."""
    await _process_call(body)
    return {"success": True}


# ── Callback queue ─────────────────────────────────────────────────────────────

@router.get("/callbacks", response_model=List[models.CallbackOut])
async def get_callbacks():
    rows = await database.fetch_all(
        sqlalchemy.text(
            "SELECT * FROM callback_queue WHERE status='pending' ORDER BY missed_at ASC"
        )
    )
    return [dict(r) for r in rows]


@router.post("/callback/{callback_id}/done", response_model=models.SuccessResponse)
async def mark_callback_done(callback_id: int, body: models.CallbackDoneIn):
    await database.execute(
        sqlalchemy.text(
            "UPDATE callback_queue SET status=:status WHERE id=:id"
        ),
        {"status": body.status, "id": callback_id},
    )
    return {"success": True}


# ── Recalls & follow-ups ───────────────────────────────────────────────────────

@router.get("/recalls", response_model=List[models.RecallOut])
async def get_recalls():
    rows = await database.fetch_all(
        sqlalchemy.text(
            "SELECT * FROM recall_schedule WHERE status='pending' ORDER BY recall_at ASC"
        )
    )
    return [dict(r) for r in rows]


@router.get("/followups", response_model=List[models.FollowUpOut])
async def get_followups():
    rows = await database.fetch_all(
        sqlalchemy.text(
            "SELECT * FROM follow_up_queue WHERE status='pending' ORDER BY created_at DESC"
        )
    )
    return [dict(r) for r in rows]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalise_phone(phone: str) -> str:
    """Normalise to +91XXXXXXXXXX format."""
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    if len(digits) == 13 and digits.startswith("091"):
        return f"+91{digits[3:]}"
    return phone if phone.startswith("+") else f"+{digits}"


@router.post("/followup/{followup_id}/done")
async def mark_followup_done(followup_id: int):
    await database.execute(
        "UPDATE follow_up_queue SET status='done' WHERE id=:id",
        {"id": followup_id}
    )
    return {"success": True}
