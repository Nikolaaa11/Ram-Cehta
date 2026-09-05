"""Schemas del registro de egresos CORFO (la sección de Claudia).

Contrato de `docs/MEGAPROMPT_REGISTRO_EGRESOS_CLAUDIA.md` §3.3. Acá viven
también las REGLAS puras (neto+impuesto, reparto vs reparto_pct, cuadre,
fusión de un PUT parcial) porque se prueban sin base de datos y las usan
tanto el POST simple como el batch y el PUT.

Plata: todo entra como `Decimal` (acepta "94352.00", 94352, 94352.5) y
sale como string con 2 decimales. Nunca float: es plata.

Los mensajes de error son en español y van derecho al 422 que ve Claudia,
por eso dicen QUÉ no cuadra y con qué números.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    field_validator,
    model_validator,
)

from app.domain.value_objects.reparto_corfo import (
    ESTADO_OK,
    ETIQUETAS,
    FUENTES,
    RepartoInvalidoError,
    escalar_reparto,
    estado_reparto,
    normalizar_montos,
    pct_desde_montos,
    repartir_por_pct,
)
from app.domain.value_objects.rut import normalize_rut, validate_rut

# ---------------------------------------------------------------------------
# Vocabularios (espejo de los CHECK de core.corfo_registro_egresos)
# ---------------------------------------------------------------------------

TipoDocumento = Literal[
    "FACTURA",
    "FACTURA_EXENTA",
    "BOLETA",
    "BOLETA_HONORARIO",
    "LIQUIDACION",
    "CO_EJECUTOR",
    "INVOICE",
    "OTRO",
]
EstadoPago = Literal["PAGADO", "PARCIAL", "PENDIENTE"]
#: Desde la pantalla sólo se crea con UI o PASTE; IMPORT_EXCEL lo pone el importador.
OrigenPantalla = Literal["UI", "PASTE"]

TIPOS_DOCUMENTO_LABELS: dict[str, str] = {
    "FACTURA": "Factura",
    "FACTURA_EXENTA": "Factura Exenta",
    "BOLETA": "Boleta",
    "BOLETA_HONORARIO": "Boleta Honorario",
    "LIQUIDACION": "Liquidación",
    "CO_EJECUTOR": "Co-Ejecutor",
    "INVOICE": "Invoice",
    "OTRO": "Otro",
}
ESTADOS_PAGO_LABELS: dict[str, str] = {
    "PAGADO": "Pagado",
    "PARCIAL": "Pagado Parcial",
    "PENDIENTE": "Pendiente",
}

#: Columnas que la fila no puede dejar en NULL: mandarlas explícitamente en
#: null dentro de un PUT es un error, no un "limpiar".
_CAMPOS_OBLIGATORIOS = ("fecha", "descripcion", "tipo_documento", "total", "estado_pago")

_CENT = Decimal("0.01")

#: Topes de texto libre (S1). No son reglas de negocio: son el techo para que
#: un cliente roto o malicioso no meta megabytes en una columna TEXT.
MAX_DESCRIPCION = 500
MAX_OBSERVACIONES = 2000
MAX_ADJUNTO_PATH = 500
MAX_TEXTO_CORFO = 200
MAX_MOTIVO_BORRADO = 500
MIN_MOTIVO_BORRADO = 5


# ---------------------------------------------------------------------------
# Helpers de plata
# ---------------------------------------------------------------------------


def a_decimal(v: Any) -> Decimal | None:
    """Cualquier cosa razonable a Decimal con 2 decimales (HALF_UP); None se respeta."""
    if v is None or v == "":
        return None
    if isinstance(v, Decimal):
        d = v
    else:
        try:
            d = Decimal(str(v))
        except Exception as exc:  # el mensaje es para la pantalla, no para el log
            raise ValueError(f"Monto inválido: {v!r}") from exc
    return d.quantize(_CENT, rounding=ROUND_HALF_UP)


def fmt_monto(v: Any) -> str | None:
    """Decimal → '94352.00' (el contrato manda strings, nunca float)."""
    d = a_decimal(v)
    return None if d is None else f"{d:.2f}"


def clp(v: Any) -> str:
    """Pesos chilenos legibles para mensajes: 5645105.95 → '$5.645.105,95'."""
    d = a_decimal(v) or Decimal("0")
    s = f"{abs(d):,.2f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    if s.endswith(",00"):
        s = s[:-3]
    return f"-${s}" if d < 0 else f"${s}"


# ---------------------------------------------------------------------------
# Reglas puras (las comparten POST, batch y PUT)
# ---------------------------------------------------------------------------


def resolver_neto_impuesto(
    total: Decimal, monto_neto: Decimal | None, impuesto: Decimal | None
) -> tuple[Decimal, Decimal]:
    """Devuelve (neto, impuesto) que cuadran con el total, o explica por qué no.

    - Ninguno → neto = total, impuesto = 0 (boleta, liquidación, exenta).
    - Uno solo → el otro es la diferencia (lo que haría Excel), nunca negativo.
    - Los dos → tienen que sumar exactamente el total.
    """
    if monto_neto is None and impuesto is None:
        return total, Decimal("0.00")
    if monto_neto is not None and impuesto is not None:
        if monto_neto + impuesto != total:
            raise ValueError(
                f"Neto {clp(monto_neto)} + impuesto {clp(impuesto)} = "
                f"{clp(monto_neto + impuesto)}, pero el total es {clp(total)}"
            )
        return monto_neto, impuesto
    if monto_neto is not None:
        resto = total - monto_neto
        if resto < 0:
            raise ValueError(f"El neto {clp(monto_neto)} no puede superar el total {clp(total)}")
        return monto_neto, resto
    assert impuesto is not None  # para el tipo: el caso None/None ya salió arriba
    resto = total - impuesto
    if resto < 0:
        raise ValueError(f"El impuesto {clp(impuesto)} no puede superar el total {clp(total)}")
    return resto, impuesto


def resolver_reparto(
    total: Decimal,
    reparto: Mapping[str, Any] | None,
    reparto_pct: Mapping[str, Any] | None,
) -> dict[str, Decimal | None]:
    """Los 4 montos por fuente (o los 4 en None = sin clasificar).

    `reparto` (pesos) y `reparto_pct` (porcentajes) son dos formas de decir lo
    mismo; mandar las dos a la vez es ambiguo y se rechaza. Los porcentajes se
    convierten con el motor (residuo a la fuente mayor); los montos tienen que
    sumar exactamente el total, si no el 422 dice cuánto suman.
    """
    if reparto is not None and reparto_pct is not None:
        raise ValueError(
            "Mandá el reparto en montos (reparto) o en porcentajes (reparto_pct), "
            "no los dos a la vez"
        )
    try:
        if reparto_pct is not None:
            pcts = {f: v for f, v in reparto_pct.items() if v is not None and v != ""}
            if not pcts:
                return {f: None for f in FUENTES}
            return dict(repartir_por_pct(total, pcts))
        montos = normalizar_montos(reparto)
    except RepartoInvalidoError as exc:
        raise ValueError(str(exc)) from exc
    if all(v is None for v in montos.values()):
        return montos
    if estado_reparto(total, montos) != ESTADO_OK:
        suma = sum(((v or Decimal("0")) for v in montos.values()), Decimal("0"))
        raise ValueError(f"El reparto suma {clp(suma)} y el total es {clp(total)}")
    return montos


# ---------------------------------------------------------------------------
# Sub-objetos
# ---------------------------------------------------------------------------


class RepartoIn(BaseModel):
    """Montos (pesos) o porcentajes por fuente, según el campo donde viaje."""

    model_config = ConfigDict(extra="forbid")

    subsidio: Decimal | None = None
    cehta_ptec: Decimal | None = None
    cehta: Decimal | None = None
    trewaox: Decimal | None = None

    @field_validator("subsidio", "cehta_ptec", "cehta", "trewaox", mode="before")
    @classmethod
    def _vacio_es_none(cls, v: Any) -> Any:
        return None if v == "" else v

    def como_dict(self) -> dict[str, Decimal | None]:
        return {f: getattr(self, f) for f in FUENTES}


class RepartoRead(BaseModel):
    subsidio: str
    cehta_ptec: str
    cehta: str
    trewaox: str


class CorfoIn(BaseModel):
    """Las 11 columnas oficiales de Carga_Gastos; todas opcionales (sub-objeto parcial)."""

    model_config = ConfigDict(extra="forbid")

    cuenta: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    item: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    fuente_financiamiento: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    etapa: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    fecha_recepcion: date | None = None
    monto_rendir: Decimal | None = None
    monto_cancelado: Decimal | None = None
    forma_pago: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    glosa: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    receptor_rut: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)
    receptor_nombre: str | None = Field(default=None, max_length=MAX_TEXTO_CORFO)

    @field_validator("monto_rendir", "monto_cancelado", mode="before")
    @classmethod
    def _montos(cls, v: Any) -> Decimal | None:
        return a_decimal(v)

    @field_validator(
        "cuenta", "item", "fuente_financiamiento", "etapa", "forma_pago", "glosa",
        "receptor_rut", "receptor_nombre", mode="before",
    )
    @classmethod
    def _strip(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class CorfoRead(BaseModel):
    cuenta: str | None = None
    item: str | None = None
    fuente_financiamiento: str | None = None
    etapa: str | None = None
    fecha_recepcion: date | None = None
    monto_rendir: str | None = None
    monto_cancelado: str | None = None
    forma_pago: str | None = None
    glosa: str | None = None
    receptor_rut: str | None = None
    receptor_nombre: str | None = None


# ---------------------------------------------------------------------------
# Normalizadores compartidos por Create / Update
# ---------------------------------------------------------------------------


class _NormalizadoresEgreso(BaseModel):
    """Limpieza de campo a campo. `check_fields=False` porque Update no tiene
    todos los campos obligatorios de Create."""

    @field_validator("folio", mode="before", check_fields=False)
    @classmethod
    def _folio_a_str(cls, v: Any) -> str | None:
        # El Excel trae folios numéricos; la BD los guarda como texto.
        if v is None:
            return None
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        s = str(v).strip()
        return s or None

    @field_validator(
        "rut_emisor", "tipo_egreso", "fuente", "proyecto", "observaciones",
        "adjunto_dropbox_path", mode="before", check_fields=False,
    )
    @classmethod
    def _strip_opcional(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("descripcion", mode="before", check_fields=False)
    @classmethod
    def _descripcion_no_vacia(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
            if not v:
                raise ValueError("La descripción no puede quedar vacía")
        return v

    @field_validator("rut_emisor", check_fields=False)
    @classmethod
    def _rut_valido(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not validate_rut(v):
            raise ValueError(f"RUT inválido: {v}")
        limpio = normalize_rut(v)
        # Sin puntos y con guion, dígito verificador en mayúscula: el formato
        # en que el trigger de la BD lo deja y en que lo busca la grilla.
        return f"{limpio[:-1]}-{limpio[-1]}"

    @field_validator("monto_neto", "impuesto", "total", mode="before", check_fields=False)
    @classmethod
    def _montos(cls, v: Any) -> Decimal | None:
        return a_decimal(v)

    @field_validator("total", check_fields=False)
    @classmethod
    def _total_no_negativo(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v < 0:
            raise ValueError(f"El total no puede ser negativo (llegó {clp(v)})")
        return v


# ---------------------------------------------------------------------------
# Create (POST) y fila de batch
# ---------------------------------------------------------------------------


class EgresoBase(_NormalizadoresEgreso):
    fecha: date
    descripcion: str = Field(max_length=MAX_DESCRIPCION)
    rut_emisor: str | None = None
    tipo_documento: TipoDocumento
    folio: str | None = Field(default=None, max_length=50)
    monto_neto: Decimal | None = None
    impuesto: Decimal | None = None
    total: Decimal
    tipo_egreso: str | None = Field(default=None, max_length=120)
    fuente: str | None = Field(default=None, max_length=120)
    proyecto: str | None = Field(default=None, max_length=120)
    estado_pago: EstadoPago = "PENDIENTE"
    fecha_pago: date | None = None
    reparto: RepartoIn | None = None
    reparto_pct: RepartoIn | None = None
    corfo: CorfoIn | None = None
    observaciones: str | None = Field(default=None, max_length=MAX_OBSERVACIONES)
    adjunto_dropbox_path: str | None = Field(default=None, max_length=MAX_ADJUNTO_PATH)
    origen: OrigenPantalla = "UI"

    # Resuelto por `_reglas`: los 4 montos por fuente (o 4 None).
    _montos_reparto: dict[str, Decimal | None] = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def _reglas(self) -> EgresoBase:
        self.monto_neto, self.impuesto = resolver_neto_impuesto(
            self.total, self.monto_neto, self.impuesto
        )
        reparto = self.reparto.como_dict() if self.reparto is not None else None
        pct = self.reparto_pct.como_dict() if self.reparto_pct is not None else None
        self._montos_reparto = resolver_reparto(self.total, reparto, pct)
        return self

    def montos_reparto(self) -> dict[str, Decimal | None]:
        return dict(self._montos_reparto)


class EgresoCreate(EgresoBase):
    empresa_codigo: str = Field(min_length=2, max_length=20)

    @field_validator("empresa_codigo", mode="before")
    @classmethod
    def _empresa_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v


class EgresoBatchFila(EgresoBase):
    """Una fila pegada desde Excel: EgresoCreate sin empresa_codigo (va en el batch)."""


class EgresoBatchRequest(BaseModel):
    empresa_codigo: str = Field(min_length=2, max_length=20)
    # Las filas viajan crudas a propósito: se validan una por una en el
    # endpoint para poder responder 422 con `[{fila, error}]` (la grilla
    # marca la fila que falló), cosa que el validador global de FastAPI no da.
    filas: list[dict[str, Any]] = Field(
        min_length=1,
        max_length=500,
        description="Filas EgresoBatchFila (EgresoCreate sin empresa_codigo). Máx 500.",
    )

    @field_validator("empresa_codigo", mode="before")
    @classmethod
    def _empresa_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v


# ---------------------------------------------------------------------------
# Update (PUT parcial)
# ---------------------------------------------------------------------------


class EgresoUpdate(_NormalizadoresEgreso):
    """PATCH-like vía PUT: sólo se toca lo que viene (`model_fields_set`).

    Mandar `reparto: null` o `reparto: {}` deja el gasto SIN CLASIFICAR;
    omitir `reparto` lo deja como estaba. Lo mismo con `corfo` (sub-objeto
    parcial: se funde campo a campo).
    """

    model_config = ConfigDict(extra="ignore")

    empresa_codigo: str | None = None
    fecha: date | None = None
    descripcion: str | None = Field(default=None, max_length=MAX_DESCRIPCION)
    rut_emisor: str | None = None
    tipo_documento: TipoDocumento | None = None
    folio: str | None = Field(default=None, max_length=50)
    monto_neto: Decimal | None = None
    impuesto: Decimal | None = None
    total: Decimal | None = None
    tipo_egreso: str | None = Field(default=None, max_length=120)
    fuente: str | None = Field(default=None, max_length=120)
    proyecto: str | None = Field(default=None, max_length=120)
    estado_pago: EstadoPago | None = None
    fecha_pago: date | None = None
    reparto: RepartoIn | None = None
    reparto_pct: RepartoIn | None = None
    corfo: CorfoIn | None = None
    observaciones: str | None = Field(default=None, max_length=MAX_OBSERVACIONES)
    adjunto_dropbox_path: str | None = Field(default=None, max_length=MAX_ADJUNTO_PATH)

    @field_validator("empresa_codigo")
    @classmethod
    def _empresa_no_editable(cls, v: str | None) -> str | None:
        if v is not None:
            raise ValueError(
                "empresa_codigo no se puede cambiar: un gasto pertenece a su empresa. "
                "Borralo y cargalo en la otra."
            )
        return v

    @model_validator(mode="after")
    def _reglas(self) -> EgresoUpdate:
        if self.reparto is not None and self.reparto_pct is not None:
            raise ValueError(
                "Mandá el reparto en montos (reparto) o en porcentajes (reparto_pct), "
                "no los dos a la vez"
            )
        for campo in _CAMPOS_OBLIGATORIOS:
            if campo in self.model_fields_set and getattr(self, campo) is None:
                raise ValueError(f"{campo} no puede quedar vacío")
        return self


def fusionar_update(actual: Mapping[str, Any], patch: EgresoUpdate) -> dict[str, Any]:
    """Fila actual + PUT parcial → columnas completas para el UPDATE.

    Las reglas de plata se re-evalúan SOLO sobre lo que el PUT toca, para
    que una fila importada descuadrada (hay 13 en TRONGKAI) se pueda marcar
    como pagada sin obligar a arreglar antes el reparto:

    - Toca monto_neto y/o impuesto → lo que vino manda y lo que falta (o
      vino en `null` explícito) se resuelve como en Create: los dos en null
      → neto = total, impuesto = 0; uno solo → el otro es la diferencia.
    - Toca SÓLO el total → se conserva el impuesto y el neto absorbe (si el
      impuesto ya no cabe en el total nuevo, se recalcula desde cero). Es la
      única situación en que se conserva el impuesto.
    - Toca reparto / reparto_pct → se resuelve con el motor (cuadre exacto o
      422; `null` = sin clasificar).
    - Toca total SIN tocar el reparto → si el reparto vigente está OK contra
      el total viejo se reescala con `escalar_reparto` (proporción exacta,
      residuo a la fuente mayor, sin pasar por %); si está DESCUADRADO se
      deja tal cual (sigue en ámbar, no 422); sin clasificar sigue sin
      clasificar. Nunca se rechaza un PUT por un reparto que el cliente no
      tocó.
    """
    tocados = patch.model_fields_set
    simples = (
        "fecha", "descripcion", "rut_emisor", "tipo_documento", "folio",
        "tipo_egreso", "fuente", "proyecto", "estado_pago", "fecha_pago",
        "observaciones", "adjunto_dropbox_path",
    )
    out: dict[str, Any] = {c: actual.get(c) for c in simples}
    for c in simples:
        if c in tocados:
            out[c] = getattr(patch, c)

    total_actual = a_decimal(actual.get("total")) or Decimal("0.00")
    total = patch.total if "total" in tocados and patch.total is not None else total_actual
    neto_actual = a_decimal(actual.get("monto_neto"))
    imp_actual = a_decimal(actual.get("impuesto"))
    if tocados & {"monto_neto", "impuesto"}:
        # Un `null` explícito cuenta como "no vino": los dos en null → neto =
        # total, impuesto = 0 (igual que Create); uno solo → diferencia.
        neto_in = patch.monto_neto if "monto_neto" in tocados else None
        imp_in = patch.impuesto if "impuesto" in tocados else None
        neto, imp = resolver_neto_impuesto(total, neto_in, imp_in)
    elif "total" in tocados:
        # Sólo cambió el total: conservar el impuesto y que el neto absorba;
        # si el impuesto ya no cabe, se recalcula desde cero.
        imp_in = imp_actual if imp_actual is not None and imp_actual <= total else None
        neto, imp = resolver_neto_impuesto(total, None, imp_in)
    else:
        neto, imp = neto_actual or Decimal("0.00"), imp_actual or Decimal("0.00")
    out["total"], out["monto_neto"], out["impuesto"] = total, neto, imp

    montos_actual = {f: a_decimal(actual.get(f"monto_{f}")) for f in FUENTES}
    if tocados & {"reparto", "reparto_pct"}:
        reparto = patch.reparto.como_dict() if patch.reparto is not None else None
        pct = patch.reparto_pct.como_dict() if patch.reparto_pct is not None else None
        if "reparto" in tocados and patch.reparto is None:
            reparto = {}  # null explícito = sin clasificar
        montos = resolver_reparto(total, reparto, pct)
    elif "total" in tocados and estado_reparto(total_actual, montos_actual) == ESTADO_OK:
        try:
            montos = escalar_reparto(total_actual, total, montos_actual)
        except RepartoInvalidoError:
            # Total viejo $0 con reparto en ceros: no hay proporción que
            # escalar. Queda como está (pasa a DESCUADRADO y la pantalla lo
            # marca); el cliente lo resuelve mandando reparto_pct.
            montos = montos_actual
    else:
        # Sin clasificar, o DESCUADRADO que el cliente no tocó: se deja igual.
        montos = montos_actual
    for f in FUENTES:
        out[f"monto_{f}"] = montos[f]

    corfo_out = {
        c: actual.get(f"corfo_{c}") for c in CorfoIn.model_fields
    }
    if "corfo" in tocados and patch.corfo is not None:
        for c in patch.corfo.model_fields_set:
            corfo_out[c] = getattr(patch.corfo, c)
    for c, v in corfo_out.items():
        out[f"corfo_{c}"] = v
    return out


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------


class EgresoRead(BaseModel):
    egreso_id: int
    empresa_codigo: str
    periodo: str
    fecha: date
    descripcion: str
    rut_emisor: str | None = None
    tipo_documento: str
    folio: str | None = None
    monto_neto: str
    impuesto: str
    total: str
    tipo_egreso: str | None = None
    fuente: str | None = None
    proyecto: str | None = None
    estado_pago: str
    fecha_pago: date | None = None
    reparto: RepartoRead | None = None
    reparto_pct: RepartoRead | None = None
    reparto_estado: str
    corfo: CorfoRead
    observaciones: str | None = None
    adjunto_dropbox_path: str | None = None
    origen: str
    neto_mas_impuesto_cuadra: bool
    created_at: datetime | None = None
    created_by: str | None = None
    updated_at: datetime | None = None
    updated_by: str | None = None
    version: int


def egreso_read_desde_fila(fila: Mapping[str, Any]) -> EgresoRead:
    """Una fila de core.corfo_registro_egresos (+ `version`) → EgresoRead."""
    total = a_decimal(fila.get("total")) or Decimal("0.00")
    neto = a_decimal(fila.get("monto_neto")) or Decimal("0.00")
    imp = a_decimal(fila.get("impuesto")) or Decimal("0.00")
    montos = normalizar_montos({f: fila.get(f"monto_{f}") for f in FUENTES})
    sin_clasificar = all(v is None for v in montos.values())
    reparto = None if sin_clasificar else RepartoRead(**{f: fmt_monto(montos[f]) for f in FUENTES})
    pcts = pct_desde_montos(total, montos)
    reparto_pct = None if pcts is None else RepartoRead(**{f: fmt_monto(pcts[f]) for f in FUENTES})
    return EgresoRead(
        egreso_id=int(fila["egreso_id"]),
        empresa_codigo=fila["empresa_codigo"],
        periodo=fila["periodo"],
        fecha=fila["fecha"],
        descripcion=fila["descripcion"],
        rut_emisor=fila.get("rut_emisor"),
        tipo_documento=fila["tipo_documento"],
        folio=fila.get("folio"),
        monto_neto=fmt_monto(neto) or "0.00",
        impuesto=fmt_monto(imp) or "0.00",
        total=fmt_monto(total) or "0.00",
        tipo_egreso=fila.get("tipo_egreso"),
        fuente=fila.get("fuente"),
        proyecto=fila.get("proyecto"),
        estado_pago=fila["estado_pago"],
        fecha_pago=fila.get("fecha_pago"),
        reparto=reparto,
        reparto_pct=reparto_pct,
        reparto_estado=estado_reparto(total, montos),
        corfo=CorfoRead(
            cuenta=fila.get("corfo_cuenta"),
            item=fila.get("corfo_item"),
            fuente_financiamiento=fila.get("corfo_fuente_financiamiento"),
            etapa=fila.get("corfo_etapa"),
            fecha_recepcion=fila.get("corfo_fecha_recepcion"),
            monto_rendir=fmt_monto(fila.get("corfo_monto_rendir")),
            monto_cancelado=fmt_monto(fila.get("corfo_monto_cancelado")),
            forma_pago=fila.get("corfo_forma_pago"),
            glosa=fila.get("corfo_glosa"),
            receptor_rut=fila.get("corfo_receptor_rut"),
            receptor_nombre=fila.get("corfo_receptor_nombre"),
        ),
        observaciones=fila.get("observaciones"),
        adjunto_dropbox_path=fila.get("adjunto_dropbox_path"),
        origen=fila.get("origen") or "UI",
        neto_mas_impuesto_cuadra=(neto + imp == total),
        created_at=fila.get("created_at"),
        created_by=fila.get("created_by"),
        updated_at=fila.get("updated_at"),
        updated_by=fila.get("updated_by"),
        version=int(fila.get("version") or 1),
    )


class CambioHistorial(BaseModel):
    campo: str
    antes: str | None = None
    despues: str | None = None


class HistorialItem(BaseModel):
    version: int
    accion: str
    changed_at: datetime | None = None
    changed_by: str | None = None
    cambios: list[CambioHistorial]


class EgresoDetail(EgresoRead):
    historial: list[HistorialItem]


class EgresoListResponse(BaseModel):
    empresa_codigo: str
    periodo: str | None = None
    items: list[EgresoRead]
    n: int
    truncado: bool


class PeriodoItem(BaseModel):
    periodo: str
    n: int
    total: str
    #: Monto (no cantidad) de los gastos con estado PENDIENTE del mes.
    pendiente: str
    sin_clasificar: int
    descuadrados: int


class PeriodosResponse(BaseModel):
    items: list[PeriodoItem]
    n_total: int
    total_general: str


class EstadoResumen(BaseModel):
    n: int
    monto: str


class PorEstadoResumen(BaseModel):
    PAGADO: EstadoResumen
    PARCIAL: EstadoResumen
    PENDIENTE: EstadoResumen


class PorFuenteResumen(BaseModel):
    subsidio: str
    cehta_ptec: str
    cehta: str
    trewaox: str
    #: Monto total de los gastos que todavía no tienen reparto.
    sin_clasificar: str


class TipoDocumentoResumen(BaseModel):
    tipo_documento: str
    n: int
    monto: str


class ResumenResponse(BaseModel):
    empresa_codigo: str
    periodo: str | None = None
    n: int
    total: str
    por_fuente: PorFuenteResumen
    por_estado: PorEstadoResumen
    pct_pagado: str
    por_tipo_documento: list[TipoDocumentoResumen]
    descuadrados: int
    sin_clasificar: int


class CatalogoItem(BaseModel):
    codigo: str
    label: str


class CorfoCatalogos(BaseModel):
    cuenta_gastos: list[str]
    item_gastos: list[str]
    etapa: list[str]
    tipo_doc_gastos: list[str]
    fuente_financiamiento_sugeridas: list[str]


class Sugerencias(BaseModel):
    tipo_egreso: list[str]
    fuente: list[str]
    proyecto: list[str]


class ClaudiaCatalogosResponse(BaseModel):
    """Con prefijo a propósito: `schemas/catalogo.py` ya tiene `CatalogosResponse`
    y dos clases con el mismo nombre en el OpenAPI hacen que `gen:types`
    genere `app__schemas__…__CatalogosResponse` y rompa el `tsc` del front."""

    tipos_documento: list[CatalogoItem]
    estados_pago: list[CatalogoItem]
    fuentes: list[CatalogoItem]
    formas_pago: list[CatalogoItem]
    corfo: CorfoCatalogos
    sugerencias: Sugerencias


FUENTES_CATALOGO: list[CatalogoItem] = [
    CatalogoItem(codigo=f, label=ETIQUETAS[f]) for f in FUENTES
]


class EgresoBatchResponse(BaseModel):
    creados: list[EgresoRead]
    n: int


class EgresoDeleteRequest(BaseModel):
    motivo: str = Field(min_length=MIN_MOTIVO_BORRADO, max_length=MAX_MOTIVO_BORRADO)

    @field_validator("motivo", mode="before")
    @classmethod
    def _motivo_acotado(cls, v: Any) -> Any:
        # Los límites se chequean acá (antes que el Field) para que el 422
        # salga en español; el Field queda para que el OpenAPI los documente.
        s = str(v).strip() if v is not None else ""
        if len(s) < MIN_MOTIVO_BORRADO:
            raise ValueError(
                f"El motivo del borrado tiene que tener al menos {MIN_MOTIVO_BORRADO} "
                "caracteres (queda en el historial)"
            )
        if len(s) > MAX_MOTIVO_BORRADO:
            raise ValueError(
                f"El motivo del borrado no puede superar los {MAX_MOTIVO_BORRADO} caracteres"
            )
        return s


class EgresoDeleteResponse(BaseModel):
    egreso_id: int
    deleted_at: datetime


class FilaSaltada(BaseModel):
    fila_excel: int
    motivo: str


class ImportarResponse(BaseModel):
    empresa_codigo: str
    dry_run: bool
    #: Filas con datos del Excel = cargables + saltadas (las repetidas ya
    #: están dentro de las cargables).
    leidas: int = Field(description="Filas con datos leídas del Excel (cargables + saltadas).")
    creadas: int
    omitidas_existentes: int
    #: Mismo nombre que antes para no romper el front; desde D1 significa
    #: "filas repetidas del Excel que SE CARGARON con observación".
    duplicadas_en_excel: int = Field(
        description=(
            "Filas idénticas a otra del mismo Excel que se cargaron igual (son pagos "
            "distintos), con huella propia y observación para revisar."
        )
    )
    saltadas: list[FilaSaltada]
    descuadradas: int
    sin_clasificar: int
