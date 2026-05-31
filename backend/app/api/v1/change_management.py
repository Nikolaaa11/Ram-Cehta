"""Round 152t/u/v — Change Management endpoints.

Aplica frameworks del curso "Liderazgo y Gestión del Cambio" (Ray Gallegos):
  - Clase 4 p36: Comunicación bidireccional → /me/feedback (NPS)
  - Clase 2 p41: Mapeo de Actores → /admin/adoption/map
  - Clase 1 p22: Formación continua → /training/modules + /training/complete

Endpoints:
  POST /me/feedback                  — el user envía NPS (score 1-3 + comment)
  GET  /admin/feedback/summary       — admin ve NPS agregado por flujo
  GET  /admin/adoption/map           — clasificación Aliado/Espectador/Detractor
  GET  /training/modules             — lista módulos disponibles + mi progreso
  GET  /training/modules/{slug}      — detalle de un módulo (content + quiz)
  POST /training/complete            — registra completar un módulo (score quiz)
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession

router = APIRouter(tags=["change-management"])


# =====================================================================
# 1) NPS — Comunicación bidireccional (Clase 4 p36)
# =====================================================================


class FeedbackCreate(BaseModel):
    action_type: str = Field(min_length=1, max_length=64)
    score: int = Field(ge=1, le=3)  # 1=difícil 2=ok 3=fácil
    comment: str | None = Field(default=None, max_length=500)
    context: dict[str, Any] | None = None


class FeedbackRead(BaseModel):
    feedback_id: int
    action_type: str
    score: int


@router.post("/me/feedback", response_model=FeedbackRead)
async def submit_feedback(
    body: FeedbackCreate,
    user: CurrentUser,
    db: DBSession,
) -> FeedbackRead:
    """User envía un NPS de 1-3 después de una acción crítica."""
    import json as _json

    row = (await db.execute(
        text("""
            INSERT INTO core.user_feedback (user_id, action_type, score, comment, context)
            VALUES (CAST(:u AS UUID), :a, :s, :c, CAST(:ctx AS JSONB))
            RETURNING feedback_id, action_type, score
        """),
        {
            "u": str(user.sub), "a": body.action_type, "s": body.score,
            "c": body.comment,
            "ctx": _json.dumps(body.context) if body.context else None,
        },
    )).fetchone()
    await db.commit()
    return FeedbackRead(
        feedback_id=row[0], action_type=row[1], score=row[2],
    )


class FeedbackSummary(BaseModel):
    action_type: str
    total: int
    avg_score: float
    pct_positive: float  # % score=3
    pct_negative: float  # % score=1
    last_comments: list[dict[str, Any]]


@router.get("/admin/feedback/summary", response_model=list[FeedbackSummary])
async def feedback_summary(
    user: CurrentUser,
    db: DBSession,
) -> list[FeedbackSummary]:
    """Resumen NPS por flujo. Solo admin."""
    if user.app_role != "admin":
        raise HTTPException(status_code=403, detail="Solo admin")

    rows = (await db.execute(
        text("""
            SELECT
                action_type,
                COUNT(*) AS total,
                AVG(score)::numeric(4,2) AS avg_score,
                ROUND(100.0 * SUM(CASE WHEN score=3 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_positive,
                ROUND(100.0 * SUM(CASE WHEN score=1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_negative,
                (
                    SELECT array_agg(row_to_json(sub) ORDER BY sub.created_at DESC)
                    FROM (
                        SELECT comment, score, created_at::text
                        FROM core.user_feedback uf2
                        WHERE uf2.action_type = uf.action_type
                          AND comment IS NOT NULL
                        ORDER BY created_at DESC
                        LIMIT 5
                    ) sub
                ) AS last_comments
            FROM core.user_feedback uf
            WHERE created_at >= NOW() - INTERVAL '90 days'
            GROUP BY action_type
            ORDER BY total DESC
        """)
    )).fetchall()

    return [
        FeedbackSummary(
            action_type=r[0], total=r[1],
            avg_score=float(r[2] or 0),
            pct_positive=float(r[3] or 0),
            pct_negative=float(r[4] or 0),
            last_comments=list(r[5] or []),
        )
        for r in rows
    ]


# =====================================================================
# 2) Mapa de Adopción (Clase 2 p41 — Mapeo de Actores)
# =====================================================================


class AdoptionRow(BaseModel):
    user_id: str
    email: str
    app_role: str
    empresas: str | None
    last_login: str | None
    days_inactive: int | None
    actions_30d: int
    classification: str  # aliado | espectador | detractor | sin_activacion
    impact_level: str    # A | M | B


@router.get("/admin/adoption/map", response_model=list[AdoptionRow])
async def adoption_map(
    user: CurrentUser,
    db: DBSession,
) -> list[AdoptionRow]:
    """Mapa de Adopción: clasificación Aliado/Espectador/Detractor de cada user.

    Aplicación del Mapeo de Actores del Proceso de Cambio (Ray Gallegos, Clase 2 p41).
    Solo admin.
    """
    if user.app_role != "admin":
        raise HTTPException(status_code=403, detail="Solo admin")

    rows = (await db.execute(
        text("SELECT * FROM core.v_adoption_map")
    )).fetchall()
    return [
        AdoptionRow(
            user_id=str(r[0]), email=r[1], app_role=r[2],
            empresas=r[3],
            last_login=str(r[4]) if r[4] else None,
            days_inactive=int(r[5]) if r[5] is not None else None,
            actions_30d=int(r[6]),
            classification=r[8],
            impact_level=r[9],
        )
        for r in rows
    ]


# =====================================================================
# 3) Centro de Aprendizaje (Clase 1 p22 — Formación Continua)
# =====================================================================


class ModuleListItem(BaseModel):
    module_id: int
    slug: str
    title: str
    description: str | None
    difficulty: str
    duration_min: int
    sort_order: int
    completed: bool
    my_score: int | None


@router.get("/training/modules", response_model=list[ModuleListItem])
async def list_modules(
    user: CurrentUser,
    db: DBSession,
) -> list[ModuleListItem]:
    """Lista módulos + progreso del user actual."""
    rows = (await db.execute(
        text("""
            SELECT
                m.module_id, m.slug, m.title, m.description,
                m.difficulty, m.duration_min, m.sort_order,
                tp.score
            FROM core.training_modules m
            LEFT JOIN core.training_progress tp
              ON tp.module_id = m.module_id
             AND tp.user_id = CAST(:u AS UUID)
            WHERE m.active = TRUE
            ORDER BY m.sort_order
        """),
        {"u": str(user.sub)},
    )).fetchall()
    return [
        ModuleListItem(
            module_id=r[0], slug=r[1], title=r[2], description=r[3],
            difficulty=r[4], duration_min=r[5], sort_order=r[6],
            completed=r[7] is not None,
            my_score=int(r[7]) if r[7] is not None else None,
        )
        for r in rows
    ]


class ModuleDetail(BaseModel):
    module_id: int
    slug: str
    title: str
    description: str | None
    difficulty: str
    duration_min: int
    content_md: str | None
    quiz: list[dict[str, Any]] | None
    my_score: int | None
    completed: bool


@router.get("/training/modules/{slug}", response_model=ModuleDetail)
async def get_module(
    slug: str,
    user: CurrentUser,
    db: DBSession,
) -> ModuleDetail:
    """Detalle de un módulo + content + quiz."""
    row = (await db.execute(
        text("""
            SELECT
                m.module_id, m.slug, m.title, m.description,
                m.difficulty, m.duration_min, m.content_md, m.quiz,
                tp.score
            FROM core.training_modules m
            LEFT JOIN core.training_progress tp
              ON tp.module_id = m.module_id
             AND tp.user_id = CAST(:u AS UUID)
            WHERE m.slug = :s AND m.active = TRUE
        """),
        {"s": slug, "u": str(user.sub)},
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Módulo no encontrado")

    # quiz: para los users normales, devolvemos las preguntas SIN la respuesta correcta
    # (la validación es server-side).
    quiz_raw = row[7] or []
    quiz_public = [
        {"q": q["q"], "options": q["options"]}
        for q in quiz_raw
    ]

    return ModuleDetail(
        module_id=row[0], slug=row[1], title=row[2], description=row[3],
        difficulty=row[4], duration_min=row[5], content_md=row[6],
        quiz=quiz_public,
        my_score=int(row[8]) if row[8] is not None else None,
        completed=row[8] is not None,
    )


class QuizSubmit(BaseModel):
    slug: str
    answers: list[int]  # índice elegido por pregunta


class QuizResult(BaseModel):
    score: int           # 0-100
    correct: int
    total: int
    passed: bool
    completed: bool
    feedback: list[dict[str, Any]]  # por pregunta: {q, your_answer, correct_answer, was_correct}


@router.post("/training/complete", response_model=QuizResult)
async def submit_quiz(
    body: QuizSubmit,
    user: CurrentUser,
    db: DBSession,
) -> QuizResult:
    """User envía sus respuestas. Backend valida y registra progreso si >=70%."""
    row = (await db.execute(
        text("SELECT module_id, quiz FROM core.training_modules WHERE slug=:s AND active=TRUE"),
        {"s": body.slug},
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Módulo no encontrado")
    module_id, quiz = row[0], (row[1] or [])
    if not isinstance(quiz, list) or len(quiz) == 0:
        raise HTTPException(status_code=400, detail="Módulo sin quiz")

    correct = 0
    feedback: list[dict[str, Any]] = []
    for i, q in enumerate(quiz):
        your = body.answers[i] if i < len(body.answers) else -1
        right = q["correct"]
        was_correct = your == right
        if was_correct:
            correct += 1
        feedback.append({
            "q": q["q"],
            "your_answer": your, "your_text": q["options"][your] if 0 <= your < len(q["options"]) else None,
            "correct_answer": right, "correct_text": q["options"][right],
            "was_correct": was_correct,
        })
    score = int(round(100 * correct / len(quiz)))
    passed = score >= 70

    # Solo registra progreso si aprueba (≥70%)
    if passed:
        await db.execute(
            text("""
                INSERT INTO core.training_progress (user_id, module_id, score)
                VALUES (CAST(:u AS UUID), :m, :s)
                ON CONFLICT (user_id, module_id)
                DO UPDATE SET score = GREATEST(training_progress.score, EXCLUDED.score),
                              completed_at = NOW()
            """),
            {"u": str(user.sub), "m": module_id, "s": score},
        )
        await db.commit()

    return QuizResult(
        score=score, correct=correct, total=len(quiz),
        passed=passed, completed=passed, feedback=feedback,
    )
