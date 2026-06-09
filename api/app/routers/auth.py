"""
Auth router — login, token refresh, current user.
POST /auth/login  → returns JWT
GET  /auth/me     → returns current username (validates token)
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import authenticate_user, create_access_token, require_auth
from fastapi import Depends

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class MeResponse(BaseModel):
    username: str
    authenticated: bool = True


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if not authenticate_user(body.username, body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    token = create_access_token(body.username)
    return TokenResponse(access_token=token, username=body.username)


@router.get("/me", response_model=MeResponse)
async def me(username: str = Depends(require_auth)):
    """Validates the current token and returns the logged-in user."""
    return MeResponse(username=username)
