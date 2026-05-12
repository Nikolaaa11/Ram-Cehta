"""Modelos `core.vouchers` + sub-tablas (V5).

Ver migración 0035 para schema completo. Los invariantes contables
están a nivel DB (triggers Postgres) — los modelos solo declaran las
columnas y relaciones.

`metadata` no aplica acá porque los vouchers no tienen JSONB libre
(toda la info es estructurada). Los IDs son BIGSERIAL.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Voucher(Base):
    __tablename__ = "vouchers"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    voucher_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    codigo: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )

    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, server_default="DRAFT", nullable=False)

    fecha_documento: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_contable: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_ejecucion: Mapped[date | None] = mapped_column(Date)

    glosa: Mapped[str] = mapped_column(Text, nullable=False)

    total_debit: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), server_default="0", nullable=False
    )
    total_credit: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), server_default="0", nullable=False
    )
    moneda: Mapped[str] = mapped_column(Text, server_default="CLP", nullable=False)
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))

    contraparte_rut: Mapped[str | None] = mapped_column(Text)
    contraparte_nombre: Mapped[str | None] = mapped_column(Text)
    contraparte_tipo: Mapped[str | None] = mapped_column(Text)

    doc_tributario_tipo: Mapped[str | None] = mapped_column(Text)
    doc_tributario_folio: Mapped[str | None] = mapped_column(Text)
    doc_tributario_sii_track_id: Mapped[str | None] = mapped_column(Text)

    banco: Mapped[str | None] = mapped_column(Text)
    banco_cuenta_alias: Mapped[str | None] = mapped_column(Text)
    movimiento_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("core.movimientos.movimiento_id")
    )

    threshold_aplicado: Mapped[bool] = mapped_column(
        server_default="false", nullable=False
    )

    reversal_of: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("core.vouchers.voucher_id")
    )
    reversed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("core.vouchers.voucher_id")
    )

    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    requested_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    void_reason: Mapped[str | None] = mapped_column(Text)

    nubox_folio: Mapped[str | None] = mapped_column(Text)
    nubox_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    nubox_status: Mapped[str | None] = mapped_column(Text)
    nubox_error: Mapped[str | None] = mapped_column(Text)

    # V5++ ola AM — Campos Nubox-form
    forma_pago: Mapped[str | None] = mapped_column(Text)
    fecha_vencimiento: Mapped[date | None] = mapped_column(Date)
    documento_dropbox_path: Mapped[str | None] = mapped_column(Text)

    # V5++ ola CE — Origen del voucher (manual/nubox_form/ai_import/csv/etc).
    # NULL = legacy. Ver migration 0055_voucher_source.
    source: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relaciones
    lines: Mapped[list[VoucherLine]] = relationship(
        "VoucherLine",
        back_populates="voucher",
        cascade="all, delete-orphan",
        order_by="VoucherLine.line_number",
    )
    attachments: Mapped[list[VoucherAttachment]] = relationship(
        "VoucherAttachment",
        back_populates="voucher",
        cascade="all, delete-orphan",
    )
    approvals: Mapped[list[VoucherApproval]] = relationship(
        "VoucherApproval",
        back_populates="voucher",
        cascade="all, delete-orphan",
        order_by="VoucherApproval.order_num",
    )


class VoucherLine(Base):
    __tablename__ = "voucher_lines"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    line_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    voucher_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.vouchers.voucher_id", ondelete="CASCADE"),
        nullable=False,
    )
    line_number: Mapped[int] = mapped_column(nullable=False)

    cuenta_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.plan_cuentas.codigo"), nullable=False
    )
    proyecto_codigo: Mapped[str | None] = mapped_column(
        Text, ForeignKey("core.proyectos_contables.codigo")
    )
    area_codigo: Mapped[str | None] = mapped_column(
        Text, ForeignKey("core.areas.codigo")
    )

    debit: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), server_default="0", nullable=False
    )
    credit: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), server_default="0", nullable=False
    )

    descripcion: Mapped[str | None] = mapped_column(Text)
    iva_tratamiento: Mapped[str | None] = mapped_column(Text)
    iva_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    neto_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    balance_treatment: Mapped[str] = mapped_column(
        Text, server_default="NA", nullable=False
    )

    # V5++ ola AM — Separación Información Contable vs Financiera del form Nubox
    tipo_imputacion: Mapped[str] = mapped_column(
        Text, server_default="NA", nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    voucher: Mapped[Voucher] = relationship("Voucher", back_populates="lines")


class VoucherAttachment(Base):
    __tablename__ = "voucher_attachments"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    attachment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    voucher_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.vouchers.voucher_id", ondelete="CASCADE"),
        nullable=False,
    )
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    dropbox_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_hash: Mapped[str | None] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    uploaded_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    voucher: Mapped[Voucher] = relationship("Voucher", back_populates="attachments")


class VoucherApproval(Base):
    __tablename__ = "voucher_approvals"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    approval_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    voucher_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.vouchers.voucher_id", ondelete="CASCADE"),
        nullable=False,
    )
    approver_user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    order_num: Mapped[int] = mapped_column(nullable=False)
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    signed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    signature_hash: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    comments: Mapped[str | None] = mapped_column(Text)

    voucher: Mapped[Voucher] = relationship("Voucher", back_populates="approvals")
