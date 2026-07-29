from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.value_objects.iva import calcular_iva


class OCDetalleCreate(BaseModel):
    item: int = Field(..., ge=1)
    descripcion: str = Field(..., min_length=1)
    # `unidad` — unidad de medida de la línea (Un, Gl, Días, m3, m2, ml, Kg,
    # Ton, Hrs, Global…). La columna core.ordenes_compra_detalle.unidad ya
    # existía y el PDF v2 la imprime en la columna "Un.", pero este schema no
    # la aceptaba: el POST la descartaba silenciosamente y SIEMPRE se guardaba
    # NULL. Es texto libre (no enum) porque cada rubro usa su nomenclatura:
    # el form ofrece sugerencias pero el operador puede escribir la suya.
    # Opcional con default: si no viene, el PDF imprime "—".
    unidad: str | None = Field(default=None, max_length=20)
    precio_unitario: Decimal = Field(..., gt=0)
    cantidad: Decimal = Field(..., gt=0)


class OCDetalleRead(BaseModel):
    detalle_id: int
    item: int
    descripcion: str
    # Default None a propósito: el modelo ORM OrdenCompraDetalle no mapea la
    # columna `unidad` (se agregó por SQL directo), así que al construir el
    # schema desde la entidad el atributo no existe y pydantic aplica el
    # default. El endpoint la hidrata con una query aparte.
    unidad: str | None = None
    precio_unitario: Decimal
    cantidad: Decimal
    total_linea: Decimal | None

    model_config = {"from_attributes": True}


class OrdenCompraCreate(BaseModel):
    numero_oc: str = Field(..., min_length=1, max_length=50)
    empresa_codigo: str
    proveedor_id: int | None = None
    # Opcionales: si no viene proveedor_id pero si proveedor_rut+nombre,
    # el endpoint auto-resuelve o auto-crea el proveedor en core.proveedores
    # (mismo patron que el form Nubox de vouchers).
    proveedor_rut: str | None = None
    proveedor_nombre: str | None = None
    fecha_emision: date
    validez_dias: int = Field(default=30, ge=1)
    moneda: Literal["CLP", "UF", "USD"] = "CLP"
    # Neto opcional: si no viene, lo computamos como Σ(items.precio_unitario *
    # items.cantidad). Esto evita que el frontend tenga que calcular el neto
    # — viola disciplina 2 (cálculos de negocio en FE). Si viene, validamos
    # que coincida (±1 peso de tolerancia por redondeo).
    neto: Decimal | None = Field(default=None, ge=0)
    forma_pago: str | None = None
    plazo_pago: str | None = None
    plazo_entrega: str | None = None
    observaciones: str | None = None
    items: list[OCDetalleCreate] = Field(..., min_length=1)

    @model_validator(mode="after")
    def compute_totals(self) -> "OrdenCompraCreate":
        # Disciplina 2: si el FE no manda neto (lo recomendado), lo computamos
        # del único source-of-truth (items). Si manda algo distinto a la suma,
        # ignoramos el valor del FE y usamos el server-side.
        from decimal import Decimal as _D

        items_total = sum(
            (
                (it.precio_unitario or _D(0)) * (it.cantidad or _D(1))
                for it in self.items
            ),
            _D(0),
        )
        # Siempre asignamos el computado: el campo neto persistido refleja
        # los items, no lo que el FE haya enviado. Idempotente.
        self.neto = items_total if items_total > 0 else (self.neto or _D(0))
        return self

    @property
    def iva_calculado(self) -> Decimal:
        return calcular_iva(self.neto or Decimal("0")) if self.moneda == "CLP" else Decimal("0")

    @property
    def total_calculado(self) -> Decimal:
        return (self.neto or Decimal("0")) + self.iva_calculado


class OrdenCompraRead(BaseModel):
    oc_id: int
    numero_oc: str
    empresa_codigo: str
    proveedor_id: int | None
    fecha_emision: date
    validez_dias: int
    moneda: str
    neto: Decimal
    iva: Decimal
    total: Decimal
    forma_pago: str | None
    plazo_pago: str | None
    plazo_entrega: str | None = None
    observaciones: str | None
    estado: str
    pdf_url: str | None
    items: list[OCDetalleRead]
    created_at: datetime
    updated_at: datetime
    allowed_actions: list[str] = []

    model_config = {"from_attributes": True}


class OrdenCompraListItem(BaseModel):
    oc_id: int
    numero_oc: str
    empresa_codigo: str
    proveedor_id: int | None
    fecha_emision: date
    moneda: str
    neto: Decimal
    total: Decimal
    estado: str
    pdf_url: str | None
    allowed_actions: list[str] = []

    model_config = {"from_attributes": True}


class EstadoUpdateRequest(BaseModel):
    estado: Literal["emitida", "pagada", "anulada", "parcial"]


class DuplicateOcRequest(BaseModel):
    """Body de POST /ordenes-compra/{oc_id}/duplicate.

    Solo se piden los campos que TIENEN que ser distintos del original:
    - numero_oc obligatorio (no auto-generamos para no inventar correlativos)
    - fecha_emision opcional (default = hoy en la zona del backend)
    - observaciones opcional (si querés pisar las del original)

    Todo lo demas (proveedor, items, montos, moneda, forma_pago, plazo_pago,
    validez_dias) se copia tal cual desde la OC original.
    """

    numero_oc: str = Field(..., min_length=1, max_length=50)
    fecha_emision: date | None = None
    observaciones: str | None = None


class OrdenCompraUpdate(BaseModel):
    """PATCH /ordenes-compra/{id} — edición de campos no-críticos.

    Sólo permite editar campos operativos. Los campos críticos
    (numero_oc, empresa_codigo, fecha_emision, neto, iva, total, estado)
    NO se pueden modificar acá: 'numero_oc' rompería trazabilidad,
    los montos se recalculan al crear, y 'estado' tiene su propio endpoint
    `PATCH /{id}/estado` con validación de transiciones.

    Si el body trae alguno de esos campos, son ignorados (extra='ignore'
    por default en pydantic v2). Si querés que sea hard-fail, cambiar a
    `model_config = {"extra": "forbid"}`.
    """

    forma_pago: str | None = None
    plazo_pago: str | None = None
    plazo_entrega: str | None = None
    validez_dias: int | None = Field(default=None, ge=1)
    observaciones: str | None = None
    pdf_url: str | None = None

    model_config = {"extra": "ignore"}
