"""Lógica de negocio del módulo Vouchers (V5).

Funciones puras testeables sin DB:
  - validate_imputacion_triple
  - validate_corfo_eligibility
  - calculate_iva_split
  - calculate_threshold_aplicado

Y funciones con DB (usan AsyncSession):
  - generate_voucher_code (llama a `core.next_voucher_code` Postgres)
  - validate_cuenta_imputable_y_habilitada (cross-check con plan_cuentas)
  - validate_proyecto_pertenece_a_empresa
  - validate_area_aplica_a_empresa
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Umbrales default en CLP — sobrescribibles por empresa via core.approval_rules
# (Fase 2). Por ahora hardcoded como defaults.
DEFAULT_THRESHOLD_GASTO = Decimal("5000000")    # $5M
DEFAULT_THRESHOLD_ACTIVO = Decimal("20000000")  # $20M


# ---------------------------------------------------------------------
# Funciones puras (sin DB)
# ---------------------------------------------------------------------


@dataclass
class ImputacionTripleError:
    line_number: int
    field: str
    message: str


def validate_imputacion_triple(
    *,
    line_number: int,
    cuenta_codigo: str,
    proyecto_codigo: str | None,
    area_codigo: str | None,
    es_balance_puro: bool,
) -> list[ImputacionTripleError]:
    """Valida que cada línea tenga cuenta + proyecto + área coherentes.

    `es_balance_puro` viene de `plan_cuentas.flag_caja` o similar — si es
    cuenta de balance puro (banco, IVA débito/crédito, retenciones), se
    permite proyecto/area en NULL (caen al PRJ-EMPRESA-INT-000 del
    proyecto general por convención).

    Devuelve lista de errores. Vacía = OK.
    """
    errors: list[ImputacionTripleError] = []

    if not cuenta_codigo:
        errors.append(
            ImputacionTripleError(
                line_number, "cuenta_codigo", "Cuenta contable es obligatoria"
            )
        )

    if not es_balance_puro:
        if not proyecto_codigo:
            errors.append(
                ImputacionTripleError(
                    line_number,
                    "proyecto_codigo",
                    "Proyecto contable es obligatorio para cuentas de gasto/ingreso",
                )
            )
        if not area_codigo:
            errors.append(
                ImputacionTripleError(
                    line_number,
                    "area_codigo",
                    "Área (centro de costo) es obligatoria para cuentas de gasto/ingreso",
                )
            )

    return errors


def validate_corfo_eligibility(
    *,
    cuenta_corfo_elegible: bool,
    cuenta_tipo_gasto_corfo: str | None,
    proyecto_es_corfo: bool,
    proyecto_eligible_types: list[str],
) -> str | None:
    """Si el proyecto es CORFO y la cuenta es CORFO-elegible, valida que
    el tipo de gasto esté en la lista del proyecto.

    Devuelve mensaje de error o None si OK.
    """
    if not proyecto_es_corfo:
        return None  # cualquier cuenta vale para proyectos no-CORFO

    if not cuenta_corfo_elegible:
        return (
            "La cuenta no está marcada como CORFO-elegible. "
            "Si es un gasto válido para el proyecto CORFO, "
            "actualizá el plan de cuentas en el Excel."
        )

    if not cuenta_tipo_gasto_corfo:
        return "La cuenta CORFO-elegible no tiene tipo_gasto_corfo declarado"

    if cuenta_tipo_gasto_corfo not in proyecto_eligible_types:
        return (
            f"Tipo de gasto '{cuenta_tipo_gasto_corfo}' no está habilitado para este "
            f"proyecto CORFO (acepta: {', '.join(proyecto_eligible_types)})"
        )

    return None


def calculate_threshold_aplicado(
    *,
    total_amount: Decimal,
    es_activacion: bool,
    threshold_gasto: Decimal = DEFAULT_THRESHOLD_GASTO,
    threshold_activo: Decimal = DEFAULT_THRESHOLD_ACTIVO,
) -> bool:
    """Determina si el voucher entra en flujo reforzado (doble firma)."""
    threshold = threshold_activo if es_activacion else threshold_gasto
    return total_amount >= threshold


def calculate_iva_split(
    *,
    monto_bruto: Decimal,
    iva_tratamiento: str,
    tasa_iva: Decimal = Decimal("0.19"),
) -> tuple[Decimal, Decimal]:
    """Devuelve (neto, iva). Para AFECTO: bruto = neto * (1 + tasa).
    Para EXENTO/NO_GRAVADO/NA: iva = 0, neto = bruto.
    """
    if iva_tratamiento != "AFECTO":
        return monto_bruto, Decimal("0")

    factor = Decimal("1") + tasa_iva
    neto = (monto_bruto / factor).quantize(Decimal("0.01"))
    iva = monto_bruto - neto
    return neto, iva


# ---------------------------------------------------------------------
# Funciones con DB
# ---------------------------------------------------------------------


async def generate_voucher_code(
    db: AsyncSession,
    empresa_codigo: str,
    anio: int,
    tipo: str,
) -> str:
    """Llama a la función Postgres `core.next_voucher_code(empresa, anio, tipo)`.

    Atómica via UPSERT con LOCK. Devuelve formato 'CSL-2026-EGR-00001'.
    """
    code = await db.scalar(
        text("SELECT core.next_voucher_code(:e, :a, :t)"),
        {"e": empresa_codigo, "a": anio, "t": tipo},
    )
    if not code:
        raise RuntimeError(
            f"next_voucher_code devolvió NULL para ({empresa_codigo}, {anio}, {tipo})"
        )
    return str(code)


async def fetch_cuenta_metadata(
    db: AsyncSession,
    cuenta_codigo: str,
) -> dict[str, Any] | None:
    """Trae los flags de la cuenta para validación cross-table.

    Devuelve dict con (imputable, flag_caja, corfo_elegible, tipo_gasto_corfo)
    o None si la cuenta no existe.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT imputable, flag_caja, corfo_elegible, tipo_gasto_corfo,
                       activa, iva_tratamiento, nivel
                FROM core.plan_cuentas
                WHERE codigo = :c
                """
            ),
            {"c": cuenta_codigo},
        )
    ).mappings().first()
    return dict(row) if row else None


async def is_cuenta_habilitada_para_empresa(
    db: AsyncSession,
    cuenta_codigo: str,
    empresa_codigo: str,
) -> bool:
    """¿La cuenta está habilitada para esa empresa? (matriz plan_cuenta_empresa)"""
    return bool(
        await db.scalar(
            text(
                """
                SELECT 1
                FROM core.plan_cuenta_empresa
                WHERE cuenta_codigo = :c AND empresa_codigo = :e AND habilitada = TRUE
                """
            ),
            {"c": cuenta_codigo, "e": empresa_codigo},
        )
    )


async def fetch_proyecto_metadata(
    db: AsyncSession,
    proyecto_codigo: str,
) -> dict[str, Any] | None:
    """Trae info del proyecto para validar pertenencia y CORFO eligibility."""
    row = (
        await db.execute(
            text(
                """
                SELECT empresa_codigo, tipo_financiamiento, tipos_gasto_elegibles, estado
                FROM core.proyectos_contables
                WHERE codigo = :c
                """
            ),
            {"c": proyecto_codigo},
        )
    ).mappings().first()
    return dict(row) if row else None


async def is_area_aplica_a_empresa(
    db: AsyncSession,
    area_codigo: str,
    empresa_codigo: str,
) -> bool:
    """¿El área aplica a esa empresa? (matriz area_empresa)"""
    return bool(
        await db.scalar(
            text(
                """
                SELECT 1
                FROM core.area_empresa
                WHERE area_codigo = :a AND empresa_codigo = :e AND aplica = TRUE
                """
            ),
            {"a": area_codigo, "e": empresa_codigo},
        )
    )


async def is_period_locked_for(
    db: AsyncSession,
    empresa_codigo: str,
    fecha_contable: Any,  # date
) -> bool:
    """¿La fecha contable cae en período cerrado para esa empresa?"""
    locked_until = await db.scalar(
        text(
            "SELECT locked_period_end_date FROM core.empresas WHERE codigo = :e"
        ),
        {"e": empresa_codigo},
    )
    if locked_until is None:
        return False
    return fecha_contable <= locked_until
