"""Servicio de indexación: lee Dropbox `08-AI Knowledge Base/{empresa}/`,
chunkea archivos `.md`/`.txt`/`.pdf`, embeddea cada chunk y los persiste
en `core.ai_documents`.

Decisiones de diseño:
- **Chunking**: ventana de ~1000 chars con overlap de 200 (~10–15% del chunk).
  Strategy "recursive": prefiere cortar en `\n\n`, luego `\n`, luego espacios.
  Es lo más balanceado para textos heterogéneos (markdown, contratos, etc.).
- **Re-index idempotente**: borra los chunks existentes para esa empresa y
  vuelve a indexar todo. Evita drift entre estado Dropbox y DB. Cost OK porque
  la KB por empresa es <500 archivos en V3.
- **Errores tolerantes**: si un archivo falla (PDF corrupto, encoding raro),
  se loggea y se sigue con el resto — no abortamos el batch entero.
- **Carpeta canónica**: `/Cehta Capital/08-AI Knowledge Base/{empresa_codigo}/`
  en concordancia con `docs/GUIA_CARPETAS.md`. Si no existe, devolvemos
  `files_processed=0` y warning.
"""
from __future__ import annotations

import io
import re
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_embedding_service import embed_batch, vector_literal

if TYPE_CHECKING:  # pragma: no cover
    from app.services.dropbox_service import DropboxService

log = structlog.get_logger(__name__)

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
SUPPORTED_EXTENSIONS = (".md", ".txt", ".pdf")
KB_ROOT_TEMPLATE = "/Cehta Capital/08-AI Knowledge Base/{empresa}"


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def chunk_text(
    text_content: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    """Recursive character chunking — prefiere separadores naturales.

    Algoritmo:
    1. Si el texto es ≤ chunk_size, devolvemos [texto] (caso base).
    2. Buscamos el separador más fuerte (`\\n\\n` > `\\n` > `. ` > ` `) más
       cercano a `chunk_size` desde el final del slice candidato.
    3. Cortamos ahí, recursamos en el resto con overlap.
    """
    text_content = text_content.strip()
    if not text_content:
        return []
    if len(text_content) <= chunk_size:
        return [text_content]

    chunks: list[str] = []
    start = 0
    while start < len(text_content):
        end = min(start + chunk_size, len(text_content))
        if end < len(text_content):
            # Buscar mejor punto de corte hacia atrás desde `end`
            window = text_content[start:end]
            cut = -1
            for sep in ("\n\n", "\n", ". ", " "):
                idx = window.rfind(sep)
                if idx > chunk_size // 2:  # exigir corte en mitad superior
                    cut = idx + len(sep)
                    break
            if cut > 0:
                end = start + cut
        chunks.append(text_content[start:end].strip())
        if end >= len(text_content):
            break
        start = max(end - overlap, start + 1)

    return [c for c in chunks if c]


# ---------------------------------------------------------------------------
# File parsing
# ---------------------------------------------------------------------------


def _decode_text(content: bytes) -> str:
    """Best-effort decode — UTF-8 con fallback a latin-1."""
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode("latin-1", errors="ignore")


def _extract_pdf_text(content: bytes) -> str:
    """Extrae texto de un PDF usando pypdf. Tolerante a páginas corruptas."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "pypdf no instalado — agregar a deps de backend"
        ) from exc

    reader = PdfReader(io.BytesIO(content))
    parts: list[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception as exc:  # noqa: BLE001
            log.warning("ai.pdf_page_failed", error=str(exc))
    text_extracted = "\n\n".join(p for p in parts if p.strip())
    return re.sub(r"\n{3,}", "\n\n", text_extracted)


def parse_file(name: str, content: bytes) -> str | None:
    """Devuelve el texto plano del archivo, o None si la extension no aplica."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if f".{ext}" not in SUPPORTED_EXTENSIONS:
        return None
    if ext == "pdf":
        return _extract_pdf_text(content)
    return _decode_text(content)


# ---------------------------------------------------------------------------
# Indexing pipeline
# ---------------------------------------------------------------------------


async def index_dropbox_folder(
    *,
    db: AsyncSession,
    dropbox: "DropboxService",
    empresa_codigo: str,
    folder_path: str | None = None,
) -> dict[str, Any]:
    """Indexa la KB Dropbox de una empresa. Ver decisiones en docstring del módulo."""
    target_folder = folder_path or KB_ROOT_TEMPLATE.format(empresa=empresa_codigo)

    try:
        items = dropbox.list_folder(target_folder)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "ai.index.folder_missing",
            empresa=empresa_codigo,
            folder=target_folder,
            error=str(exc),
        )
        return {
            "empresa_codigo": empresa_codigo,
            "folder_path": target_folder,
            "files_processed": 0,
            "chunks_created": 0,
            "skipped": [f"folder not found: {target_folder}"],
        }

    # Borrar chunks existentes (re-index full).
    await db.execute(
        text("DELETE FROM core.ai_documents WHERE empresa_codigo = :e"),
        {"e": empresa_codigo},
    )

    files_processed = 0
    skipped: list[str] = []
    all_chunks: list[tuple[str, str, int, str]] = []
    # tuples: (source_path, source_id, chunk_index, content)

    for item in items:
        if item["type"] != "file":
            continue
        name = item["name"]
        path = item["path"]
        if not any(name.lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS):
            skipped.append(f"{name}: extension no soportada")
            continue

        try:
            raw = dropbox.download_file(path)
            extracted = parse_file(name, raw)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "ai.index.file_failed", file=name, error=str(exc), empresa=empresa_codigo
            )
            skipped.append(f"{name}: {exc}")
            continue

        if not extracted or not extracted.strip():
            skipped.append(f"{name}: vacío tras parseo")
            continue

        chunks = chunk_text(extracted)
        if not chunks:
            skipped.append(f"{name}: sin chunks útiles")
            continue

        for i, ch in enumerate(chunks):
            all_chunks.append((path, name, i, ch))
        files_processed += 1
        log.info(
            "ai.index.file_ok",
            file=name,
            chunks=len(chunks),
            empresa=empresa_codigo,
        )

    if not all_chunks:
        return {
            "empresa_codigo": empresa_codigo,
            "folder_path": target_folder,
            "files_processed": files_processed,
            "chunks_created": 0,
            "skipped": skipped,
        }

    # Embed batch
    embeddings = await embed_batch([ch[3] for ch in all_chunks])
    assert len(embeddings) == len(all_chunks), "embedding count mismatch"

    # Bulk insert via SQL crudo (la columna vector no se mapea limpio en ORM).
    insert_sql = text(
        """
        INSERT INTO core.ai_documents
            (empresa_codigo, source_type, source_path, source_id, chunk_index,
             content, embedding, metadata)
        VALUES
            (:empresa, 'dropbox', :path, :sid, :idx, :content,
             CAST(:embedding AS vector), :metadata)
        """
    )
    for (path, name, idx, content), emb in zip(all_chunks, embeddings, strict=True):
        await db.execute(
            insert_sql,
            {
                "empresa": empresa_codigo,
                "path": path,
                "sid": name,
                "idx": idx,
                "content": content,
                "embedding": vector_literal(emb),
                "metadata": None,
            },
        )

    return {
        "empresa_codigo": empresa_codigo,
        "folder_path": target_folder,
        "files_processed": files_processed,
        "chunks_created": len(all_chunks),
        "skipped": skipped,
    }
