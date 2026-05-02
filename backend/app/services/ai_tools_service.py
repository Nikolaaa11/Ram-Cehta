"""AI Tools Service — V5 fase 1 (tool calling con Anthropic).

A diferencia de `ai_chat_service.py` que es RAG-stream sobre documentos,
este servicio expone **tool calling** sobre los datos estructurados de la
plataforma (entregables, compliance, etc.).

Pipeline `ask()`:
    1. Recibir pregunta del usuario en lenguaje natural.
    2. Llamar a Claude con `tools=` definidas (search_entregables,
       get_compliance, etc.).
    3. Si Claude devuelve `tool_use`, ejecutar la herramienta contra la DB,
       enviar `tool_result` y repetir el loop.
    4. Cuando Claude devuelve solo texto, devolverlo al frontend con la
       traza completa de tool calls (transparencia).

Diseño:
- Tools son **read-only** en V5.1 — Claude no muta datos. En V5.2
  agregaremos tools mutadoras (`mark_entregable_entregado`, etc.) detrás
  de scope `ai:write`.
- Cada tool tiene un wrapper que serializa el resultado a JSON-safe (dates
  → ISO, decimals → float). El LLM solo ve strings.
- El loop tiene **max_iterations = 8** para evitar loops infinitos.
- Logging estructurado por tool call para debugging.
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = structlog.get_logger(__name__)


SYSTEM_PROMPT = """Eres el asistente operativo de Cehta Capital para FIP CEHTA ESG.

Tu rol es ayudar a los usuarios a entender el estado de los entregables
regulatorios (CMF, CORFO, UAF, SII, Auditoría, Asamblea, etc.) y tomar
decisiones operativas.

REGLAS:
- Responde SIEMPRE en español neutro.
- Usá las tools disponibles para obtener datos REALES de la base. NUNCA
  inventes números o fechas — si no tenés la info, decilo explícitamente.
- Sé conciso: respondé con bullets o tablas markdown breves.
- Si una pregunta es ambigua, pedí clarificación antes de ejecutar tools.
- Cuando muestres entregables, incluí: nombre, categoría, fecha, días
  restantes, y responsable.
- Para preguntas de compliance, usá `get_compliance_grade` y explicá
  el grade A-F en términos prácticos.

CONTEXTO:
Hoy es {today}. El año en curso es {year}.
"""


class AiToolsNotConfigured(Exception):  # noqa: N818
    """`ANTHROPIC_API_KEY` ausente en el entorno backend."""


def _anthropic_client() -> Any:
    if not settings.anthropic_api_key:
        raise AiToolsNotConfigured("ANTHROPIC_API_KEY no configurado")
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=settings.anthropic_api_key)


# ---------------------------------------------------------------------------
# Tool definitions (Anthropic tools schema)
# ---------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_entregables",
        "description": (
            "Busca entregables regulatorios con filtros. Devuelve hasta 30 "
            "resultados ordenados por fecha límite ascendente. Usar para "
            "consultas tipo 'qué entregables tengo de CMF este mes' o "
            "'cuáles vencen pronto'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "categoria": {
                    "type": "string",
                    "enum": [
                        "CMF", "CORFO", "UAF", "SII", "INTERNO",
                        "AUDITORIA", "ASAMBLEA", "OPERACIONAL",
                    ],
                    "description": "Categoría regulatoria",
                },
                "estado": {
                    "type": "string",
                    "enum": ["pendiente", "en_proceso", "entregado", "no_entregado"],
                    "description": "Filtrar por estado",
                },
                "empresa": {
                    "type": "string",
                    "description": (
                        "Código de empresa (ej. CSL, RHO, DTE). Filtra por "
                        "subcategoria o extra.empresa_codigo."
                    ),
                },
                "responsable": {
                    "type": "string",
                    "description": "Match parcial case-insensitive",
                },
                "desde": {
                    "type": "string",
                    "description": "Fecha desde (YYYY-MM-DD)",
                },
                "hasta": {
                    "type": "string",
                    "description": "Fecha hasta (YYYY-MM-DD)",
                },
                "only_alerta": {
                    "type": "boolean",
                    "description": "Solo entregables en alerta activa (≤15 días)",
                },
            },
        },
    },
    {
        "name": "get_critical_count",
        "description": (
            "Devuelve el conteo de entregables críticos (vencidos + hoy + "
            "≤5 días). Usar para preguntas tipo 'cuántos críticos tengo' "
            "o 'cómo está mi pipeline'."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_compliance_grade",
        "description": (
            "Devuelve el compliance grade YTD (A/B/C/D/F) de una empresa "
            "específica. Incluye breakdown de entregados a tiempo, atrasados, "
            "no entregados. Usar para preguntas tipo 'cómo está cumpliendo CSL' "
            "o 'cuál es el compliance de RHO'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "empresa_codigo": {
                    "type": "string",
                    "description": "Código de empresa (CSL, RHO, DTE, etc.)",
                },
            },
            "required": ["empresa_codigo"],
        },
    },
    {
        "name": "get_compliance_report",
        "description": (
            "Devuelve el ranking completo de compliance cross-empresa. Usar "
            "para preguntas tipo 'qué empresa cumple peor' o 'rankéame por "
            "compliance'."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_facets",
        "description": (
            "Devuelve los responsables y empresas únicos presentes en el "
            "sistema. Útil cuando el usuario pregunta sobre opciones "
            "disponibles."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
]


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


def _json_safe(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if v is None:
        return None
    return v


async def _tool_search_entregables(
    db: AsyncSession, args: dict[str, Any]
) -> list[dict[str, Any]]:
    """Wraps GET /entregables con los mismos filtros."""
    conditions: list[str] = []
    params: dict[str, Any] = {}
    if args.get("categoria"):
        conditions.append("categoria = :categoria")
        params["categoria"] = args["categoria"]
    if args.get("estado"):
        conditions.append("estado = :estado")
        params["estado"] = args["estado"]
    if args.get("empresa"):
        conditions.append(
            "(subcategoria ILIKE :emp OR extra->>'empresa_codigo' ILIKE :emp)"
        )
        params["emp"] = f"%{args['empresa']}%"
    if args.get("responsable"):
        conditions.append("responsable ILIKE :resp")
        params["resp"] = f"%{args['responsable']}%"
    if args.get("desde"):
        conditions.append("fecha_limite >= :desde")
        params["desde"] = args["desde"]
    if args.get("hasta"):
        conditions.append("fecha_limite <= :hasta")
        params["hasta"] = args["hasta"]
    if args.get("only_alerta"):
        conditions.append(
            "estado IN ('pendiente','en_proceso') "
            "AND fecha_limite <= (CURRENT_DATE + INTERVAL '15 days')"
        )

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = (
        await db.execute(
            text(
                f"""
                SELECT entregable_id, id_template, nombre, categoria,
                       subcategoria, periodo, fecha_limite, responsable,
                       estado, (fecha_limite - CURRENT_DATE) AS dias_restantes
                FROM app.entregables_regulatorios
                {where}
                ORDER BY fecha_limite ASC
                LIMIT 30
                """
            ),
            params,
        )
    ).mappings().all()
    return [
        {
            "entregable_id": int(r["entregable_id"]),
            "nombre": r["nombre"],
            "categoria": r["categoria"],
            "empresa": r.get("subcategoria"),
            "periodo": r["periodo"],
            "fecha_limite": _json_safe(r["fecha_limite"]),
            "responsable": r["responsable"],
            "estado": r["estado"],
            "dias_restantes": int(r["dias_restantes"] or 0),
        }
        for r in rows
    ]


async def _tool_get_critical_count(
    db: AsyncSession, _args: dict[str, Any]
) -> dict[str, int]:
    row = (
        await db.execute(
            text(
                """
                SELECT
                  COUNT(*) FILTER (WHERE fecha_limite < CURRENT_DATE) AS vencidos,
                  COUNT(*) FILTER (WHERE fecha_limite = CURRENT_DATE) AS hoy,
                  COUNT(*) FILTER (
                    WHERE fecha_limite > CURRENT_DATE
                      AND fecha_limite <= (CURRENT_DATE + INTERVAL '5 days')
                  ) AS proximos_5d
                FROM app.entregables_regulatorios
                WHERE estado IN ('pendiente','en_proceso')
                """
            )
        )
    ).mappings().first()
    if row is None:
        return {"critical": 0, "vencidos": 0, "hoy": 0, "proximos_5d": 0}
    venc = int(row["vencidos"] or 0)
    hoy = int(row["hoy"] or 0)
    prox = int(row["proximos_5d"] or 0)
    return {
        "critical": venc + hoy + prox,
        "vencidos": venc,
        "hoy": hoy,
        "proximos_5d": prox,
    }


async def _tool_get_compliance_grade(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    from app.api.v1.entregables import _compute_compliance_for_empresa

    empresa = args.get("empresa_codigo")
    if not empresa:
        return {"error": "empresa_codigo requerido"}
    grade = await _compute_compliance_for_empresa(db, empresa)
    return grade.model_dump()


async def _tool_get_compliance_report(
    db: AsyncSession, _args: dict[str, Any]
) -> dict[str, Any]:
    from app.api.v1.entregables import _compute_compliance_for_empresa

    rows = (
        await db.execute(
            text(
                """
                SELECT DISTINCT
                  COALESCE(extra->>'empresa_codigo', subcategoria) AS emp
                FROM app.entregables_regulatorios
                WHERE COALESCE(extra->>'empresa_codigo', subcategoria) IS NOT NULL
                """
            )
        )
    ).all()
    empresas = []
    for r in rows:
        if not r[0]:
            continue
        g = await _compute_compliance_for_empresa(db, r[0])
        empresas.append(g.model_dump())
    empresas.sort(key=lambda g: g["tasa_a_tiempo"], reverse=True)
    promedio = (
        round(sum(g["tasa_cumplimiento"] for g in empresas) / len(empresas), 1)
        if empresas
        else 100.0
    )
    return {
        "empresas": empresas,
        "promedio_cumplimiento": promedio,
        "total_empresas": len(empresas),
    }


async def _tool_get_facets(
    db: AsyncSession, _args: dict[str, Any]
) -> dict[str, list[str]]:
    rows_resp = (
        await db.execute(
            text(
                "SELECT DISTINCT responsable FROM app.entregables_regulatorios "
                "WHERE responsable IS NOT NULL ORDER BY responsable"
            )
        )
    ).all()
    rows_emp = (
        await db.execute(
            text(
                "SELECT DISTINCT COALESCE(extra->>'empresa_codigo', subcategoria) AS emp "
                "FROM app.entregables_regulatorios "
                "WHERE COALESCE(extra->>'empresa_codigo', subcategoria) IS NOT NULL "
                "ORDER BY emp"
            )
        )
    ).all()
    return {
        "responsables": [r[0] for r in rows_resp if r[0]],
        "empresas": [r[0] for r in rows_emp if r[0]],
    }


TOOL_HANDLERS = {
    "search_entregables": _tool_search_entregables,
    "get_critical_count": _tool_get_critical_count,
    "get_compliance_grade": _tool_get_compliance_grade,
    "get_compliance_report": _tool_get_compliance_report,
    "get_facets": _tool_get_facets,
}


# ─── V5.2 — Mutating tools (opt-in, requieren write_mode flag) ─────────


MUTATING_TOOLS: list[dict[str, Any]] = [
    {
        "name": "mark_entregable",
        "description": (
            "Marca un entregable específico con un nuevo estado (entregado / "
            "no_entregado / en_proceso / pendiente). MUTACIÓN — usar solo "
            "cuando el usuario lo pidió explícitamente. Audita cada cambio."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entregable_id": {
                    "type": "integer",
                    "description": "ID del entregable",
                },
                "estado": {
                    "type": "string",
                    "enum": ["pendiente", "en_proceso", "entregado", "no_entregado"],
                    "description": "Nuevo estado",
                },
                "motivo_no_entrega": {
                    "type": "string",
                    "description": (
                        "Obligatorio si estado='no_entregado'. Motivo "
                        "documentado para acta CV."
                    ),
                },
                "notas": {
                    "type": "string",
                    "description": "Notas internas opcionales",
                },
            },
            "required": ["entregable_id", "estado"],
        },
    },
    {
        "name": "bulk_mark_entregables",
        "description": (
            "Marca varios entregables a la vez con el mismo estado. MUTACIÓN. "
            "Usar para 'marca todos los CMF Q1 como entregados' después de "
            "que el usuario lo confirmó."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Lista de IDs (max 100)",
                    "maxItems": 100,
                },
                "estado": {
                    "type": "string",
                    "enum": ["pendiente", "en_proceso", "entregado", "no_entregado"],
                },
                "motivo_no_entrega": {
                    "type": "string",
                },
            },
            "required": ["ids", "estado"],
        },
    },
]


async def _tool_mark_entregable(
    db: AsyncSession, args: dict[str, Any], user_id: str
) -> dict[str, Any]:
    """Marca un entregable. Reusa la lógica del PATCH endpoint sin pasar
    por HTTP — query directa con audit.
    """
    eid = args.get("entregable_id")
    estado = args.get("estado")
    if not eid or not estado:
        return {"error": "entregable_id y estado requeridos"}
    if estado == "no_entregado" and not args.get("motivo_no_entrega"):
        return {"error": "motivo_no_entrega obligatorio para estado=no_entregado"}

    # Verificar existe
    row = (
        await db.execute(
            text(
                "SELECT estado, id_template, periodo, categoria "
                "FROM app.entregables_regulatorios WHERE entregable_id = :id"
            ),
            {"id": eid},
        )
    ).mappings().first()
    if row is None:
        return {"error": f"entregable_id {eid} no encontrado"}

    fecha_real = date.today() if estado == "entregado" else None

    await db.execute(
        text(
            """
            UPDATE app.entregables_regulatorios
            SET estado = :estado,
                fecha_entrega_real = :fr,
                motivo_no_entrega = :motivo,
                notas = COALESCE(:notas, notas),
                updated_at = now(),
                updated_by = :uid
            WHERE entregable_id = :id
            """
        ),
        {
            "estado": estado,
            "fr": fecha_real,
            "motivo": args.get("motivo_no_entrega"),
            "notas": args.get("notas"),
            "id": eid,
            "uid": user_id,
        },
    )
    await db.commit()
    log.info(
        "ai_tools.mark_entregable",
        eid=eid,
        old_estado=row["estado"],
        new_estado=estado,
        actor=user_id,
    )
    return {
        "success": True,
        "entregable_id": eid,
        "new_estado": estado,
        "previous_estado": row["estado"],
    }


async def _tool_bulk_mark_entregables(
    db: AsyncSession, args: dict[str, Any], user_id: str
) -> dict[str, Any]:
    """Bulk mark — usa la misma lógica que el endpoint POST /bulk-update."""
    ids = args.get("ids", [])
    estado = args.get("estado")
    if not ids or not estado:
        return {"error": "ids y estado requeridos"}
    if estado == "no_entregado" and not args.get("motivo_no_entrega"):
        return {"error": "motivo_no_entrega obligatorio para estado=no_entregado"}
    if len(ids) > 100:
        return {"error": "Máximo 100 ids por bulk operation"}

    fecha_real = date.today() if estado == "entregado" else None

    result = await db.execute(
        text(
            """
            UPDATE app.entregables_regulatorios
            SET estado = :estado,
                fecha_entrega_real = CASE
                    WHEN :estado = 'entregado'
                    THEN COALESCE(fecha_entrega_real, :fr)
                    ELSE fecha_entrega_real
                END,
                motivo_no_entrega = :motivo,
                updated_at = now(),
                updated_by = :uid
            WHERE entregable_id = ANY(:ids)
              AND estado != :estado
            """
        ),
        {
            "estado": estado,
            "fr": fecha_real,
            "motivo": args.get("motivo_no_entrega"),
            "ids": ids,
            "uid": user_id,
        },
    )
    await db.commit()
    log.info(
        "ai_tools.bulk_mark",
        count=len(ids),
        new_estado=estado,
        actor=user_id,
        rowcount=result.rowcount,
    )
    return {
        "success": True,
        "requested": len(ids),
        "updated": result.rowcount or 0,
        "new_estado": estado,
    }


# Registry separado — solo se inyecta si write_mode=True en ask()
MUTATING_TOOL_HANDLERS = {
    "mark_entregable": _tool_mark_entregable,
    "bulk_mark_entregables": _tool_bulk_mark_entregables,
}


# ---------------------------------------------------------------------------
# Main ask() loop
# ---------------------------------------------------------------------------


async def ask(
    db: AsyncSession,
    question: str,
    *,
    max_iterations: int = 8,
    write_mode: bool = False,
    user_id: str = "",
) -> dict[str, Any]:
    """One-shot Q&A con tool calling. Devuelve `{answer, tool_calls, tokens}`.

    El loop ejecuta tools hasta que Claude devuelve solo texto o se alcanza
    el max_iterations (safety net contra loops infinitos).

    Si `write_mode=True`, se inyectan las MUTATING_TOOLS (mark_entregable,
    bulk_mark) y Claude puede mutar datos. **Solo activar cuando el usuario
    confirmó explícitamente que quiere que la AI actúe** — auditamos cada
    mutación con `actor=user_id`.
    """
    client = _anthropic_client()
    today = date.today()
    system_prompt = SYSTEM_PROMPT.format(today=today.isoformat(), year=today.year)

    if write_mode:
        # Reforzamos el prompt en write_mode: confirmar antes de mutar
        system_prompt += (
            "\n\nMODO ESCRITURA HABILITADO. Tenés acceso a tools mutadoras "
            "(mark_entregable, bulk_mark_entregables). REGLAS:\n"
            "- Antes de ejecutar una mutación, EXPLICÁ claramente qué vas "
            "a cambiar y pedí confirmación si el usuario no fue 100% "
            "explícito.\n"
            "- No mutes en respuesta a preguntas exploratorias ('cuántos "
            "hay?', 'mostrame los CMF').\n"
            "- Si dudás, NO mutes y respondé en texto preguntando qué hacer."
        )

    available_tools = list(TOOLS)
    available_handlers = dict(TOOL_HANDLERS)
    if write_mode:
        available_tools.extend(MUTATING_TOOLS)
        # MUTATING_TOOL_HANDLERS reciben user_id extra — wrap para fit en signature
        for name, handler in MUTATING_TOOL_HANDLERS.items():
            captured_handler = handler

            async def _wrapper(
                db_inner: AsyncSession,
                args: dict[str, Any],
                _h=captured_handler,
            ) -> Any:
                return await _h(db_inner, args, user_id)

            available_handlers[name] = _wrapper

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": question},
    ]
    tool_calls_trace: list[dict[str, Any]] = []
    total_input_tokens = 0
    total_output_tokens = 0

    for iteration in range(max_iterations):
        log.info(
            "ai_tools.iteration",
            iteration=iteration,
            msgs=len(messages),
            write_mode=write_mode,
        )
        response = await client.messages.create(
            model=settings.ai_chat_model,
            max_tokens=settings.ai_max_response_tokens,
            system=system_prompt,
            tools=available_tools,
            messages=messages,
        )
        if hasattr(response, "usage"):
            total_input_tokens += getattr(response.usage, "input_tokens", 0) or 0
            total_output_tokens += getattr(response.usage, "output_tokens", 0) or 0

        # Si no hay tool_use → Claude terminó, devolvemos
        stop_reason = getattr(response, "stop_reason", None)
        if stop_reason != "tool_use":
            text_blocks = [
                b.text for b in response.content if getattr(b, "type", None) == "text"
            ]
            answer = "\n".join(text_blocks).strip() or "(sin respuesta)"
            return {
                "answer": answer,
                "tool_calls": tool_calls_trace,
                "iterations": iteration + 1,
                "tokens": {
                    "input": total_input_tokens,
                    "output": total_output_tokens,
                },
            }

        # Procesar tool_use blocks
        # Claude puede pedir múltiples tools en una respuesta
        assistant_blocks = []
        tool_results = []
        for block in response.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                assistant_blocks.append({"type": "text", "text": block.text})
            elif btype == "tool_use":
                tool_name = block.name
                tool_input = block.input or {}
                handler = available_handlers.get(tool_name)
                if handler is None:
                    result_data = {"error": f"Tool '{tool_name}' no implementada"}
                else:
                    try:
                        result_data = await handler(db, tool_input)
                    except Exception as exc:
                        log.exception("ai_tools.tool_failed", tool=tool_name)
                        result_data = {"error": f"{type(exc).__name__}: {exc}"}

                tool_calls_trace.append(
                    {
                        "tool": tool_name,
                        "input": tool_input,
                        "output_preview": json.dumps(result_data, default=str)[:500],
                    }
                )
                assistant_blocks.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": tool_name,
                        "input": tool_input,
                    }
                )
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result_data, default=str),
                    }
                )

        # Append a la conversación: assistant turn + user tool_results
        messages.append({"role": "assistant", "content": assistant_blocks})
        messages.append({"role": "user", "content": tool_results})

    # Si llegamos acá, agotamos iterations sin respuesta final
    return {
        "answer": (
            "Se alcanzó el límite de iteraciones sin obtener una respuesta "
            "final. Probá reformular la pregunta."
        ),
        "tool_calls": tool_calls_trace,
        "iterations": max_iterations,
        "tokens": {"input": total_input_tokens, "output": total_output_tokens},
    }


# ---------------------------------------------------------------------------
# V5.2 — AI Auto-Acta (genera draft de acta Comité Vigilancia)
# ---------------------------------------------------------------------------


ACTA_SYSTEM_PROMPT = """Sos asistente operativo de Cehta Capital. Tu tarea es
generar un BORRADOR de acta del Comité de Vigilancia del FIP CEHTA ESG basado
en el snapshot regulatorio del Fondo.

REGLAS DEL ACTA:
- Estructura formal en español neutro estilo notarial chileno.
- Secciones obligatorias:
    1. Encabezado (fecha, asistentes en blanco para llenar luego)
    2. Estado regulatorio del Fondo (resumen de cumplimiento)
    3. Vencidos sin entregar (CADA UNO con su contexto + acción propuesta)
    4. Próximos vencimientos (priorización para próximo período)
    5. Compliance por empresa beneficiaria (si hay datos)
    6. Acuerdos sugeridos (bullets accionables que el Comité puede tomar)
    7. Cierre estándar
- Usá MARKDOWN — `##` para secciones, listas, tablas si aplica.
- NO inventes datos. Usá EXACTAMENTE los números que te paso en CONTEXTO.
- Para vencidos, sugerí explicación posible (auditor pendiente, validación
  externa, etc.) pero marcá explícitamente "[A confirmar]".
- En "Acuerdos sugeridos", pensá como abogado: qué decisiones formales
  debería tomar el Comité dado este estado.
- Largo objetivo: 600-1200 palabras. Suficiente para acta formal pero
  legible.
- Cerrá con un placeholder claro: "_Acta firmada por: [Pendiente]_".

CONTEXTO (datos REALES del sistema):
{context}
"""


async def generate_acta_cv_draft(
    db: AsyncSession,
    *,
    empresa: str | None = None,
) -> dict[str, Any]:
    """Genera un draft de acta del Comité de Vigilancia con AI.

    Recopila los datos reales del reporte regulatorio (vencidos, próximos,
    counts, compliance) y se los pasa a Claude como CONTEXTO. El modelo
    devuelve un markdown listo para revisar y firmar.

    Si `empresa` se pasa, el acta se genera scoped a esa empresa.

    Devuelve `{markdown, tokens, generated_at}` o lanza
    `AiToolsNotConfigured` si Anthropic no está activado.
    """
    client = _anthropic_client()
    today = date.today()

    # ── Pull data crudo ──────────────────────────────────────────────
    empresa_filter = ""
    empresa_params: dict[str, Any] = {}
    if empresa:
        empresa_filter = (
            " AND (subcategoria = :emp OR extra->>'empresa_codigo' = :emp)"
        )
        empresa_params["emp"] = empresa

    counts_rows = (
        await db.execute(
            text(
                "SELECT estado, COUNT(*) AS n FROM app.entregables_regulatorios "
                f"WHERE 1=1 {empresa_filter} "
                "GROUP BY estado"
            ),
            empresa_params,
        )
    ).mappings().all()
    counts = {r["estado"]: int(r["n"]) for r in counts_rows}

    vencidos = (
        await db.execute(
            text(
                f"""
                SELECT entregable_id, nombre, categoria, periodo, fecha_limite,
                       responsable, estado, motivo_no_entrega,
                       referencia_normativa,
                       (CURRENT_DATE - fecha_limite) AS dias_vencido
                FROM app.entregables_regulatorios
                WHERE estado IN ('pendiente','en_proceso','no_entregado')
                  AND fecha_limite < CURRENT_DATE
                  {empresa_filter}
                ORDER BY fecha_limite ASC
                LIMIT 30
                """
            ),
            empresa_params,
        )
    ).mappings().all()

    proximos = (
        await db.execute(
            text(
                f"""
                SELECT nombre, categoria, periodo, fecha_limite,
                       responsable, referencia_normativa,
                       (fecha_limite - CURRENT_DATE) AS dias
                FROM app.entregables_regulatorios
                WHERE estado IN ('pendiente','en_proceso')
                  AND fecha_limite >= CURRENT_DATE
                  AND fecha_limite <= (CURRENT_DATE + INTERVAL '30 days')
                  {empresa_filter}
                ORDER BY fecha_limite ASC
                LIMIT 30
                """
            ),
            empresa_params,
        )
    ).mappings().all()

    # Tasa de cumplimiento YTD
    ytd_total = (
        await db.execute(
            text(
                "SELECT COUNT(*) FROM app.entregables_regulatorios "
                "WHERE fecha_limite >= "
                "make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1) "
                f"AND fecha_limite < CURRENT_DATE {empresa_filter}"
            ),
            empresa_params,
        )
    ).scalar() or 0
    ytd_entregados = (
        await db.execute(
            text(
                "SELECT COUNT(*) FROM app.entregables_regulatorios "
                "WHERE fecha_limite >= "
                "make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1) "
                "AND fecha_limite < CURRENT_DATE "
                f"AND estado = 'entregado' {empresa_filter}"
            ),
            empresa_params,
        )
    ).scalar() or 0
    tasa = round(
        ytd_entregados / ytd_total * 100, 1
    ) if ytd_total > 0 else 100.0

    # Compliance per empresa (solo si NO está filtrado a una)
    compliance_data: list[dict[str, Any]] = []
    if not empresa:
        from app.api.v1.entregables import _compute_compliance_for_empresa

        emp_rows = (
            await db.execute(
                text(
                    """
                    SELECT DISTINCT
                      COALESCE(extra->>'empresa_codigo', subcategoria) AS emp
                    FROM app.entregables_regulatorios
                    WHERE COALESCE(extra->>'empresa_codigo', subcategoria) IS NOT NULL
                    """
                )
            )
        ).all()
        for r in emp_rows:
            if not r[0]:
                continue
            grade = await _compute_compliance_for_empresa(db, r[0])
            compliance_data.append(grade.model_dump())
        compliance_data.sort(key=lambda g: g["tasa_a_tiempo"], reverse=True)

    # ── Build context para Claude ────────────────────────────────────
    ctx_lines: list[str] = []
    ctx_lines.append(f"FECHA HOY: {today.isoformat()}")
    if empresa:
        ctx_lines.append(f"ÁMBITO: Acta scoped a empresa {empresa}")
    else:
        ctx_lines.append("ÁMBITO: Acta general del FIP CEHTA ESG (todas empresas)")
    ctx_lines.append("")
    ctx_lines.append(f"TASA DE CUMPLIMIENTO YTD: {tasa}%")
    ctx_lines.append(
        f"TOTAL ENTREGABLES YTD: {ytd_total} · ENTREGADOS: {ytd_entregados}"
    )
    ctx_lines.append("")
    ctx_lines.append("COUNTS POR ESTADO:")
    for est, n in counts.items():
        ctx_lines.append(f"  - {est}: {n}")
    ctx_lines.append("")
    ctx_lines.append(f"VENCIDOS SIN ENTREGAR ({len(vencidos)}):")
    if not vencidos:
        ctx_lines.append("  (ninguno — buen desempeño)")
    for v in vencidos:
        ctx_lines.append(
            f"  - [{v['categoria']}] {v['nombre']} · período {v['periodo']} · "
            f"vencido hace {v['dias_vencido']} días · responsable: "
            f"{v['responsable']} · estado: {v['estado']}"
            + (
                f" · motivo: {v['motivo_no_entrega']}"
                if v.get("motivo_no_entrega")
                else ""
            )
            + (
                f" · ref: {v['referencia_normativa']}"
                if v.get("referencia_normativa")
                else ""
            )
        )
    ctx_lines.append("")
    ctx_lines.append(f"PRÓXIMOS 30 DÍAS ({len(proximos)}):")
    for p in proximos[:15]:
        ctx_lines.append(
            f"  - [{p['categoria']}] {p['nombre']} · {p['fecha_limite']} · "
            f"en {p['dias']} días · responsable: {p['responsable']}"
        )
    if len(proximos) > 15:
        ctx_lines.append(f"  ... y {len(proximos) - 15} más")
    ctx_lines.append("")
    if compliance_data:
        ctx_lines.append("COMPLIANCE POR EMPRESA (YTD):")
        for c in compliance_data:
            ctx_lines.append(
                f"  - {c['empresa_codigo']}: grade {c['grade']} · "
                f"{c['tasa_a_tiempo']}% a tiempo · "
                f"{c['entregados_a_tiempo']} de {c['total']} cumplidos"
            )

    context_str = "\n".join(ctx_lines)
    system_prompt = ACTA_SYSTEM_PROMPT.format(context=context_str)

    user_msg = (
        f"Generá el borrador del acta del Comité de Vigilancia "
        f"con fecha {today.strftime('%d de %B de %Y')}"
        + (f" para la empresa {empresa}" if empresa else " del FIP CEHTA ESG")
        + ". Usá los datos del CONTEXTO. Devolveme solo el markdown del acta."
    )

    response = await client.messages.create(
        model=settings.ai_chat_model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}],
    )

    text_blocks = [
        b.text for b in response.content if getattr(b, "type", None) == "text"
    ]
    markdown = "\n".join(text_blocks).strip()

    tokens_in = (
        getattr(response.usage, "input_tokens", 0) if hasattr(response, "usage") else 0
    )
    tokens_out = (
        getattr(response.usage, "output_tokens", 0) if hasattr(response, "usage") else 0
    )

    log.info(
        "ai_tools.acta_generated",
        empresa=empresa,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        chars=len(markdown),
    )

    return {
        "markdown": markdown,
        "generated_at": datetime.now(UTC).isoformat(),
        "empresa": empresa,
        "tokens": {"input": tokens_in, "output": tokens_out},
        "data_summary": {
            "ytd_total": ytd_total,
            "ytd_entregados": ytd_entregados,
            "tasa_cumplimiento": tasa,
            "vencidos_count": len(vencidos),
            "proximos_30d_count": len(proximos),
        },
    }


# ---------------------------------------------------------------------------
# V5.3 — Anomaly Detection (insights proactivos vía LLM)
# ---------------------------------------------------------------------------


INSIGHTS_SYSTEM_PROMPT = """Sos analista financiero senior de Cehta Capital
revisando el estado regulatorio del FIP CEHTA ESG. Tu tarea es identificar
ANOMALÍAS o PATRONES PREOCUPANTES que requieran atención del equipo
operativo, MÁS allá de lo obvio (vencidos ya están en otra alerta).

QUÉ ES UN INSIGHT VÁLIDO:
- Una empresa con compliance que cae sostenidamente vs trimestres anteriores
- Concentración de vencimientos críticos en una sola categoría/empresa
- Patrones de "no entregados" repetidos en mismo template
- Responsables sobrecargados (>20% del pipeline activo)
- Brechas anticipadas (próximo cierre F22 con muchos preparatorios pendientes)
- Mejoras ejemplares dignas de replicar (empresa que pasó de C a A)

QUÉ NO ES INSIGHT:
- "Hay 3 entregables vencidos" (eso ya lo ve el dashboard)
- "Recordá entregar el F29" (no es análisis)
- Cosas obvias que cualquiera leyendo el dashboard ya sabe

FORMATO DE SALIDA: JSON ARRAY de insights, MÁXIMO 5. Cada insight:
{
  "severity": "critical" | "warning" | "info" | "positive",
  "title": "string corto y específico (max 80 chars)",
  "body": "explicación 1-3 oraciones con números reales",
  "recommendation": "acción concreta sugerida (1 oración)",
  "tags": ["empresa:CSL", "categoria:CMF", etc opcional]
}

Si el sistema está sano y no hay nada relevante que destacar, devolveme
un array vacío `[]`. NO inventes anomalías para llenar.

Devolveme SOLO el JSON, sin markdown ni explicación adicional.

CONTEXTO:
{context}
"""


async def generate_insights(
    db: AsyncSession,
) -> dict[str, Any]:
    """Corre análisis con Claude sobre el estado actual y devuelve insights.

    Pull de datos consolidados (compliance, distribuciones, tendencias) →
    Claude identifica patrones → devuelve JSON array de insights priorizados.

    Pensado para correrse nightly via cron + persistir en BD para que el
    operador encuentre los insights en su próxima sesión.
    """
    client = _anthropic_client()

    # Compliance per empresa (ya tiene la lógica)
    from app.api.v1.entregables import _compute_compliance_for_empresa

    emp_rows = (
        await db.execute(
            text(
                """
                SELECT DISTINCT
                  COALESCE(extra->>'empresa_codigo', subcategoria) AS emp
                FROM app.entregables_regulatorios
                WHERE COALESCE(extra->>'empresa_codigo', subcategoria) IS NOT NULL
                """
            )
        )
    ).all()
    compliance_data = []
    for r in emp_rows:
        if not r[0]:
            continue
        g = await _compute_compliance_for_empresa(db, r[0])
        compliance_data.append(g.model_dump())

    # Distribución por responsable (carga de trabajo)
    workload_rows = (
        await db.execute(
            text(
                """
                SELECT responsable,
                       COUNT(*) FILTER (WHERE estado IN ('pendiente','en_proceso')) AS pendientes,
                       COUNT(*) FILTER (
                         WHERE estado IN ('pendiente','en_proceso')
                           AND fecha_limite <= (CURRENT_DATE + INTERVAL '30 days')
                       ) AS proximos_30d,
                       COUNT(*) FILTER (
                         WHERE estado IN ('pendiente','en_proceso')
                           AND fecha_limite < CURRENT_DATE
                       ) AS vencidos,
                       COUNT(*) FILTER (WHERE estado = 'no_entregado') AS no_entregados
                FROM app.entregables_regulatorios
                GROUP BY responsable
                HAVING COUNT(*) > 0
                ORDER BY pendientes DESC
                """
            )
        )
    ).mappings().all()

    # Templates con mayor tasa de "no entregado" históricamente
    failed_templates_rows = (
        await db.execute(
            text(
                """
                SELECT id_template, categoria,
                       COUNT(*) FILTER (WHERE estado = 'no_entregado') AS fallas,
                       COUNT(*) AS total
                FROM app.entregables_regulatorios
                WHERE fecha_limite < CURRENT_DATE
                  AND fecha_limite >= (CURRENT_DATE - INTERVAL '12 months')
                GROUP BY id_template, categoria
                HAVING COUNT(*) FILTER (WHERE estado = 'no_entregado') > 0
                ORDER BY (
                  COUNT(*) FILTER (WHERE estado = 'no_entregado')::float / COUNT(*)
                ) DESC
                LIMIT 10
                """
            )
        )
    ).mappings().all()

    # Concentración de vencimientos por categoría próximos 30d
    concentration_rows = (
        await db.execute(
            text(
                """
                SELECT categoria, COUNT(*) AS pendientes_30d
                FROM app.entregables_regulatorios
                WHERE estado IN ('pendiente','en_proceso')
                  AND fecha_limite >= CURRENT_DATE
                  AND fecha_limite <= (CURRENT_DATE + INTERVAL '30 days')
                GROUP BY categoria
                ORDER BY pendientes_30d DESC
                """
            )
        )
    ).mappings().all()

    # Build context
    ctx_lines: list[str] = []
    ctx_lines.append("=== COMPLIANCE PER EMPRESA YTD ===")
    if not compliance_data:
        ctx_lines.append("(sin datos)")
    for c in sorted(compliance_data, key=lambda g: g["tasa_a_tiempo"]):
        ctx_lines.append(
            f"- {c['empresa_codigo']}: grade {c['grade']} · "
            f"{c['tasa_a_tiempo']}% a tiempo · "
            f"{c['entregados_a_tiempo']}/{c['total']} cumplidos · "
            f"{c['no_entregados']} no entregados"
        )

    ctx_lines.append("\n=== CARGA POR RESPONSABLE ===")
    for w in workload_rows:
        ctx_lines.append(
            f"- {w['responsable']}: {w['pendientes']} pendientes, "
            f"{w['proximos_30d']} en 30d, {w['vencidos']} vencidos, "
            f"{w['no_entregados']} no entregados (histórico)"
        )

    ctx_lines.append("\n=== TEMPLATES CON FALLAS HISTÓRICAS (12 meses) ===")
    if not failed_templates_rows:
        ctx_lines.append("(sin templates problemáticos)")
    for ft in failed_templates_rows:
        rate = (
            int(ft["fallas"]) / int(ft["total"]) * 100
            if ft["total"]
            else 0
        )
        ctx_lines.append(
            f"- {ft['id_template']} ({ft['categoria']}): "
            f"{ft['fallas']} fallas en {ft['total']} ocurrencias = {rate:.0f}%"
        )

    ctx_lines.append("\n=== CONCENTRACIÓN PRÓXIMOS 30 DÍAS ===")
    for c in concentration_rows:
        ctx_lines.append(f"- {c['categoria']}: {c['pendientes_30d']} pendientes")

    context_str = "\n".join(ctx_lines)
    system_prompt = INSIGHTS_SYSTEM_PROMPT.format(context=context_str)

    response = await client.messages.create(
        model=settings.ai_chat_model,
        max_tokens=2048,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": (
                    "Analizá el contexto provisto e identificá hasta 5 "
                    "insights relevantes (anomalías o patrones preocupantes). "
                    "Devolveme solo el JSON array."
                ),
            }
        ],
    )

    text_blocks = [
        b.text for b in response.content if getattr(b, "type", None) == "text"
    ]
    raw = "\n".join(text_blocks).strip()

    # Parsing defensivo — Claude puede envolver en markdown code fence
    cleaned = raw
    if cleaned.startswith("```"):
        # Strip primer y último fence
        lines = cleaned.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    insights: list[dict[str, Any]] = []
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            insights = [
                {
                    "severity": str(it.get("severity", "info")),
                    "title": str(it.get("title", "")),
                    "body": str(it.get("body", "")),
                    "recommendation": str(it.get("recommendation", "")),
                    "tags": list(it.get("tags", [])) if isinstance(it.get("tags"), list) else [],
                }
                for it in parsed
                if isinstance(it, dict) and it.get("title")
            ][:5]
    except json.JSONDecodeError as exc:
        log.warning(
            "ai_tools.insights.parse_fail",
            err=str(exc),
            raw_preview=raw[:300],
        )

    tokens_in = (
        getattr(response.usage, "input_tokens", 0)
        if hasattr(response, "usage")
        else 0
    )
    tokens_out = (
        getattr(response.usage, "output_tokens", 0)
        if hasattr(response, "usage")
        else 0
    )

    log.info(
        "ai_tools.insights.generated",
        count=len(insights),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )

    return {
        "insights": insights,
        "generated_at": datetime.now(UTC).isoformat(),
        "tokens": {"input": tokens_in, "output": tokens_out},
        "raw_response": raw if not insights else None,  # debug si fail
    }
