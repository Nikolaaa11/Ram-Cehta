"""Secretaria AI de Tareas (V4 fase 8.2).

"Claudia" — la secretaria virtual que le da a Nicolás (operativo en
Cehta Capital) un brief diario de prioridades en máximo 80 palabras y
5 bullets accionables.

Diseño:
- Recibe `UpcomingTasksResponse` (output del endpoint upcoming-tasks)
- Lo resume a un context compacto (no manda los 2.900 hitos a Claude,
  solo: top 10 vencidas, top 5 hoy, top 8 esta semana, stats)
- Llama Anthropic con un system prompt afinado para tono cálido +
  accionable + chileno-rioplatense
- Devuelve un objeto con `bullets[]` parseado + raw_text + metadata

Cache: 30 minutos en memoria (por token hash del input). Los datos del
Kanban no cambian tanto en 30min como para justificar refresh más fino,
y le ahorra ~500ms + tokens al usuario.

Soft-fail: si `ANTHROPIC_API_KEY` falta, levanta `SecretariaAINotConfigured`
para que el endpoint devuelva 503 y el frontend oculte el panel.
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import date
from typing import Any

from app.core.config import settings
from app.schemas.avance import HitoConContexto, UpcomingTasksResponse


class SecretariaAINotConfigured(Exception):
    """`ANTHROPIC_API_KEY` ausente — endpoint debe devolver 503."""


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 30 * 60  # 30 min


def _anthropic_client() -> Any:
    if not settings.anthropic_api_key:
        raise SecretariaAINotConfigured("ANTHROPIC_API_KEY no configurado")
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=settings.anthropic_api_key)


# ---------------------------------------------------------------------------
# System prompt — el corazón de la Secretaria
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Sos "Claudia", la secretaria virtual de proyectos de
Cehta Capital. Tu rol: darle a Nicolás (operativo, no-ingeniero) un brief
de prioridades del día en MENOS de 80 palabras totales.

DESTINATARIO: Nicolás Rietta — operativo en FIP CEHTA ESG (fondo de inversión
chileno con 9 empresas en portafolio). Lee el dashboard 5-10 veces/día. No
quiere lista exhaustiva — quiere saber qué hacer YA.

ESTILO:
- Tono cálido pero directo. Castellano chileno-rioplatense informal-formal.
- Cada bullet empieza con un VERBO de acción ("Revisar", "Llamar a", "Validar",
  "Confirmar", "Cerrar").
- Si nombrás persona: nombre + apellido + empresa entre paréntesis.
- Si nombrás fecha: relativa ("mañana", "viernes", "esta semana"), nunca ISO.
- Si la prioridad es URGENTE (vencida hace >3 días), prefijo "🚨".
- Si hay buena noticia (completados >5 esta sem o tendencia +), incluí UN
  bullet positivo al final con "🎉".
- Output: máximo 5 bullets. Siempre como lista markdown con "- " al inicio.
- Sin headers, sin párrafos, sin disclaimers, sin "Aquí están tus prioridades:"

NO HAGAS:
- No expliques tu razonamiento.
- No listes todos los hitos del contexto — elegí los TOP 5 más críticos.
- No repitas información entre bullets.
- No inventes datos que no estén en el contexto.
- No uses tecnicismos ("KPI", "stakeholder"). Hablás como una secretaria
  experimentada, no como consultor.

EJEMPLO de output bueno:
- 🚨 Felipe Zúñiga (DTE) tiene 4 hitos vencidos hace 8 días — agendá 1on1 mañana
- Revisar postulación PTEC con Claudia González (TRONGKAI) antes del viernes
- Validar specs INMEDIC con Patricia Lillo (EVOQUE) — reunión hoy a las 15hs
- RHO0003 Codegua va al 12% con cierre en 2 semanas, riesgo crítico
- 🎉 TRONGKAI cerró 4 hitos esta semana, +25% vs semana pasada

EJEMPLO de output malo (NO hagas esto):
- "Aquí están tus 5 prioridades..." (no preámbulos)
- "El proyecto RHO0001 está en estado en_progreso..." (técnico, sin acción)
- "Revisar todos los hitos pendientes" (genérico, sin nombre/empresa)
- 6+ bullets (más de 5)
"""


# ---------------------------------------------------------------------------
# Resumen del context (para no mandar 2900 hitos a Claude)
# ---------------------------------------------------------------------------


def _hito_a_linea(h: HitoConContexto, hoy: date) -> str:
    """Una sola línea por hito con todo el contexto que la AI necesita."""
    fecha_str = ""
    if h.fecha_planificada:
        dias = (h.fecha_planificada - hoy).days
        if dias < 0:
            fecha_str = f"VENCIDA hace {abs(dias)}d"
        elif dias == 0:
            fecha_str = "HOY"
        elif dias == 1:
            fecha_str = "mañana"
        else:
            fecha_str = f"en {dias}d"
    else:
        fecha_str = "sin fecha"

    encargado_str = f" · {h.encargado}" if h.encargado else ""
    progreso_str = f" · {h.progreso_pct}%" if h.progreso_pct > 0 else ""
    return (
        f"  [{h.empresa_codigo}/{h.proyecto_nombre[:30]}] {h.nombre[:60]}"
        f" ({fecha_str}{encargado_str}{progreso_str})"
    )


def _resumir_para_ai(data: UpcomingTasksResponse) -> str:
    """Convierte el response del Kanban a texto compacto para el prompt.

    Limita a top 10 vencidas + top 5 hoy + top 8 esta semana + top 5
    próximas 2 semanas. Eso da ~28 hitos máx, suficiente contexto para
    que Claude priorice 5 sin gastar tokens innecesarios.
    """
    hoy = date.today()
    lines: list[str] = []

    s = data.stats
    lines.append("# Estado actual del portafolio")
    lines.append(f"Total hitos activos: {s.total_pendientes + s.total_en_progreso}")
    lines.append(f"  - Pendientes: {s.total_pendientes}")
    lines.append(f"  - En progreso: {s.total_en_progreso}")
    lines.append(f"Vencidas: {s.vencidas_count}")
    lines.append(
        f"Completadas última semana: {s.completadas_ultima_semana} "
        f"(vs {s.completadas_semana_anterior} la anterior)"
    )
    if s.completadas_ultima_semana > s.completadas_semana_anterior:
        delta = s.completadas_ultima_semana - s.completadas_semana_anterior
        lines.append(f"  → Tendencia POSITIVA (+{delta} hitos cerrados)")
    elif s.completadas_ultima_semana < s.completadas_semana_anterior:
        delta = s.completadas_semana_anterior - s.completadas_ultima_semana
        lines.append(f"  → Tendencia NEGATIVA (-{delta} hitos cerrados)")

    if s.owners_top:
        lines.append("\nTop owners por carga (vencidas + pendientes):")
        for o in s.owners_top[:5]:
            lines.append(
                f"  - {o.encargado}: {o.pendientes_count} pendientes, "
                f"{o.vencidas_count} vencidas"
            )

    if data.vencidas:
        lines.append(f"\n# Hitos VENCIDOS (top 10 de {len(data.vencidas)}):")
        for h in data.vencidas[:10]:
            lines.append(_hito_a_linea(h, hoy))

    if data.hoy:
        lines.append(f"\n# Hitos para HOY (top 5 de {len(data.hoy)}):")
        for h in data.hoy[:5]:
            lines.append(_hito_a_linea(h, hoy))

    if data.esta_semana:
        lines.append(
            f"\n# Hitos ESTA SEMANA (top 8 de {len(data.esta_semana)}):"
        )
        for h in data.esta_semana[:8]:
            lines.append(_hito_a_linea(h, hoy))

    if data.proximas_2_semanas:
        lines.append(
            f"\n# Próximas 2 semanas (top 5 de {len(data.proximas_2_semanas)}):"
        )
        for h in data.proximas_2_semanas[:5]:
            lines.append(_hito_a_linea(h, hoy))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def _cache_key(data: UpcomingTasksResponse) -> str:
    """Hash determinista del contexto para detectar si los datos cambiaron."""
    payload = {
        "stats": data.stats.model_dump(mode="json"),
        "vencidas_ids": [h.hito_id for h in data.vencidas[:10]],
        "hoy_ids": [h.hito_id for h in data.hoy[:5]],
        "semana_ids": [h.hito_id for h in data.esta_semana[:8]],
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _cache_get(key: str) -> dict[str, Any] | None:
    entry = _CACHE.get(key)
    if entry is None:
        return None
    ts, payload = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    _CACHE[key] = (time.time(), payload)


# ---------------------------------------------------------------------------
# Parsing del output
# ---------------------------------------------------------------------------


def _parse_bullets(text: str) -> list[str]:
    """Extrae bullets del output markdown de Claude.

    Acepta tanto "- " como "* " como inicio. Filtra líneas vacías y
    headers. Cap a 5 bullets defensivamente (en caso de que el modelo
    se haya pasado).
    """
    bullets: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith(("- ", "* ", "• ")):
            bullets.append(line[2:].strip())
        elif line[0:2].isdigit() and line[2:3] in {".", ")"}:
            # "1. xxx" o "1) xxx"
            bullets.append(line[3:].strip())
    return bullets[:5]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def generate_secretaria_brief(
    upcoming: UpcomingTasksResponse,
) -> dict[str, Any]:
    """Genera el brief de la Secretaria AI a partir del Kanban data.

    Returns:
        {
            "bullets": ["Revisar X...", "🚨 Llamar a Y...", ...],
            "raw_text": "<output completo de Claude>",
            "model": "claude-sonnet-4-5",
            "cached": bool,
            "input_summary": "<context que se mandó>"
        }

    Raises:
        SecretariaAINotConfigured si la API key falta.
    """
    cache_key = _cache_key(upcoming)
    cached = _cache_get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    client = _anthropic_client()
    context = _resumir_para_ai(upcoming)

    response = await client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=400,  # 80 palabras + algo de holgura
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Datos del portafolio de Nicolás hoy:\n\n{context}\n\nDame las 5 prioridades de acción.",
            }
        ],
    )

    raw_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            raw_text += block.text

    bullets = _parse_bullets(raw_text)
    payload = {
        "bullets": bullets,
        "raw_text": raw_text.strip(),
        "model": "claude-sonnet-4-5",
        "input_summary": context[:2000],  # truncar para no inflar el response
        "cached": False,
    }
    _cache_set(cache_key, payload)
    return payload


def clear_cache() -> int:
    """Test/admin helper: vacía el cache y devuelve cuántas entries borró."""
    n = len(_CACHE)
    _CACHE.clear()
    return n
