"""
Broadcast router — campaign history, health tips, offers, personalised messages.
Mirrors Node.js: /api/broadcast/*
Note: actual WhatsApp sending is delegated to the Node.js outbound service
      via an internal HTTP call. This keeps Meta credentials in one place.
"""

from fastapi import APIRouter, HTTPException
import httpx
from typing import List

from app.database import database
from app.config import settings
from app import models
import sqlalchemy

router = APIRouter()

# Internal Node.js outbound service URL
OUTBOUND_URL = "http://localhost:3000"


# ── Campaign history ───────────────────────────────────────────────────────────

@router.get("/history", response_model=List[models.BroadcastCampaignOut])
async def get_broadcast_history():
    rows = await database.fetch_all(
        sqlalchemy.text(
            "SELECT * FROM broadcast_campaigns ORDER BY sent_at DESC LIMIT 50"
        )
    )
    return [dict(r) for r in rows]


# ── Broadcast lists ────────────────────────────────────────────────────────────

@router.get("/lists", response_model=List[models.BroadcastListOut])
async def get_broadcast_lists():
    rows = await database.fetch_all(
        sqlalchemy.text("SELECT * FROM broadcast_lists ORDER BY created_at DESC")
    )
    return [dict(r) for r in rows]


@router.post("/lists", response_model=models.SuccessResponse)
async def create_broadcast_list(body: models.BroadcastListIn):
    list_id = await database.fetch_val(
        sqlalchemy.text(
            "INSERT INTO broadcast_lists(name, description, phone_count) VALUES(:name, :desc, :count) RETURNING id"
        ),
        {"name": body.name, "desc": body.description, "count": len(body.phones)},
    )
    for phone in body.phones:
        await database.execute(
            sqlalchemy.text(
                "INSERT INTO broadcast_list_members(list_id, phone) VALUES(:list_id, :phone) ON CONFLICT DO NOTHING"
            ),
            {"list_id": list_id, "phone": phone},
        )
    return {"success": True, "message": f"List created with {len(body.phones)} members"}


@router.get("/lists/{list_id}/members")
async def get_list_members(list_id: int):
    rows = await database.fetch_all(
        sqlalchemy.text("""
            SELECT blm.phone, pp.name
            FROM broadcast_list_members blm
            LEFT JOIN patient_profiles pp ON pp.phone = blm.phone
            WHERE blm.list_id = :list_id
        """),
        {"list_id": list_id},
    )
    return [dict(r) for r in rows]


# ── Send broadcasts (delegates to Node.js outbound service) ───────────────────

@router.post("/health-tip", response_model=models.BroadcastSendResult)
async def send_health_tip(body: models.HealthTipIn):
    """
    Proxies to Node.js /api/broadcast/health-tip.
    Keeps all Meta token handling in the outbound service.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OUTBOUND_URL}/api/broadcast/health-tip",
                json={
                    "campaignName": body.campaign_name,
                    "message": body.message,
                    "recipients": [r.dict() for r in body.recipients],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return models.BroadcastSendResult(
                success=True,
                sent=data.get("sent", 0),
                failed=data.get("failed", 0),
                total=len(body.recipients),
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Outbound service unavailable: {e}")


@router.post("/offer", response_model=models.BroadcastSendResult)
async def send_offer(body: models.OfferIn):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{OUTBOUND_URL}/api/broadcast/offer",
                json={
                    "offerTitle": body.offer_title,
                    "offerDetails": body.offer_details,
                    "validTill": body.valid_till.isoformat() if body.valid_till else None,
                    "recipients": [r.dict() for r in body.recipients],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return models.BroadcastSendResult(
                success=True,
                sent=data.get("sent", 0),
                failed=data.get("failed", 0),
                total=len(body.recipients),
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Outbound service unavailable: {e}")


@router.post("/personalised", response_model=models.SuccessResponse)
async def send_personalised(body: models.PersonalisedIn):
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{OUTBOUND_URL}/api/broadcast/personalised",
                json={"phone": body.phone, "name": body.name, "message": body.message},
            )
            resp.raise_for_status()
            return {"success": True}
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Outbound service unavailable: {e}")
