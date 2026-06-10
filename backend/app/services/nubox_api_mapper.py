"""Round 124 — Mappers entre voucher local Cehta ↔ payload Nubox API.

El payload Nubox tiene una estructura específica documentada:
  - sequence (int)
  - type.legalCode (str: 33|34|39|41|56|61|110...)
  - client {tradeName, identification, email, mainActivity, ...}
  - dueDate, saleType.id, paymentForm.id
  - details[] {order, quantity, productDescription, price, taxes, ...}
  - references[] (opcional)

Este service traduce un voucher de core.vouchers + sus voucher_lines a ese
payload, listo para POST /v1/sales/issuance.
"""
from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

log = logging.getLogger(__name__)


# Mapeo voucher.doc_tributario_tipo → tipo Nubox API legalCode
DOC_TRIBUTARIO_TO_DTE: dict[str, str] = {
    "FACTURA": "33",        # Factura Electrónica
    "BOLETA": "39",         # Boleta Electrónica
    "NOTA_CREDITO": "61",   # Nota de Crédito Electrónica
    "NOTA_DEBITO": "56",    # Nota de Débito Electrónica
}

# Códigos legales de regiones por código común
# (el resto se mapea defensivo via 'XIII Metropolitana' por default si falta)
REGION_FALLBACK = "13"
COMUNA_FALLBACK = "13101"  # Santiago centro


class NuboxMapperError(ValueError):
    """Mapeo inválido — datos del voucher no cumplen requisitos Nubox."""


def voucher_to_nubox_payload(
    voucher: dict[str, Any],
    lines: list[dict[str, Any]],
    *,
    sequence: int = 1,
    cliente_region: str = REGION_FALLBACK,
    cliente_comuna: str = COMUNA_FALLBACK,
) -> dict[str, Any]:
    """Construye un dict para POST /v1/sales/issuance desde un voucher local.

    `voucher` debe tener al menos:
      empresa_codigo, tipo, doc_tributario_tipo, doc_tributario_folio,
      fecha_documento, glosa, moneda, contraparte_rut, contraparte_nombre

    `lines` cada una con:
      line_number, descripcion (puede ser glosa si está vacía), debit, credit,
      cuenta_codigo (opcional para Nubox)

    Solo se pueden emitir vouchers tipo VENTA o COMPRA mapeables a un DTE
    válido de Nubox.
    """
    doc_tipo_str = voucher.get("doc_tributario_tipo")
    if not doc_tipo_str:
        raise NuboxMapperError(
            "voucher.doc_tributario_tipo es requerido para emitir a Nubox"
        )

    dte_legal_code = DOC_TRIBUTARIO_TO_DTE.get(doc_tipo_str)
    if not dte_legal_code:
        raise NuboxMapperError(
            f"doc_tributario_tipo='{doc_tipo_str}' no es emitible vía Nubox API. "
            f"Tipos soportados: {sorted(DOC_TRIBUTARIO_TO_DTE.keys())}"
        )

    rut = voucher.get("contraparte_rut")
    if not rut:
        raise NuboxMapperError("voucher.contraparte_rut es requerido")

    fecha = voucher.get("fecha_documento") or voucher.get("fecha_contable")
    if not fecha:
        raise NuboxMapperError("voucher debe tener fecha_documento o fecha_contable")
    # Convert date → string ISO
    fecha_iso = (
        fecha.isoformat() if hasattr(fecha, "isoformat") else str(fecha)
    )
    # Para Nubox dueDate, tomamos la misma fecha (al contado)
    due_date = voucher.get("fecha_ejecucion") or fecha
    due_date_iso = (
        due_date.isoformat() if hasattr(due_date, "isoformat") else str(due_date)
    )

    # Construir cliente
    client_dict: dict[str, Any] = {
        "tradeName": (voucher.get("contraparte_nombre") or "Cliente")[:100],
        "identification": {
            "type": 1,  # 1 = RUT chileno
            "value": rut.strip(),
        },
        "mainActivity": "Cliente",  # placeholder — operador puede editar después
        "territorialDivisionLegalCode": cliente_region,
        "territorialDivisionL2LegalCode": cliente_comuna,
    }

    # Construir details — agrupamos por glosa de la línea
    details: list[dict[str, Any]] = []
    total_neto = 0
    total_iva = 0

    for idx, line in enumerate(lines, start=1):
        # En vouchers de VENTA: el monto del producto va en credit (ingreso)
        # En vouchers de COMPRA: va en debit (gasto)
        # Pero para emitir DTE a Nubox necesitamos el precio "neto" del producto.
        # Tomamos max(debit, credit) como el monto.
        debit = int(Decimal(str(line.get("debit") or 0)))
        credit = int(Decimal(str(line.get("credit") or 0)))
        monto_linea = max(debit, credit)
        if monto_linea == 0:
            continue

        descripcion = (line.get("descripcion") or voucher.get("glosa") or "Item")[:80]
        is_iva_line = line.get("iva_tratamiento") in ("AFECTO", None)

        details.append({
            "order": idx,
            "quantity": 1,
            "productDescription": descripcion,
            "subjectToTax": is_iva_line,
            "price": monto_linea,
            "uom": {"code": "UNID"},
            "taxes": [],
        })
        total_neto += monto_linea

    if not details:
        raise NuboxMapperError(
            "Ninguna línea del voucher tiene monto > 0 para emitir"
        )

    # IVA: si el doc es afecto (factura/boleta NO exenta), calcular 19% sobre neto
    # Documentos exentos (34, 41) no llevan IVA.
    is_afecto = dte_legal_code in {"33", "39", "56", "61"}
    if is_afecto:
        # Agregar tax IVA al primer item (Nubox lo aplica como suma global)
        # R152JJJJJJ — Decimal + ROUND_HALF_UP en vez de round() float.
        # round() hace banker's rounding (28.5 → 28); el SII y la práctica
        # comercial chilena esperan half-up (28.5 → 29). Con float además
        # 0.19 no es exacto en binario.
        iva_amount = int(
            (Decimal(total_neto) * Decimal("0.19")).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        total_iva = iva_amount
        if details:
            details[0]["taxes"].append({
                "legalCode": "14",  # IVA
                "amount": iva_amount,
            })

    payload: dict[str, Any] = {
        "sequence": sequence,
        "type": {"legalCode": dte_legal_code},
        "client": client_dict,
        "dueDate": due_date_iso,
        "saleType": {"id": 1},      # 1 = Ventas del Giro
        "paymentForm": {"id": 1},   # 1 = Contado (default)
        "comment": (voucher.get("glosa") or "")[:500],
        "details": details,
    }

    # Si el voucher local tenía un folio del SII, agregarlo como referencia
    folio = voucher.get("doc_tributario_folio")
    if folio and doc_tipo_str in ("NOTA_CREDITO", "NOTA_DEBITO"):
        # Las notas de crédito/débito requieren reference al doc original.
        # Como no tenemos el doc original en el voucher, usamos placeholder.
        payload["references"] = [{
            "legalCode": "33",  # placeholder — operador edita
            "documentNumber": folio,
            "documentEmissionDate": f"{fecha_iso}T00:00:00.000-04:00",
            "documentTotalAmount": total_neto + total_iva,
            "motiveTypeId": 1,
            "motiveDescription": (
                voucher.get("glosa") or "Referencia"
            )[:90],
        }]

    return payload


def parse_nubox_emit_response(
    response_body: list[dict[str, Any]],
) -> tuple[list[dict], list[dict]]:
    """Separa la respuesta de POST /issuance en (exitosos, con_errores).

    Cada elemento de response_body tiene:
      - id (int): identificador asignado por Nubox
      - sequence (int): número que mandamos
      - type (dict, opcional): {legalCode, name}
      - errors (list o null): si hay errores, listado de campos
    """
    successful: list[dict] = []
    failed: list[dict] = []
    for item in response_body:
        if item.get("errors"):
            failed.append(item)
        else:
            successful.append(item)
    return successful, failed
