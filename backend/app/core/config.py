from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, PostgresDsn, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_PLACEHOLDER_VALUES: frozenset[str] = frozenset(
    {
        "change-me-dev-only",
        "REPLACE_AFTER_ROTATION",
        "",
    }
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "cehta-backend"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"],
    )
    # Round 78 — regex opcional para autorizar previews de Vercel del proyecto
    # sin tener que actualizar CORS_ORIGINS cada vez que cambia el slug del
    # deploy. Default cubre los previews del project name
    # "ram-cehta-nicolasrietta-1798s-projects" + branch deploys con prefijo.
    # Si se cambia el project name en Vercel, ajustar acá.
    cors_origin_regex: str | None = Field(
        # Round 86 — regex actualizado: el frontend canonico tambien
        # responde en https://ram-cehta.vercel.app (sin sufijo). El regex
        # anterior solo cubria ram-cehta-XXX (con guion + texto), lo cual
        # rompia CORS desde esa URL.
        default=r"^https://(cehta-capital|ram-cehta(-[a-z0-9-]+)?)\.vercel\.app$",
    )

    database_url: PostgresDsn
    alembic_database_url: str | None = None

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str

    secret_key: str = "change-me-dev-only"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    # Modelo activo a 2026-05. Claude 3.5 Sonnet (oct 2024) está deprecated.
    # Sonnet 4.5 es el sweet spot calidad/velocidad/costo para actas + chat.
    # Se puede override via env AI_CHAT_MODEL.
    ai_chat_model: str = "claude-sonnet-4-5-20250929"
    ai_embedding_model: str = "text-embedding-3-small"
    ai_max_context_chunks: int = 10
    ai_max_response_tokens: int = 2048
    dropbox_refresh_token: str | None = None
    dropbox_client_id: str | None = None
    dropbox_client_secret: str | None = None
    dropbox_redirect_uri: str | None = None
    frontend_url: str = "https://cehta-capital.vercel.app"

    # In-app notifications (V3 fase 8) — si está activo, en startup corre el
    # generador de alertas (F29 due, contratos due, OCs estancadas) en task de
    # background. Default False — usualmente esto se hace via cron externo.
    generate_alerts_on_startup: bool = False

    # BCN/CMF API (V4 fase 1 — currency conversion). Si no está seteada,
    # el servicio cae a `mindicador.cl` (free, no key, formato distinto).
    # Soft-fail: si ambas APIs fallan el endpoint devuelve None y loggea.
    bcn_api_key: str | None = None

    # Email (Resend) — V3 fase 3+4. Soft-fail: si no hay api_key, los flows
    # que envían email loggean warning pero no rompen.
    resend_api_key: str | None = None
    email_from: str = "noreply@cehta.cl"
    email_admin_recipients: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
    )

    # Inbox processing (V5+) — IMAP poll de contactocehta@gmail.com.
    # Cuando un email entra:
    #   1. El servicio lo lee via IMAP (UNSEEN)
    #   2. Lo clasifica con Claude (factura proveedor, consulta cliente,
    #      pago confirmado, spam, otro)
    #   3. Genera un draft de respuesta (NO se manda — Nicolás revisa
    #      en /admin/inbox y aprueba antes de enviar)
    #   4. Si tiene PDF adjunto, lo guarda en Dropbox /00-Inbox/
    #      y extrae texto para indexarlo
    # Soft-fail: si las creds no están seteadas, /admin/inbox-process
    # devuelve 503 sin romper boot.
    inbox_imap_host: str = "imap.gmail.com"
    inbox_imap_port: int = 993
    inbox_imap_user: str | None = None  # ej: contactocehta@gmail.com
    inbox_imap_password: str | None = None  # Gmail App Password (no la del usuario)
    inbox_imap_folder: str = "INBOX"
    inbox_classify_model: str = "claude-sonnet-4-5-20250929"
    inbox_max_messages_per_run: int = 50

    # R152QQQQ — Feature flag para el generador de PDF de OC.
    #   "v1" → reportlab (legacy, programmatic). Default.
    #   "v2" → HTML+CSS Jinja2 + WeasyPrint (templates de oc-pagos-platform).
    # Cambiar via env var OC_PDF_RENDERER en Fly secrets:
    #   fly secrets set OC_PDF_RENDERER=v2 -a cehta-backend
    oc_pdf_renderer: str = "v1"

    # R152UUUU — Redirect global de emails de OC para fase de prueba.
    # Si está set (CSV de emails), TODOS los TO/CC se sobreescriben con
    # estos valores. Primer email queda como TO, demás como CC. Sin tocar
    # la config real de cada empresa. Setear:
    #   fly secrets set OC_EMAIL_TEST_REDIRECT_TO="a@x.cl,b@y.cl"
    # Quitar (volver a modo prod):
    #   fly secrets unset OC_EMAIL_TEST_REDIRECT_TO
    oc_email_test_redirect_to: str | None = None

    # V5++ ola O: Slack notifications opcional. Si está seteado, eventos
    # críticos (voucher.approved con monto >X, notif_sii del SII, F29
    # vencido) se envían también a un canal Slack via incoming webhook.
    # URL formato: https://hooks.slack.com/services/T.../B.../xxx
    # Soft-fail: sin URL, no se envía nada (no rompe).
    slack_webhook_url: str | None = None
    # Threshold en CLP — solo notificar vouchers aprobados sobre este monto.
    # Si 0, todos los voucher.approved disparan ping. Default $5M.
    slack_voucher_min_amount: int = 5_000_000

    # V4 fase 9.4: Booking URL (Cal.com / Calendly / Google appointments).
    # Si está seteada, los Informes LP muestran un botón "Agendar 30 min con
    # {owner}" que abre un modal con iframe en vez de mailto:. Multiplica
    # conversion porque el LP agenda con 1 click sin salir del informe.
    # Ejemplos válidos:
    #   - https://cal.com/guido-rietta/30min
    #   - https://calendly.com/guido-cehta/cafe-fip
    #   - https://calendar.app.google/abc123
    booking_url: str | None = None
    booking_owner_name: str = "Guido Rietta"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("email_admin_recipients", mode="before")
    @classmethod
    def split_admin_recipients(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @model_validator(mode="after")
    def _validate_production_secrets(self) -> "Settings":
        """En producción, prohibir placeholders y secretos débiles."""
        if not self.is_production:
            return self

        errors: list[str] = []

        if self.secret_key in _PLACEHOLDER_VALUES or len(self.secret_key) < 32:
            errors.append("SECRET_KEY debe ser un valor random ≥32 chars (openssl rand -hex 32)")

        if self.supabase_jwt_secret in _PLACEHOLDER_VALUES or len(self.supabase_jwt_secret) < 32:
            errors.append("SUPABASE_JWT_SECRET inválido o placeholder")

        if self.supabase_service_role_key in _PLACEHOLDER_VALUES:
            errors.append("SUPABASE_SERVICE_ROLE_KEY no configurado")

        if any(o == "*" for o in self.cors_origins):
            errors.append("CORS_ORIGINS='*' está prohibido en producción (allow_credentials=True)")

        if not self.cors_origins or all(
            o.startswith("http://localhost") for o in self.cors_origins
        ):
            errors.append("CORS_ORIGINS debe incluir el dominio público del frontend")

        if errors:
            raise ValueError(
                "Configuración de producción inválida:\n  - " + "\n  - ".join(errors)
            )

        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
