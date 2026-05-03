"""Informes LP — AI Service (V4 fase 9 — Sprint 2).

Genera narrativas personalizadas para informes a inversionistas usando
Anthropic Claude. Tres prompts especializados:

1. Hero — saludo personalizado + KPI destacado + 1-2 oraciones de contexto
2. Empresa Showcase — storytelling de cada empresa del portafolio
3. CTA — llamado a acción adaptado al perfil del LP

Cache: 7 días en memoria por hash determinista de (lp_id, periodo, tipo,
empresas_destacadas, kpis_snapshot). El GP puede forzar regeneración con
endpoint dedicado.

Soft-fail: si `ANTHROPIC_API_KEY` falta, levantamos
`InformesLpAINotConfigured` para que el endpoint devuelva 503 y el caller
use templates Jinja2 fallback (impl en endpoint).
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime
from typing import Any

from app.core.config import settings


class InformesLpAINotConfigured(Exception):
    """`ANTHROPIC_API_KEY` ausente — caller debe usar fallback template."""


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 días


def _anthropic_client() -> Any:
    if not settings.anthropic_api_key:
        raise InformesLpAINotConfigured("ANTHROPIC_API_KEY no configurado")
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=settings.anthropic_api_key)


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT_HERO = """Sos copywriter senior de Cehta Capital, FIP CEHTA ESG
(fondo de inversión chileno con 9 empresas en portafolio).

Tu tarea: generar la narrativa HERO de un informe a un LP específico.
Es lo PRIMERO que ve. Tiene que enganchar en <5 segundos.

INPUT que recibís:
- Datos del LP: nombre, aporte (CLP), empresas en cartera, perfil
- KPIs del portafolio: AUM, proyectos, hitos, % avance global
- Período del informe (Q1 2026, etc.)
- Tono solicitado (ejecutivo / narrativo / técnico)

OUTPUT — JSON estricto con esta estructura:
{
  "titulo": "Una frase impactante con el nombre del LP. Máx 12 palabras.",
  "subtitulo": "1-2 oraciones que cuenten la historia. Máx 30 palabras.",
  "kpi_destacado": {
    "valor_numero": 23.4,
    "valor_string": "23.4%",
    "label": "ROI YTD"
  }
}

ESTILO NO NEGOCIABLE:
- Saludo con NOMBRE del LP siempre. Nunca "Estimado inversionista".
- Cuantitativo: cada oración con un número concreto.
- Castellano chileno-rioplatense formal. Tono confiado pero no arrogante.
- 30 palabras máximo en subtítulo.
- NO exclamaciones. NO superlativos vacíos ("excelente", "increíble").
- NO empezar con "Estimado", "Es un placer", "Como sabés".

EJEMPLOS BUENOS:
{
  "titulo": "Sebastián, tu portafolio creció 23.4%.",
  "subtitulo": "Ganamos al benchmark FIP por 11 puntos. RHO inauguró BESS Panimávida un mes antes de plan.",
  "kpi_destacado": {"valor_numero": 23.4, "valor_string": "23.4%", "label": "ROI YTD"}
}

{
  "titulo": "Pablo, $623K bien puestos.",
  "subtitulo": "Tu aporte de $500K se valorizó 24.6% en 18 meses con la cobertura ESG más fuerte del FIP chileno.",
  "kpi_destacado": {"valor_numero": 623000000, "valor_string": "$623M CLP", "label": "Tu posición actual"}
}

EJEMPLOS MALOS (NO HAGAS):
- "¡Qué excelente trimestre! Estamos muy contentos..."
- "Como sabés, los mercados energéticos..."
- "Tu portafolio sigue creciendo." (vacío)
- "Estimado Sebastián..." (formal sin alma)

Si no hay datos suficientes (ej: LP no tiene empresas asignadas), enfocate
en el portafolio agregado: "Sebastián, el portafolio CEHTA tiene X
proyectos en curso y Y MW renovables".
"""


SYSTEM_PROMPT_EMPRESA = """Sos periodista de TechCrunch escribiendo para
una memoria de fondo de inversión.

Tu tarea: contar EN UNA HISTORIA lo más relevante que pasó en una empresa
del portafolio en el período.

INPUT que recibís:
- Empresa: código + razón social + RUT + tipo de negocio
- KPIs del trimestre (proyectos, hitos, avance%)
- Hitos completados últimos 90 días (top 5)
- Último hito completado: nombre + fecha + encargado
- Encargado más activo

OUTPUT — JSON estricto:
{
  "headline": "Una oración impactante de 8-12 palabras.",
  "parrafo": "2-3 oraciones que cuenten la historia. Máx 60 palabras.",
  "metricas_destacadas": [
    {"valor": "8MW", "label": "instalados"},
    {"valor": "99.4%", "label": "uptime"},
    {"valor": "4.200", "label": "hogares"}
  ]
}

ESTILO:
- Concreto, no abstracto. "Inauguramos BESS Panimávida" mejor que
  "avances en infraestructura".
- Si hay un milestone que demoró, mencionarlo brevemente — la confianza
  se construye con honestidad.
- Si nombrás persona: nombre completo + apellido si está disponible.
- Si nombrás fecha: relativa cuando se pueda ("este enero", "el viernes
  pasado").
- NO marketing. NO "líder", "innovador", "revolucionario".

EJEMPLOS BUENOS:
{
  "headline": "Inauguramos 8MW en Panimávida un mes antes.",
  "parrafo": "El BESS RHO entró a operación en enero, dos meses antes de plan original. Javier Álvarez lideró el avance del SAA y la conexión a SEC. Ya genera energía para 4.200 hogares chilenos.",
  "metricas_destacadas": [
    {"valor": "8 MW", "label": "instalados"},
    {"valor": "99.4%", "label": "uptime mes 1"},
    {"valor": "4.200", "label": "hogares cubiertos"}
  ]
}

EJEMPLOS MALOS:
- "RHO continúa avanzando en sus proyectos." (vacío)
- "Una empresa innovadora que está revolucionando el sector." (marketing)
- "Hubo varios hitos." (genérico)

Si la empresa tiene 0 hitos completados en el período, sé honesto:
"Trimestre de planificación. Definimos 3 proyectos para arrancar en abril."
"""


SYSTEM_PROMPT_CTA = """Sos consultor estratégico de Cehta Capital. Generá
un CTA específico para este LP basado en su perfil y comportamiento.

INPUT:
- Datos del LP: nombre, aporte, empresas en cartera, perfil
- Si vino via share (parent_token presente)
- Tipo de informe (periodico, pitch_inicial, etc.)

OUTPUT — JSON estricto:
{
  "cta_principal": "Frase de 6-10 palabras",
  "cta_secundario_1": "Frase",
  "cta_secundario_2": "Frase",
  "razonamiento_breve": "1 oración explicando por qué elegiste esto"
}

LÓGICA POR PERFIL:

Si LP es "esg_focused":
  - Principal: enfatizar impacto social/ambiental
  - Ej: "Sumate al fondo que descarboniza Chile"

Si LP es "agresivo":
  - Principal: enfatizar pipeline + upside
  - Ej: "Conocé los 3 proyectos en cierre Q2"

Si LP es "conservador":
  - Principal: enfatizar estabilidad + cobertura
  - Ej: "Validá nuestra estrategia de cobertura con Camilo"

Si LP es nuevo (estado='pipeline'):
  - Principal: agendar primer café
  - Ej: "Agendá 30min con Camilo para conocer el fondo"

Si LP vino via share (parent_token presente):
  - Principal: validar la introducción
  - Ej: "Quien te recomendó Cehta sabe lo que hace. Hablemos."

Si LP es activo y NO ha aumentado posición en 12 meses:
  - Principal: aumento de posición
  - Ej: "Tu posición performa al 24%. Hablemos de aumentar."

ESTILO:
- 6-10 palabras por CTA principal.
- Imperativo o sugerencia directa, nunca pregunta vaga.
- Sin "¡". Sin "increíble".

EJEMPLOS BUENOS:
{
  "cta_principal": "Agendá café con Camilo (30 min)",
  "cta_secundario_1": "Aumentar tu posición",
  "cta_secundario_2": "Compartir con un colega que invierte",
  "razonamiento_breve": "LP activo con perfil ESG, oferta café principal y aumento como secundario."
}
"""


# ---------------------------------------------------------------------------
# Helpers — context building
# ---------------------------------------------------------------------------


def _format_clp(amount: float | int | None) -> str | None:
    """Formatea CLP con separadores de miles y compactación."""
    if amount is None:
        return None
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.0f}M"
    if amount >= 1_000:
        return f"${amount / 1_000:.0f}K"
    return f"${int(amount)}"


def _build_hero_context(
    lp: dict[str, Any] | None,
    portfolio_kpis: dict[str, Any],
    periodo: str | None,
) -> str:
    """Construye el context string para SYSTEM_PROMPT_HERO."""
    lines = [f"PERÍODO: {periodo or 'sin periodo definido'}"]
    if lp:
        lines.append(f"\nLP DESTINATARIO:")
        lines.append(f"  Nombre: {lp.get('nombre_completo', 'sin nombre')}")
        lines.append(f"  Email: {lp.get('email', 'no provisto')}")
        lines.append(f"  Empresa/Family Office: {lp.get('empresa', 'no provisto')}")
        lines.append(f"  Perfil: {lp.get('perfil_inversor', 'no clasificado')}")
        lines.append(
            f"  Aporte total: {_format_clp(lp.get('aporte_total_clp')) or 'no registrado'}"
        )
        lines.append(
            f"  Aporte actual integrado: {_format_clp(lp.get('aporte_actual_clp')) or 'no registrado'}"
        )
        lines.append(
            f"  Empresas en cartera: {', '.join(lp.get('empresas_invertidas') or []) or 'ninguna'}"
        )
        lines.append(f"  Estado: {lp.get('estado', 'pipeline')}")
        lines.append(
            f"  Intereses: {', '.join(lp.get('intereses') or []) or 'no definidos'}"
        )
    else:
        lines.append(
            "\nLP DESTINATARIO: No vinculado (informe genérico para pitch inicial)"
        )

    lines.append(f"\nKPIs DEL PORTAFOLIO (al {datetime.utcnow().date().isoformat()}):")
    lines.append(
        f"  AUM total: {_format_clp(portfolio_kpis.get('aum_total_clp')) or 'no disponible'}"
    )
    lines.append(
        f"  Empresas con actividad: {portfolio_kpis.get('empresas_con_actividad', 0)} de {portfolio_kpis.get('empresas_total_catalogo', 9)}"
    )
    lines.append(
        f"  Proyectos totales: {portfolio_kpis.get('proyectos_total', 0)}"
    )
    lines.append(
        f"  Proyectos en progreso: {portfolio_kpis.get('proyectos_en_progreso', 0)}"
    )
    lines.append(f"  Hitos completados: {portfolio_kpis.get('hitos_completados', 0)} de {portfolio_kpis.get('hitos_total', 0)}")
    lines.append(
        f"  Avance global: {portfolio_kpis.get('pct_avance_global', 0)}%"
    )
    return "\n".join(lines)


def _build_empresa_context(empresa_data: dict[str, Any]) -> str:
    """Construye el context para SYSTEM_PROMPT_EMPRESA."""
    lines = [
        f"EMPRESA: {empresa_data.get('codigo', '?')} — {empresa_data.get('razon_social', '?')}",
        f"RUT: {empresa_data.get('rut', '?')}",
        "",
    ]

    metricas = empresa_data.get("metricas", {})
    lines.append("MÉTRICAS:")
    lines.append(f"  Proyectos: {metricas.get('proyectos_count', 0)} ({metricas.get('proyectos_en_progreso', 0)} en progreso, {metricas.get('proyectos_completados', 0)} completados)")
    lines.append(f"  Hitos: {metricas.get('hitos_completados', 0)}/{metricas.get('hitos_total', 0)} = {metricas.get('pct_avance', 0)}% avance")
    if empresa_data.get("encargado_top"):
        lines.append(f"  Encargado más activo: {empresa_data['encargado_top']}")

    ultimo = empresa_data.get("ultimo_hito_completado")
    if ultimo:
        lines.append("")
        lines.append("ÚLTIMO HITO COMPLETADO:")
        lines.append(f"  Nombre: {ultimo.get('nombre', '?')}")
        lines.append(f"  Fecha: {ultimo.get('fecha', '?')}")
        lines.append(f"  Proyecto: {ultimo.get('proyecto', '?')}")
        if ultimo.get("encargado"):
            lines.append(f"  Encargado: {ultimo['encargado']}")

    proyectos = empresa_data.get("proyectos", [])[:5]
    if proyectos:
        lines.append("")
        lines.append("TOP 5 PROYECTOS:")
        for p in proyectos:
            lines.append(
                f"  - {p.get('codigo', '?')} {p.get('nombre', '?')}: "
                f"{p.get('estado', '?')}, {p.get('progreso_pct', 0)}% avance"
            )

    return "\n".join(lines)


def _build_cta_context(
    lp: dict[str, Any] | None,
    parent_token: str | None,
    tipo: str,
) -> str:
    lines = [f"TIPO INFORME: {tipo}"]
    if parent_token:
        lines.append(f"VIENE VIA SHARE: sí (parent_token: {parent_token[:8]}…)")
    else:
        lines.append("VIENE VIA SHARE: no")

    if lp:
        lines.append(f"\nLP:")
        lines.append(f"  Nombre: {lp.get('nombre_completo', '?')}")
        lines.append(f"  Estado: {lp.get('estado', 'pipeline')}")
        lines.append(f"  Perfil: {lp.get('perfil_inversor', 'no clasificado')}")
        lines.append(
            f"  Aporte: {_format_clp(lp.get('aporte_total_clp')) or 'no registrado'}"
        )
        lines.append(
            f"  Empresas en cartera: {', '.join(lp.get('empresas_invertidas') or []) or 'ninguna'}"
        )
    else:
        lines.append("\nLP: no vinculado (pitch inicial)")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def _cache_key(*parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str)
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
# Anthropic call helper
# ---------------------------------------------------------------------------


async def _call_anthropic_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 600,
) -> dict[str, Any]:
    """Llama a Claude esperando JSON estricto. Hace 1 retry si parsea mal."""
    client = _anthropic_client()
    for attempt in range(2):
        response = await client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        raw = ""
        for block in response.content:
            if hasattr(block, "text"):
                raw += block.text
        raw = raw.strip()
        # Claude a veces wraps en markdown ```json ... ```
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip().rstrip("`").strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            if attempt == 0:
                # Reintento con instrucción más explícita
                user = (
                    "Tu output anterior no fue JSON parseable. Responde SOLO "
                    "con JSON válido sin markdown wrappers ni texto fuera del JSON. "
                    + user
                )
            else:
                # Devolver raw como fallback
                return {"_raw": raw, "_parse_error": True}
    return {}


# ---------------------------------------------------------------------------
# Entry points públicos
# ---------------------------------------------------------------------------


async def generate_hero(
    lp: dict[str, Any] | None,
    portfolio_kpis: dict[str, Any],
    periodo: str | None,
    *,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Genera narrativa hero con cache de 7 días."""
    cache_key = _cache_key(
        "hero",
        lp.get("nombre_completo") if lp else None,
        portfolio_kpis.get("aum_total_clp"),
        portfolio_kpis.get("hitos_completados"),
        periodo,
    )
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return {**cached, "_cached": True}

    context = _build_hero_context(lp, portfolio_kpis, periodo)
    user = f"Datos para el hero del informe:\n\n{context}\n\nGenerá el JSON con titulo, subtitulo y kpi_destacado."

    payload = await _call_anthropic_json(
        SYSTEM_PROMPT_HERO, user, max_tokens=400
    )
    payload["_cached"] = False
    _cache_set(cache_key, payload)
    return payload


async def generate_empresa_showcase(
    empresa_data: dict[str, Any],
    *,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Genera narrativa de UNA empresa (showcase storytelling)."""
    cache_key = _cache_key(
        "empresa",
        empresa_data.get("codigo"),
        empresa_data.get("metricas", {}).get("hitos_completados"),
        (empresa_data.get("ultimo_hito_completado") or {}).get("nombre"),
    )
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return {**cached, "_cached": True}

    context = _build_empresa_context(empresa_data)
    user = f"Datos de la empresa:\n\n{context}\n\nGenerá el JSON con headline, parrafo y metricas_destacadas."

    payload = await _call_anthropic_json(
        SYSTEM_PROMPT_EMPRESA, user, max_tokens=500
    )
    payload["_cached"] = False
    _cache_set(cache_key, payload)
    return payload


async def generate_cta(
    lp: dict[str, Any] | None,
    parent_token: str | None,
    tipo: str,
    *,
    use_cache: bool = True,
) -> dict[str, Any]:
    cache_key = _cache_key(
        "cta",
        lp.get("nombre_completo") if lp else None,
        lp.get("estado") if lp else None,
        lp.get("perfil_inversor") if lp else None,
        bool(parent_token),
        tipo,
    )
    if use_cache:
        cached = _cache_get(cache_key)
        if cached is not None:
            return {**cached, "_cached": True}

    context = _build_cta_context(lp, parent_token, tipo)
    user = f"Datos del LP:\n\n{context}\n\nGenerá el JSON con cta_principal, cta_secundario_1, cta_secundario_2 y razonamiento_breve."

    payload = await _call_anthropic_json(
        SYSTEM_PROMPT_CTA, user, max_tokens=400
    )
    payload["_cached"] = False
    _cache_set(cache_key, payload)
    return payload


async def generate_full_informe_narrativa(
    *,
    lp: dict[str, Any] | None,
    portfolio_kpis: dict[str, Any],
    empresas_data: dict[str, dict[str, Any]],
    periodo: str | None,
    parent_token: str | None,
    tipo: str,
) -> dict[str, Any]:
    """Genera el bundle completo de narrativas para un informe.

    Devuelve la estructura `secciones` lista para persistir en
    `app.informes_lp.secciones`. Si Anthropic muere mid-call,
    devuelve lo que pudo generar + flag `_partial=True` por sección.
    """
    bundle: dict[str, Any] = {}

    # Hero
    try:
        bundle["hero"] = await generate_hero(lp, portfolio_kpis, periodo)
    except Exception as e:  # noqa: BLE001
        bundle["hero"] = {
            "_error": str(e),
            "titulo": f"Hola, {lp.get('nombre') if lp else 'Inversionista'}.",
            "subtitulo": "Tu informe del portafolio.",
            "kpi_destacado": None,
        }

    # Empresas
    bundle["empresas"] = {}
    for cod, data in empresas_data.items():
        try:
            bundle["empresas"][cod] = await generate_empresa_showcase(data)
        except Exception as e:  # noqa: BLE001
            bundle["empresas"][cod] = {
                "_error": str(e),
                "headline": data.get("razon_social", cod),
                "parrafo": "Datos del trimestre disponibles en el dashboard.",
                "metricas_destacadas": [],
            }

    # CTA
    try:
        bundle["cta"] = await generate_cta(lp, parent_token, tipo)
    except Exception as e:  # noqa: BLE001
        bundle["cta"] = {
            "_error": str(e),
            "cta_principal": "Agendá café con Camilo (30 min)",
            "cta_secundario_1": "Aumentar tu posición",
            "cta_secundario_2": "Compartir con un colega",
        }

    bundle["_meta"] = {
        "generated_at": datetime.utcnow().isoformat(),
        "ai_model": "claude-sonnet-4-5",
        "ai_generated": True,
    }
    return bundle


def clear_cache() -> int:
    """Helper test/admin: limpia el cache y devuelve cuántas entries borró."""
    n = len(_CACHE)
    _CACHE.clear()
    return n
