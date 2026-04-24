from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import DBSession

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    database: str


@router.get("/health", response_model=HealthResponse)
async def health(session: DBSession) -> HealthResponse:
    db_status = "ok"
    try:
        result = await session.execute(text("SELECT 1"))
        result.scalar_one()
    except Exception:  # noqa: BLE001 — health check reports, doesn't raise
        db_status = "unreachable"
    return HealthResponse(status="ok", database=db_status)
