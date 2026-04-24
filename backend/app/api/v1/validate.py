from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.domain.value_objects.rut import format_rut, validate_rut

router = APIRouter()


class RutValidationResponse(BaseModel):
    valid: bool
    formatted: str | None
    message: str | None


@router.get("/rut", response_model=RutValidationResponse)
async def validate_rut_endpoint(
    rut: str = Query(..., description="RUT con o sin formato: '12.345.678-9' o '123456789'"),
) -> RutValidationResponse:
    is_valid = validate_rut(rut)
    if not is_valid:
        return RutValidationResponse(
            valid=False,
            formatted=None,
            message="RUT inválido (dígito verificador incorrecto)",
        )
    return RutValidationResponse(valid=True, formatted=format_rut(rut), message=None)
