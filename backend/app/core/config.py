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
    dropbox_refresh_token: str | None = None
    dropbox_client_id: str | None = None
    dropbox_client_secret: str | None = None
    dropbox_redirect_uri: str | None = None
    frontend_url: str = "https://cehta-capital.vercel.app"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_cors(cls, v: str | list[str]) -> list[str]:
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
