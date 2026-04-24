from fastapi import APIRouter

from app.api.v1 import health, validate

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router, tags=["health"])
api_router.include_router(validate.router, prefix="/validate", tags=["validate"])
