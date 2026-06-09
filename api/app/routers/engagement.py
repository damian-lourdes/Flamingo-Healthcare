"""
Engagement router — manual trigger endpoints fired from reception.
Delegates to Node.js outbound service for actual WhatsApp sending.
Mirrors Node.js: /api/engagement/*
"""

from fastapi import APIRouter, HTTPException
import httpx

from app import models

router = APIRouter()

OUTBOUND_URL = "http://localhost:3000"


async def _post_outbound(path: str, payload: dict):
    """Helper: POST to Node.js outbound service and raise cleanly on failure."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{OUTBOUND_URL}{path}", json=payload)
            resp.raise_for_status()
            return resp.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Outbound service unavailable: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)


@router.post("/post-consultation", response_model=models.SuccessResponse)
async def post_consultation(body: models.PostConsultationIn):
    await _post_outbound("/api/engagement/post-consultation", {
        "phone": body.phone,
        "name": body.name,
        "doctor": body.doctor,
        "specialty": body.specialty,
        "followUpDate": body.follow_up_date,
    })
    return {"success": True}


@router.post("/lab-report-ready", response_model=models.SuccessResponse)
async def lab_report_ready(body: models.LabReportIn):
    await _post_outbound("/api/engagement/lab-report-ready", {
        "phone": body.phone,
        "name": body.name,
        "testName": body.test_name,
        "doctor": body.doctor,
        "labVisitId": body.lab_visit_id,
    })
    return {"success": True}


@router.post("/discharge", response_model=models.SuccessResponse)
async def discharge(body: models.DischargeIn):
    await _post_outbound("/api/engagement/discharge", {
        "phone": body.phone,
        "patientName": body.patient_name,
        "doctor": body.doctor,
        "specialty": body.specialty,
        "admissionId": body.admission_id,
    })
    return {"success": True}
