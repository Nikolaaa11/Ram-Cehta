"""R152HHHH · Auto-creación de OC desde un email del inbox.

Cuando `classify_one()` detecta category=='oc', invoca este servicio.
Flujo:
  1. Lee el inbox_message (subject + body + from_email).
  2. Llama a analyze_document(tipo="orden_compra") para extraer
     proveedor + items + monto con Claude.
  3. Detecta empresa receptora — match por:
       a) RUT detectado en el body (busca en core.empresas)
       b) Subject "Para EMPRESA: ..." (substring match)
       c) Default = FIP_CEHTA (operador puede reasignar después)
  4. Upsert proveedor (idempotente por RUT o razón social exacta).
  5. Crea OC con items + numero correlativo (PROV-{EMP}-{NNN}).
  6. UPDATE inbox_messages: created_entity_type='orden_compra',
     created_entity_id=oc_id, auto_create_at=NOW().

Inspirado en email_intake_service._crear_oc de cehta-pagos
(C:/Users/DELL/Documents/000.1/oc-pagos-platform), portado al schema
y conventions de Ram-Cehta (core.ordenes_compra).

Defensivo: si cualquier paso falla, se guarda el error en
inbox_messages.auto_create_error y la clasificación general sigue OK.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger(__name__)

IVA_TASA = Decimal("0.19")

# Regex para RUT chileno: 12.345.678-9 o 12345678-9
_RUT_REGEX = re.compile(r"\b(\d{1,3}(?:\.\d{3}){0,2}-?[\dkK])\b")


async def auto_create_oc_from_inbox(
    db: AsyncSession, inbox_id: int
) -> dict[str, Any]:
    """Procesa un inbox_message clasificado como OC y crea la entidad.

    Retorna:
      {"ok": True, "oc_id": int, "numero_oc": str}  si exitoso
      {"ok": False, "error": "mensaje"}             si falló
    """
    # 1. Leer inbox_message + adjuntos
    row = (
        await db.execute(
            text(
                """SELECT inbox_id, subject, from_email, from_name, body_text,
                          category, created_entity_id,
                          COALESCE(attachments_meta, '[]'::jsonb) AS attachments
                   FROM core.inbox_messages
                   WHERE inbox_id = :id"""
            ),
            {"id": inbox_id},
        )
    ).first()

    if not row:
        return {"ok": False, "error": f"inbox_id {inbox_id} no encontrado"}
    if row[6] is not None:
        return {"ok": False, "error": "ya existe entidad creada para este email"}
    if row[5] not in ("oc", "orden_compra"):
        return {"ok": False, "error": f"category={row[5]!r} no es 'oc'"}

    subject = row[1] or ""
    from_email = row[2] or ""
    from_name = row[3] or ""
    body_text = row[4] or ""
    attachments_meta_raw = row[7]
    # JSONB puede llegar como str o como list según el driver
    import json as _json
    if isinstance(attachments_meta_raw, str):
        try:
            attachments_meta = _json.loads(attachments_meta_raw)
        except Exception:
            attachments_meta = []
    else:
        attachments_meta = attachments_meta_raw or []

    # 2. Extraer datos con Claude
    try:
        from app.services.document_analyzer_service import analyze_document

        full_text = f"ASUNTO: {subject}\nDE: {from_email}\n\n{body_text}"
        extraction = await analyze_document(
            text=full_text[:25_000],
            tipo="orden_compra",
        )
        data = extraction.data or {}
    except Exception as exc:
        await _save_error(db, inbox_id, f"AI extraction falló: {exc}")
        return {"ok": False, "error": f"AI extract: {exc}"}

    # 3. Detectar empresa receptora
    empresa_codigo = await _detect_empresa_receptora(
        db, subject + " " + body_text, data.get("empresa_codigo")
    )

    # 4. Upsert proveedor
    prov_rut = (data.get("proveedor_rut") or "").strip()
    prov_nombre = (data.get("proveedor_nombre") or from_name or "").strip()
    if not prov_nombre:
        # Último fallback: usar parte local del email
        prov_nombre = from_email.split("@")[0] if from_email else "Sin nombre"

    proveedor_id = await _upsert_proveedor(db, prov_rut, prov_nombre)
    if not proveedor_id:
        await _save_error(db, inbox_id, "No se pudo upsert proveedor")
        return {"ok": False, "error": "upsert proveedor falló"}

    # 5. Crear OC
    try:
        oc_id, numero_oc = await _crear_oc(
            db=db,
            empresa_codigo=empresa_codigo,
            proveedor_id=proveedor_id,
            extraction=data,
            email_subject=subject,
            email_body=body_text,
        )
    except Exception as exc:
        await _save_error(db, inbox_id, f"crear OC falló: {exc}")
        return {"ok": False, "error": f"crear OC: {exc}"}

    # 6. Linkear
    await db.execute(
        text(
            """UPDATE core.inbox_messages
               SET created_entity_type = 'orden_compra',
                   created_entity_id = :oc_id,
                   auto_create_at = NOW(),
                   auto_create_error = NULL
               WHERE inbox_id = :id"""
        ),
        {"oc_id": oc_id, "id": inbox_id},
    )

    # R152KKKK — 6.5. Copiar adjuntos del email a la OC.
    # oc_pdf_service.generate_oc_pdf_bundle los va a anexar al final del
    # PDF cuando include_attachments=TRUE. Idempotente (UNIQUE oc+path).
    attachments_copied = 0
    if isinstance(attachments_meta, list):
        for att in attachments_meta:
            if not isinstance(att, dict):
                continue
            dropbox_path = att.get("dropbox_path") or att.get("path")
            file_name = (
                att.get("filename") or att.get("file_name")
                or att.get("name") or "adjunto.bin"
            )
            mime_type = att.get("content_type") or att.get("mime_type")
            size_bytes = att.get("size_bytes") or att.get("size")
            if not dropbox_path:
                continue
            try:
                await db.execute(
                    text(
                        """INSERT INTO core.oc_attachments
                               (oc_id, file_name, dropbox_path, mime_type,
                                size_bytes, source, inbox_message_id)
                           VALUES (:oc, :name, :path, :mime, :size,
                                   'inbox_email', :inbox)
                           ON CONFLICT (oc_id, dropbox_path) DO NOTHING"""
                    ),
                    {
                        "oc": oc_id,
                        "name": str(file_name)[:255],
                        "path": str(dropbox_path)[:500],
                        "mime": str(mime_type)[:120] if mime_type else None,
                        "size": int(size_bytes) if size_bytes else None,
                        "inbox": inbox_id,
                    },
                )
                attachments_copied += 1
            except Exception as exc:
                log.warning(
                    "auto_create_oc.copy_attachment_failed",
                    oc_id=oc_id,
                    path=dropbox_path,
                    error=str(exc),
                )

    await db.commit()

    log.info(
        "auto_create_oc.success",
        inbox_id=inbox_id,
        oc_id=oc_id,
        numero_oc=numero_oc,
        empresa=empresa_codigo,
        attachments_copied=attachments_copied,
    )

    # R152IIII — Auto-envío del PDF al GG con CC a encargados.
    # Soft-fail: si falla, queda registrado en oc_send_error pero la OC ya
    # está creada y linkeada. El operador puede re-mandar manual.
    send_result: dict[str, Any] | None = None
    try:
        from app.services.send_oc_to_signers_service import send_oc_to_signers
        send_result = await send_oc_to_signers(db, oc_id)
        log.info(
            "auto_create_oc.email_sent",
            oc_id=oc_id,
            sent=bool(send_result and send_result.get("ok")),
        )
    except Exception as exc:
        log.warning(
            "auto_create_oc.email_failed",
            oc_id=oc_id,
            error=str(exc),
        )

    return {
        "ok": True,
        "oc_id": oc_id,
        "numero_oc": numero_oc,
        "empresa_codigo": empresa_codigo,
        "proveedor_id": proveedor_id,
        "attachments_copied": attachments_copied,
        "email_sent": bool(send_result and send_result.get("ok")),
        "email_to": (send_result or {}).get("to") if send_result else None,
    }


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


async def _save_error(db: AsyncSession, inbox_id: int, msg: str) -> None:
    """Persiste el error en auto_create_error sin bloquear el flujo."""
    try:
        await db.execute(
            text(
                """UPDATE core.inbox_messages
                   SET auto_create_error = :err,
                       auto_create_at = NOW()
                   WHERE inbox_id = :id"""
            ),
            {"err": msg[:500], "id": inbox_id},
        )
        await db.commit()
    except Exception as exc:
        log.warning("auto_create_oc.save_error_failed", err=str(exc))


async def _detect_empresa_receptora(
    db: AsyncSession, full_text: str, hint: str | None
) -> str:
    """Intenta detectar a qué empresa va dirigida la OC.

    Estrategia (en orden):
      1. Hint del extractor IA
      2. RUT en el cuerpo → match en core.empresas
      3. Substring del código en subject o cuerpo
      4. Default FIP_CEHTA
    """
    if hint:
        exists = await db.scalar(
            text("SELECT codigo FROM core.empresas WHERE codigo = :c AND activo = TRUE"),
            {"c": hint.upper().strip()},
        )
        if exists:
            return str(exists)

    # RUT en cuerpo
    for m in _RUT_REGEX.finditer(full_text):
        candidate = m.group(1).upper().replace(".", "")
        exists = await db.scalar(
            text(
                """SELECT codigo FROM core.empresas
                   WHERE REPLACE(REPLACE(rut, '.', ''), ' ', '') = :rut
                   AND activo = TRUE LIMIT 1"""
            ),
            {"rut": candidate},
        )
        if exists:
            return str(exists)

    # Substring código en subject + cuerpo
    upper_text = full_text.upper()
    rows = await db.execute(
        text("SELECT codigo FROM core.empresas WHERE activo = TRUE"),
    )
    codigos = [r[0] for r in rows]
    for c in codigos:
        # Buscar el código con bordes razonables (no matchear letras random)
        if re.search(rf"\b{re.escape(c)}\b", upper_text):
            return c

    # Default
    return "FIP_CEHTA"


async def _upsert_proveedor(
    db: AsyncSession, rut: str, razon_social: str
) -> int | None:
    """Upsert idempotente por RUT (preferido) o razón social exacta."""
    rut_clean = re.sub(r"\s+", "", rut).upper() if rut else ""

    # 1. Buscar por RUT
    if rut_clean:
        existing = await db.scalar(
            text(
                "SELECT proveedor_id FROM core.proveedores "
                "WHERE REPLACE(REPLACE(rut, '.', ''), ' ', '') = :r LIMIT 1"
            ),
            {"r": rut_clean.replace(".", "")},
        )
        if existing:
            return int(existing)

    # 2. Buscar por razón social
    if razon_social:
        existing = await db.scalar(
            text(
                "SELECT proveedor_id FROM core.proveedores "
                "WHERE LOWER(razon_social) = LOWER(:rs) AND activo = TRUE "
                "LIMIT 1"
            ),
            {"rs": razon_social.strip()[:255]},
        )
        if existing:
            return int(existing)

    # 3. Crear nuevo
    new_id = await db.scalar(
        text(
            """INSERT INTO core.proveedores
                   (razon_social, rut, activo, created_at, updated_at)
               VALUES (:rs, NULLIF(:rut, ''), TRUE, NOW(), NOW())
               RETURNING proveedor_id"""
        ),
        {"rs": razon_social.strip()[:255], "rut": rut_clean or ""},
    )
    return int(new_id) if new_id else None


async def _crear_oc(
    *,
    db: AsyncSession,
    empresa_codigo: str,
    proveedor_id: int,
    extraction: dict[str, Any],
    email_subject: str,
    email_body: str,
) -> tuple[int, str]:
    """Crea la OC + items. Retorna (oc_id, numero_oc)."""
    # Generar correlativo: PROV-{EMP3}-{NNN}
    emp_short = empresa_codigo[:3].upper().replace("_", "")
    seq_row = (
        await db.execute(
            text(
                """SELECT COALESCE(MAX(numero_seq), 0) + 1 AS next_seq
                   FROM core.ordenes_compra
                   WHERE empresa_codigo = :c
                     AND anio = EXTRACT(YEAR FROM CURRENT_DATE)::INT"""
            ),
            {"c": empresa_codigo},
        )
    ).first()
    next_seq = int(seq_row[0]) if seq_row else 1
    anio = date.today().year
    numero_oc = f"OC{str(next_seq).zfill(4)}-{emp_short}{str(anio)[2:]}"

    # Montos
    items = extraction.get("items") or []
    moneda = (extraction.get("moneda") or "CLP").upper()
    forma_pago = extraction.get("forma_pago") or "TRANSFERENCIA"
    plazo_pago = extraction.get("plazo_pago") or "30 días"
    validez_dias = int(extraction.get("validez_dias") or 30)

    total_neto = Decimal("0")
    item_rows: list[dict[str, Any]] = []
    for idx, it in enumerate(items, start=1):
        try:
            precio = Decimal(str(it.get("precio_unitario") or 0))
            cantidad = Decimal(str(it.get("cantidad") or 1))
            item_total = (precio * cantidad).quantize(Decimal("0.01"))
        except Exception:
            precio = Decimal("0")
            cantidad = Decimal("1")
            item_total = Decimal("0")
        item_rows.append({
            "item": idx,
            "descripcion": str(it.get("descripcion") or "Sin descripción")[:500],
            "precio_unitario": precio,
            "cantidad": cantidad,
            "total_linea": item_total,
        })
        total_neto += item_total

    # Si no hay items pero sí monto neto/total
    if not item_rows:
        neto_str = extraction.get("neto") or extraction.get("monto") or "0"
        try:
            total_neto = Decimal(str(neto_str))
        except Exception:
            total_neto = Decimal("0")
        item_rows.append({
            "item": 1,
            "descripcion": (
                extraction.get("observaciones")
                or email_subject
                or "Ver email original"
            )[:500],
            "precio_unitario": total_neto,
            "cantidad": Decimal("1"),
            "total_linea": total_neto,
        })

    iva = (total_neto * IVA_TASA).quantize(Decimal("0.01"))
    total = total_neto + iva

    # INSERT OC cabecera
    oc_row = (
        await db.execute(
            text(
                """INSERT INTO core.ordenes_compra
                       (numero_oc, empresa_codigo, proveedor_id,
                        fecha_emision, validez_dias, moneda,
                        neto, iva, total,
                        forma_pago, plazo_pago,
                        observaciones, estado, numero_seq, anio,
                        created_at, updated_at)
                   VALUES
                       (:numero, :emp, :pid,
                        CURRENT_DATE, :validez, :moneda,
                        :neto, :iva, :total,
                        :forma, :plazo,
                        :obs, 'emitida', :seq, :anio,
                        NOW(), NOW())
                   RETURNING oc_id"""
            ),
            {
                "numero": numero_oc,
                "emp": empresa_codigo,
                "pid": proveedor_id,
                "validez": validez_dias,
                "moneda": moneda,
                "neto": total_neto,
                "iva": iva,
                "total": total,
                "forma": forma_pago,
                "plazo": plazo_pago,
                "obs": (
                    f"Auto-creada desde email · Asunto: {email_subject[:150]}"
                ),
                "seq": next_seq,
                "anio": anio,
            },
        )
    ).first()
    oc_id = int(oc_row[0])

    # INSERT items
    for item in item_rows:
        await db.execute(
            text(
                """INSERT INTO core.ordenes_compra_detalle
                       (oc_id, item, descripcion, precio_unitario, cantidad, total_linea)
                   VALUES (:oc_id, :item, :desc, :precio, :cant, :total)"""
            ),
            {
                "oc_id": oc_id,
                "item": item["item"],
                "desc": item["descripcion"],
                "precio": item["precio_unitario"],
                "cant": item["cantidad"],
                "total": item["total_linea"],
            },
        )

    return oc_id, numero_oc
