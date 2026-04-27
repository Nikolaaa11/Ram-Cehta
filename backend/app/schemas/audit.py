"""Schemas pydantic para audit (etl_runs, rejected_rows, data quality report)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, computed_field, model_validator


class EtlRunRead(BaseModel):
    run_id: str
    started_at: datetime
    finished_at: datetime | None
    source_file: str
    source_hash: str | None
    rows_extracted: int | None
    rows_loaded: int | None
    rows_rejected: int | None
    status: str | None
    error_message: str | None
    triggered_by: str | None

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def duration_seconds(self) -> float | None:
        """Duración total de la corrida en segundos. None si aún corre."""
        if self.finished_at is None:
            return None
        return (self.finished_at - self.started_at).total_seconds()

    @model_validator(mode="before")
    @classmethod
    def _coerce_uuid(cls, data: Any) -> Any:
        # SQLAlchemy puede devolver UUID o str según driver; normalizamos a str.
        if isinstance(data, dict):
            rid = data.get("run_id")
            if rid is not None and not isinstance(rid, str):
                data["run_id"] = str(rid)
        return data


class RejectedRowRead(BaseModel):
    rejected_id: int
    run_id: str | None
    source_sheet: str | None
    source_row_num: int | None
    reason: str | None
    raw_data: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _coerce_uuid(cls, data: Any) -> Any:
        if isinstance(data, dict):
            rid = data.get("run_id")
            if rid is not None and not isinstance(rid, str):
                data["run_id"] = str(rid)
        return data


# ---------------------------------------------------------------------
# Data Quality Report
# ---------------------------------------------------------------------

Severity = Literal["info", "warning", "critical"]


class DataQualityIssue(BaseModel):
    code: str  # 'oc_emitida_old', 'f29_vencida_unpaid', ...
    severity: Severity
    count: int
    description: str
    resource: str | None = None  # ruta API para drill-down


class DataQualityReport(BaseModel):
    generated_at: datetime
    issues: list[DataQualityIssue]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total_issues(self) -> int:
        return sum(i.count for i in self.issues)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def critical_count(self) -> int:
        return sum(i.count for i in self.issues if i.severity == "critical")
