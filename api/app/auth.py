"""
Authentication — JWT-based auth for the Flamingo dashboard.

Single admin user model: credentials stored in .env / environment variables.
No database table needed for the initial release.

Flow:
  POST /auth/login  → validate username+password → return JWT
  All /api/* routes → require valid JWT in Authorization: Bearer header
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

# ── Password hashing ──────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

# ── JWT ───────────────────────────────────────────────────────────────────────
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def decode_token(token: str) -> Optional[str]:
    """Return username if token is valid, else None."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload.get("sub")
    except JWTError:
        return None

# ── Dependency — protects all /api/* routes ───────────────────────────────────
async def require_auth(token: str = Depends(oauth2_scheme)) -> str:
    username = decode_token(token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return username

# ── Validate login credentials against .env values ───────────────────────────
def authenticate_user(username: str, password: str) -> bool:
    """
    Validates against ADMIN_USERNAME and ADMIN_PASSWORD from .env.
    ADMIN_PASSWORD can be stored as a bcrypt hash OR plain text.
    On first run with plain text, it's compared directly.
    In production, store the bcrypt hash in .env.
    """
    if username != settings.admin_username:
        return False
    stored = settings.admin_password
    # If stored password starts with $2b$ it's already a bcrypt hash
    if stored.startswith("$2b$"):
        return verify_password(password, stored)
    # Plain text fallback (development / first setup)
    return password == stored
