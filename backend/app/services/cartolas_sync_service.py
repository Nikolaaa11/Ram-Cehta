"""Cartolas Bancarias sync — orquesta el flujo Dropbox → DB.

Pipeline para una empresa:
  1. Lista PDFs en `/Cehta Capital/01-Empresas/{COD}/04-Financiero/Cartolas Bancarias/`
  2. Para cada PDF:
     - Calcula file_hash → si ya está en core.cartolas_runs → skip
     - Crea run row con status='pending'
     - Descarga el PDF, parse con cartolas_parser_service
     - Si is_scanned=True → status='failed_ocr_required'
     - Si parse OK → INSERT movimientos en core.movimientos (idempotente)
     - status='imported' + stats

Idempotente:
  - cartolas_runs UNIQUE(empresa, file_hash) → no procesa el mismo PDF dos veces
  - core.movimientos.natural_key UNIQUE → no duplica filas si re-corres

Soft-fail por archivo: errores individuales se acumulan en errors[] sin
abortar el run completo.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.cartolas_parser_service import (
    build_movimiento_natural_key,
    file_hash,
    parse_cartola_pdf,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

log = structlog.get_logger(__name__)


_DROPBOX_ROOT = "/Cehta Capital/01-Empresas/{empresa}/04-Financiero/Cartolas Bancarias"


async def sync_cartolas_for_empresa(
    db: AsyncSession,
    empresa_codigo: str,
    *,
    triggered_by: str = "manual",
) -> dict[str, Any]:
    """Procesa todos los PDFs de cartolas en Dropbox para una empresa.

    Devuelve un dict con stats agregados:
      - files_seen
      - files_skipped (file_hash duplicado)
      - files_imported
      - files_failed_parse
      - files_failed_ocr_required
      - movimientos_inserted
      - movimientos_skipped (natural_key duplicado)
      - errors []
    """
    stats = {
        "files_seen": 0,
        "files_skipped": 0,
        "files_imported": 0,
        "files_failed_parse": 0,
        "files_failed_ocr_required": 0,
        "movimientos_inserted": 0,
        "movimientos_skipped": 0,
        "errors": [],
    }

    try:
        dbx = DropboxService()
    except DropboxNotConfigured as exc:
        stats["errors"].append(f"Dropbox no configurado: {exc}")
        return stats

    root = _DROPBOX_ROOT.format(empresa=empresa_codigo)

    try:
        items = dbx.list_folder(root)
    except Exception as exc:  # noqa: BLE001
        stats["errors"].append(f"Listar {root}: {exc}")
        return stats

    # Pre-cargar hashes ya procesados para esta empresa (skip rápido)
    existing_hashes_rows = (
        await db.execute(
            text(
                "SELECT file_hash FROM core.cartolas_runs "
                "WHERE empresa_codigo = :e"
            ),
            {"e": empresa_codigo},
        )
    ).fetchall()
    existing_hashes: set[str] = {r[0] for r in existing_hashes_rows}

    for item in items:
        if item.get("type") != "file":
            continue
        name = item.get("name", "")
        if not name.lower().endswith(".pdf"):
            continue

        stats["files_seen"] += 1
        path = item.get("path") or item.get("path_display")

        # 1. Descargar PDF
        try:
            content = dbx.download_file(path)
        except Exception as exc:  # noqa: BLE001
            stats["errors"].append(f"Download {path}: {exc}")
            continue

        # 2. Hash + skip duplicate
        h = file_hash(content)
        if h in existing_hashes:
            stats["files_skipped"] += 1
            continue

        # 3. Crear run row
        run_id = await _create_run_row(
            db,
            empresa_codigo=empresa_codigo,
            dropbox_path=path,
            file_hash=h,
            file_size=len(content),
            triggered_by=triggered_by,
        )
        existing_hashes.add(h)

        # 4. Parse PDF
        result = parse_cartola_pdf(content)

        if result.is_scanned:
            # Fallback Claude Vision: intenta OCR via Sonnet 4.5.
            # Si pdf2image no está instalado o ANTHROPIC_API_KEY falta,
            # marcamos failed_ocr_required (igual que antes).
            try:
                from app.services.claude_vision_ocr_service import (
                    ClaudeVisionNotAvailable,
                    extract_text_with_claude_vision,
                )
                from app.services.cartolas_parser_service import (
                    _extract_periodo,
                    _parse_filas_genericas,
                    detect_banco,
                )

                ocr_text, ocr_meta = await extract_text_with_claude_vision(
                    content, document_type="cartola"
                )
                if ocr_text and len(ocr_text) > 50:
                    # Re-parse con el texto extraído por vision
                    banco_v = detect_banco(ocr_text)
                    pd_v, ph_v = _extract_periodo(ocr_text)
                    rows_v = _parse_filas_genericas(ocr_text)

                    if rows_v:
                        # Promote a "imported" via vision
                        result.banco = banco_v
                        result.periodo_desde = pd_v
                        result.periodo_hasta = ph_v
                        result.rows = rows_v
                        result.is_scanned = False
                        log.info(
                            "cartola.vision_recovered",
                            run_id=run_id,
                            rows=len(rows_v),
                            tokens=ocr_meta.get("tokens_input", 0)
                            + ocr_meta.get("tokens_output", 0),
                        )
                        # NO continue — caemos al flow de import normal abajo
                    else:
                        await _update_run_status(
                            db, run_id,
                            status="failed_ocr_required",
                            error=(
                                "Vision OCR no encontró movimientos parseables. "
                                "Verificá si el PDF realmente es una cartola."
                            ),
                            banco=banco_v,
                        )
                        stats["files_failed_ocr_required"] += 1
                        continue
                else:
                    await _update_run_status(
                        db, run_id,
                        status="failed_ocr_required",
                        error="Vision OCR devolvió texto vacío",
                        banco=result.banco,
                    )
                    stats["files_failed_ocr_required"] += 1
                    continue
            except ClaudeVisionNotAvailable as exc:
                await _update_run_status(
                    db, run_id,
                    status="failed_ocr_required",
                    error=f"Vision no disponible: {exc}",
                    banco=result.banco,
                )
                stats["files_failed_ocr_required"] += 1
                continue
            except Exception as exc:  # noqa: BLE001
                await _update_run_status(
                    db, run_id,
                    status="failed_ocr_required",
                    error=f"Vision OCR falló: {exc}",
                    banco=result.banco,
                )
                stats["files_failed_ocr_required"] += 1
                continue

        if result.error:
            await _update_run_status(
                db, run_id,
                status="failed_parse",
                error=result.error,
                banco=result.banco,
            )
            stats["files_failed_parse"] += 1
            continue

        # 5. INSERT movimientos
        inserted = skipped = 0
        for row in result.rows:
            monto = row.abono if row.abono > 0 else -row.egreso
            if monto == 0:
                continue
            nk = build_movimiento_natural_key(
                empresa_codigo=empresa_codigo,
                fecha=row.fecha,
                descripcion=row.descripcion,
                monto=monto,
                banco=result.banco,
            )
            try:
                res = await db.execute(
                    text(
                        """
                        INSERT INTO core.movimientos (
                            natural_key, fecha, descripcion,
                            abono, egreso, saldo_contable,
                            empresa_codigo, banco, anio, periodo,
                            real_proyectado, fuente
                        )
                        VALUES (
                            :nk, :fecha, :desc,
                            :abono, :egreso, :saldo,
                            :emp, :banco, :anio, :periodo,
                            'Real', 'cartola_pdf'
                        )
                        ON CONFLICT (natural_key) DO NOTHING
                        """
                    ),
                    {
                        "nk": nk,
                        "fecha": row.fecha,
                        "desc": row.descripcion[:500],
                        "abono": row.abono,
                        "egreso": row.egreso,
                        "saldo": row.saldo,
                        "emp": empresa_codigo,
                        "banco": result.banco,
                        "anio": row.fecha.year,
                        "periodo": (
                            f"{row.fecha.month:02d}_{str(row.fecha.year)[-2:]}"
                        ),
                    },
                )
                if res.rowcount and res.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as exc:  # noqa: BLE001
                stats["errors"].append(
                    f"Insert mov en {path}: {exc}"
                )

        await _update_run_status(
            db, run_id,
            status="imported",
            error=None,
            banco=result.banco,
            periodo_desde=result.periodo_desde,
            periodo_hasta=result.periodo_hasta,
            rows_extracted=len(result.rows),
            rows_inserted=inserted,
            rows_skipped=skipped,
        )
        stats["files_imported"] += 1
        stats["movimientos_inserted"] += inserted
        stats["movimientos_skipped"] += skipped

    await db.commit()
    return stats


async def _create_run_row(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    dropbox_path: str,
    file_hash: str,
    file_size: int,
    triggered_by: str,
) -> int:
    """Inserta una fila en core.cartolas_runs y devuelve el run_id."""
    res = await db.execute(
        text(
            """
            INSERT INTO core.cartolas_runs (
                empresa_codigo, dropbox_path, file_hash, file_size_bytes,
                status, triggered_by
            )
            VALUES (:e, :p, :h, :s, 'pending', :t)
            RETURNING run_id
            """
        ),
        {
            "e": empresa_codigo,
            "p": dropbox_path,
            "h": file_hash,
            "s": file_size,
            "t": triggered_by,
        },
    )
    return int(res.scalar() or 0)


async def _update_run_status(
    db: AsyncSession,
    run_id: int,
    *,
    status: str,
    error: str | None = None,
    banco: str | None = None,
    periodo_desde: Any = None,
    periodo_hasta: Any = None,
    rows_extracted: int = 0,
    rows_inserted: int = 0,
    rows_skipped: int = 0,
) -> None:
    await db.execute(
        text(
            """
            UPDATE core.cartolas_runs
            SET status = :status,
                error_message = :error,
                banco_detectado = :banco,
                periodo_desde = :pd,
                periodo_hasta = :ph,
                rows_extracted = :re,
                rows_inserted = :ri,
                rows_skipped = :rs,
                finished_at = NOW()
            WHERE run_id = :id
            """
        ),
        {
            "id": run_id,
            "status": status,
            "error": error,
            "banco": banco,
            "pd": periodo_desde,
            "ph": periodo_hasta,
            "re": rows_extracted,
            "ri": rows_inserted,
            "rs": rows_skipped,
        },
    )
