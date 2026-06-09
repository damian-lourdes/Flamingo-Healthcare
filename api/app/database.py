"""
Database — async PostgreSQL via databases + SQLAlchemy core.
Mirrors the existing schema created by the Node.js flamingo-outbound service.
"""

import databases
import sqlalchemy
from app.config import settings

# Async database instance (for queries)
database = databases.Database(settings.database_url)

# Sync engine (for schema introspection / Alembic)
engine = sqlalchemy.create_engine(
    settings.database_url.replace("postgresql+asyncpg", "postgresql"),
)

metadata = sqlalchemy.MetaData()

# ── Tables (mirror existing Node schema — do NOT recreate, just reflect) ───────

engagement_log = sqlalchemy.Table(
    "engagement_log", metadata,
    sqlalchemy.Column("id",           sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",        sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("trigger_type", sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("ref_id",       sqlalchemy.Text),
    sqlalchemy.Column("sent_at",      sqlalchemy.DateTime(timezone=True)),
)

outbound_messages = sqlalchemy.Table(
    "outbound_messages", metadata,
    sqlalchemy.Column("id",           sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",        sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("patient_name", sqlalchemy.Text),
    sqlalchemy.Column("trigger_type", sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("message",      sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("sent_at",      sqlalchemy.DateTime(timezone=True)),
)

patient_profiles = sqlalchemy.Table(
    "patient_profiles", metadata,
    sqlalchemy.Column("id",           sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",        sqlalchemy.Text, unique=True, nullable=False),
    sqlalchemy.Column("name",         sqlalchemy.Text),
    sqlalchemy.Column("dob",          sqlalchemy.Date),
    sqlalchemy.Column("specialty",    sqlalchemy.Text),
    sqlalchemy.Column("doctor",       sqlalchemy.Text),
    sqlalchemy.Column("branch",       sqlalchemy.Text),
    sqlalchemy.Column("opt_in",       sqlalchemy.Boolean),
    sqlalchemy.Column("last_contact", sqlalchemy.DateTime(timezone=True)),
    sqlalchemy.Column("created_at",   sqlalchemy.DateTime(timezone=True)),
)

recall_schedule = sqlalchemy.Table(
    "recall_schedule", metadata,
    sqlalchemy.Column("id",          sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",       sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("name",        sqlalchemy.Text),
    sqlalchemy.Column("specialty",   sqlalchemy.Text),
    sqlalchemy.Column("recall_at",   sqlalchemy.DateTime(timezone=True)),
    sqlalchemy.Column("recall_days", sqlalchemy.Integer),
    sqlalchemy.Column("status",      sqlalchemy.Text),
)

follow_up_queue = sqlalchemy.Table(
    "follow_up_queue", metadata,
    sqlalchemy.Column("id",          sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",       sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("name",        sqlalchemy.Text),
    sqlalchemy.Column("doctor",      sqlalchemy.Text),
    sqlalchemy.Column("specialty",   sqlalchemy.Text),
    sqlalchemy.Column("original_dt", sqlalchemy.Text),
    sqlalchemy.Column("status",      sqlalchemy.Text),
    sqlalchemy.Column("created_at",  sqlalchemy.DateTime(timezone=True)),
)

dialer_calls = sqlalchemy.Table(
    "dialer_calls", metadata,
    sqlalchemy.Column("id",           sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",        sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("caller_name",  sqlalchemy.Text),
    sqlalchemy.Column("duration_sec", sqlalchemy.Integer),
    sqlalchemy.Column("status",       sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("agent",        sqlalchemy.Text),
    sqlalchemy.Column("notes",        sqlalchemy.Text),
    sqlalchemy.Column("called_at",    sqlalchemy.DateTime(timezone=True)),
)

callback_queue = sqlalchemy.Table(
    "callback_queue", metadata,
    sqlalchemy.Column("id",          sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("phone",       sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("caller_name", sqlalchemy.Text),
    sqlalchemy.Column("missed_at",   sqlalchemy.DateTime(timezone=True)),
    sqlalchemy.Column("status",      sqlalchemy.Text),
    sqlalchemy.Column("call_id",     sqlalchemy.Integer),
)

broadcast_lists = sqlalchemy.Table(
    "broadcast_lists", metadata,
    sqlalchemy.Column("id",          sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("name",        sqlalchemy.Text, nullable=False),
    sqlalchemy.Column("description", sqlalchemy.Text),
    sqlalchemy.Column("phone_count", sqlalchemy.Integer),
    sqlalchemy.Column("created_at",  sqlalchemy.DateTime(timezone=True)),
)

broadcast_list_members = sqlalchemy.Table(
    "broadcast_list_members", metadata,
    sqlalchemy.Column("list_id", sqlalchemy.Integer),
    sqlalchemy.Column("phone",   sqlalchemy.Text),
)

broadcast_campaigns = sqlalchemy.Table(
    "broadcast_campaigns", metadata,
    sqlalchemy.Column("id",              sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("name",            sqlalchemy.Text),
    sqlalchemy.Column("message",         sqlalchemy.Text),
    sqlalchemy.Column("recipient_count", sqlalchemy.Integer),
    sqlalchemy.Column("sent_count",      sqlalchemy.Integer),
    sqlalchemy.Column("failed_count",    sqlalchemy.Integer),
    sqlalchemy.Column("sent_at",         sqlalchemy.DateTime(timezone=True)),
)
