"""
Configuration — reads from environment variables / .env file.
"""

import secrets
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # PostgreSQL
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/flamingo"

    # Auth — JWT
    # Generate a strong secret: python3 -c "import secrets; print(secrets.token_hex(32))"
    jwt_secret: str = secrets.token_hex(32)   # overridden by .env in production
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480             # 8 hours

    # Admin credentials (set in .env — never leave as defaults in production)
    admin_username: str = "admin"
    admin_password: str = "changeme"          # hashed on first startup

    # Meta WhatsApp Cloud API
    meta_phone_number_id: str = ""
    meta_access_token: str = ""
    meta_api_version: str = "v19.0"

    # Outbound service (Node.js) — used for the /health check on the Overview page.
    # On Railway this must point at the outbound service, NOT localhost.
    # Use the private URL (http://<service>.railway.internal:8080) or the public URL.
    outbound_url: str = "http://localhost:3000"

    # App
    environment: str = "development"
    debug: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
