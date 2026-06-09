"""
Flamingo Healthcare — Dashboard API
FastAPI backend with JWT authentication, rate limiting, and CORS.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.routers import dashboard, dialer, broadcast, engagement, scheduler
from app.routers import auth as auth_router
from app.auth import require_auth
from app.database import database
from app.config import settings

# ── Rate limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Flamingo Healthcare API",
    description="Dashboard API — requires Bearer token from /auth/login",
    version="2.1.0",
    docs_url="/docs" if settings.debug else None,   # hide docs in production
    redoc_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────
origins = (
    ["*"] if settings.debug
    else [f"http://{settings.environment}", f"https://{settings.environment}"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # Nginx handles origin restriction in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Public routes (no auth) ───────────────────────────────────────────────────
app.include_router(auth_router.router, prefix="/auth", tags=["Auth"])

# ── Protected routes (all require valid JWT) ──────────────────────────────────
protected = {"dependencies": [__import__("fastapi").Depends(require_auth)]}

app.include_router(dashboard.router,  prefix="/api/dashboard",  tags=["Dashboard"],  **protected)
app.include_router(dialer.router,     prefix="/api/dialer",     tags=["Dialer"],     **protected)
app.include_router(broadcast.router,  prefix="/api/broadcast",  tags=["Broadcast"],  **protected)
app.include_router(engagement.router, prefix="/api/engagement", tags=["Engagement"], **protected)
app.include_router(scheduler.router,  prefix="/api/scheduler",  tags=["Scheduler"],  **protected)

# ── Lifecycle ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    await database.connect()
    print(f"[db] Connected — environment: {settings.environment}")

@app.on_event("shutdown")
async def shutdown():
    await database.disconnect()

# ── Health (public, rate limited) ─────────────────────────────────────────────
@app.get("/health", tags=["Health"])
@limiter.limit("30/minute")
async def health(request: Request):
    return {"status": "ok", "service": "flamingo-api", "version": "2.1.0"}
