"""
Scheduler router — manually trigger daily jobs from the dashboard.
Delegates to Node.js outbound service (which owns the scheduler logic).
Mirrors Node.js: /api/scheduler/run
"""

from fastapi import APIRouter, HTTPException
import httpx

from app import models

router = APIRouter()

OUTBOUND_URL = "http://localhost:3000"

VALID_JOBS = {"all", "birthdays", "festivals", "recalls"}


@router.post("/run", response_model=models.SchedulerRunOut)
async def run_scheduler(body: models.SchedulerRunIn):
    if body.job not in VALID_JOBS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown job '{body.job}'. Valid options: {', '.join(VALID_JOBS)}"
        )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{OUTBOUND_URL}/api/scheduler/run",
                json={"job": body.job},
            )
            resp.raise_for_status()
            data = resp.json()
            return models.SchedulerRunOut(
                success=data.get("success", True),
                message=data.get("message", f"Started: {body.job}"),
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Outbound service unavailable: {e}")
