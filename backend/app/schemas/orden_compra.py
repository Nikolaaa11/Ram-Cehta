from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.value_objects.iva import calcular_iva, porcentaje_a_tasa

# Tokens del catálogo SII — los MISMOS que core.vouchers.doc_tributario_tipo,
# para que el mapeo OC→voucher sea la identidad (toda tabla de traducción
# entre dos catálogos termina divergiendo). Las etiquetas en castellano
# ("Boleta de honorarios", "Factura exenta") son presentación: viven en el
# frontend y en el PDF, nunca en la columna.
TipoDocumentoOC = Literal["FACTURA", "FACTURA_EXENTA", "BOLETA", "HONORARIOS"]

# Constantes y no literales repetidos: el día que aparezca un quinto token
# hay un solo lugar que tocar, y la API/el PDF importan de acá en vez de
# escribir la lista otra vez. Espejan ck_oc_coherencia_tributaria en la BD.
TIPOS_SIN_IVA: tuple[str, ...] = ("FACTURA_EXENTA", "HONORARIOS")
TIPOS_SIN_RETENCION: tuple[str, ...] = ("FACTURA", "BOLETA")


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
    # A quién va dirigida la OC ("Atte. Señor/a" en el PDF). Si viene
    # proveedor_contacto_id, el endpoint resuelve nombre/cargo desde el
    # catálogo (core.proveedor_contactos) y los snapshotea acá — así, si el
    # proveedor cambia de encargado después, las OC ya emitidas no cambian
    # de destinatario retroactivamente. atte_nombre/atte_cargo también se
    # pueden mandar sueltos (texto libre) para un contacto no cargado aún
    # en el catálogo.
    proveedor_contacto_id: int | None = None
    atte_nombre: str | None = None
    atte_cargo: str | None = None
    # Cuál de los cuatro documentos tributarios respalda la compra. Ya no es
    # una etiqueta informativa: manda sobre el cálculo (FACTURA_EXENTA y
    # HONORARIOS no llevan IVA, HONORARIOS retiene).
    tipo_documento: TipoDocumentoOC = "FACTURA"
    # Reemplaza el 19% hardcodeado: no toda compra es afecta a IVA completo
    # (boletas, exentos, casos pactados con el proveedor). 0-100, 2 decimales.
    iva_porcentaje: Decimal = Field(default=Decimal("19.00"), ge=0, le=100)
    # Tasa de retención de 2ª categoría (Art. 74 N°2 LIR). `None` NO es "0":
    # significa "el cliente no la mandó", y el endpoint la resuelve desde
    # core.tax_config por `fecha_emision` — una OC con fecha 2027 tiene que
    # traer 16%. Con default 0 no habría forma de distinguir "no la mandaron"
    # de "la pactaron en 0" y toda OC de honorarios nacería sin retener.
    retencion_porcentaje: Decimal | None = Field(default=None, ge=0, le=100)
    # NO hay campo "modo bruto/líquido" a propósito: `neto` es siempre
    # Σ(items) por el validador de abajo, así que un gross-up server-side
    # tendría que reescribir los precios del itemizado para no dejarlo
    # inconsistente. El gross-up (líquido → bruto, /(1-tasa)) es un asistente
    # del formulario: lo que se guarda es siempre el BRUTO.
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

    @model_validator(mode="after")
    def coherencia_tributaria(self) -> OrdenCompraCreate:
        """Espeja el CHECK ck_oc_coherencia_tributaria de la BD.

        Sin esto, una OC de honorarios con el 19 viejo pegado en el campo de
        IVA llega igual al INSERT y vuelve como IntegrityError → 500 opaco.
        """
        if self.tipo_documento in TIPOS_SIN_IVA:
            # Se PISA en vez de rechazar: el operador no tiene por qué saber
            # que quedó un 19 viejo en un campo que la pantalla ya ni le
            # muestra para este tipo de documento.
            self.iva_porcentaje = Decimal("0")
        if (
            self.tipo_documento in TIPOS_SIN_RETENCION
            and self.retencion_porcentaje is not None
            and self.retencion_porcentaje > 0
        ):
            # Acá sí se rechaza: retener sobre una factura afecta no es un
            # descuido de formulario, es plata que alguien NO le va a girar
            # al proveedor. Mejor 422 legible que un total silenciosamente
            # más chico.
            raise ValueError(
                "Una factura o boleta afecta no lleva retención de "
                "honorarios. Si es una boleta de honorarios, elegí el tipo "
                "de documento HONORARIOS."
            )
        return self

    @property
    def iva_calculado(self) -> Decimal:
        # El chequeo del tipo es redundante con `coherencia_tributaria` (que
        # ya pisó el % a 0) y está a propósito: éste es el número que se
        # persiste, y sobre la plata prefiero dos candados que uno.
        if self.moneda != "CLP" or self.tipo_documento in TIPOS_SIN_IVA:
            return Decimal("0")
        return calcular_iva(self.neto or Decimal("0"), porcentaje_a_tasa(self.iva_porcentaje))

    @property
    def total_calculado(self) -> Decimal:
        # `total` = neto + IVA SIEMPRE, también en honorarios: es el VALOR
        # DEL CONTRATO (el bruto), no el líquido a girar. El líquido va en
        # `total_a_pagar` = total - retencion_monto, y ese par lo deriva el
        # endpoint (§4.3 del megaprompt) porque necesita `core.tax_config`
        # y la BD — acá no hay sesión.
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
    proveedor_contacto_id: int | None = None
    atte_nombre: str | None = None
    atte_cargo: str | None = None
    tipo_documento: str = "FACTURA"
    iva_porcentaje: Decimal = Decimal("19.00")
    retencion_porcentaje: Decimal = Decimal("0")
    retencion_monto: Decimal = Decimal("0")
    # Nullable en el contrato de salida aunque en la BD sea NOT NULL: cubre
    # la ventana entre el deploy y la migración aplicada a mano. Fallback
    # correcto del lado del consumidor: `total_a_pagar ?? total` — sólo
    # difieren en HONORARIOS, y una OC de honorarios no puede existir antes
    # de que la migración haya corrido.
    total_a_pagar: Decimal | None = None
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
    # El listado y el kanban no traían el tipo ni el líquido, así que no
    # podían distinguir una boleta de honorarios de una factura ni mostrar
    # lo que realmente se gira. Van con default para que agregarlos no
    # rompa a quien todavía no los popula.
    tipo_documento: str = "FACTURA"
    retencion_monto: Decimal = Decimal("0")
    total_a_pagar: Decimal | None = None
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
    (numero_oc, empresa_codigo, fecha_emision, neto, estado) NO se pueden
    modificar acá: 'numero_oc' rompería trazabilidad, 'neto' se recalcula
    de los items, y 'estado' tiene su propio endpoint `PATCH /{id}/estado`
    con validación de transiciones. `iva`/`total` tampoco se aceptan
    directos — se derivan server-side de `iva_porcentaje` cuando viene en
    el body (ver `update_oc` en ordenes_compra.py). Lo mismo vale para
    `retencion_monto` y `total_a_pagar`: se derivan de
    `retencion_porcentaje` + `tipo_documento`, nunca se aceptan del cliente.

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
    # A quién va dirigida + tipo de documento / IVA% SÍ son editables acá
    # (a diferencia de neto/iva/total): el pedido explícito fue poder
    # "cambiarle el IVA a las OC" ya emitidas cuando resulta ser boleta y
    # no factura. El endpoint recalcula iva/total server-side cuando
    # iva_porcentaje viene en el body — nunca acepta iva/total directos.
    proveedor_contacto_id: int | None = None
    atte_nombre: str | None = None
    atte_cargo: str | None = None
    tipo_documento: TipoDocumentoOC | None = None
    iva_porcentaje: Decimal | None = Field(default=None, ge=0, le=100)
    retencion_porcentaje: Decimal | None = Field(default=None, ge=0, le=100)

    model_config = {"extra": "ignore"}

    @model_validator(mode="after")
    def coherencia_tributaria(self) -> OrdenCompraUpdate:
        """Mismo espejo del CHECK que en Create, adaptado a PATCH."""
        if self.tipo_documento is None:
            # PATCH que no toca el tipo: la coherencia hay que validarla
            # contra el tipo YA guardado en la OC, y eso sólo lo puede hacer
            # el endpoint (acá no hay acceso a la fila).
            return self
        if self.tipo_documento in TIPOS_SIN_IVA:
            # Pisar el IVA a 0 acá tiene un efecto lateral buscado: pydantic
            # marca el campo como "set", así `update_fields` lo persiste con
            # su `model_dump(exclude_unset=True)`. Sin esto, un PATCH que
            # sólo cambia el tipo a HONORARIOS dejaba el 19% intacto y
            # rebotaba contra ck_oc_coherencia_tributaria.
            self.iva_porcentaje = Decimal("0")
        if (
            self.tipo_documento in TIPOS_SIN_RETENCION
            and self.retencion_porcentaje is not None
            and self.retencion_porcentaje > 0
        ):
            raise ValueError(
                "Una factura o boleta afecta no lleva retención de "
                "honorarios. Si es una boleta de honorarios, elegí el tipo "
                "de documento HONORARIOS."
            )
        return self


# ---------------------------------------------------------------------------
# Papelera de OC — borrado con registro
# ---------------------------------------------------------------------------
# Nicolás pidió poder borrar cualquier OC, incluso firmada, dejando registro.
# El registro vive en `core.oc_eliminadas` y se escribe en la MISMA
# transacción que el DELETE: si no se puede guardar, la OC no se borra.

#: Largo mínimo del motivo. No es un número mágico decorativo: con menos que
#: esto entra "no", "error", "x" — que en el papel es lo mismo que no dejar
#: motivo. El registro existe para que dentro de un año alguien entienda por
#: qué desapareció un documento firmado.
MOTIVO_ELIMINACION_MIN = 10


class OcEliminarRequest(BaseModel):
    """Cuerpo del DELETE. El motivo es obligatorio, no un extra."""

    motivo: str = Field(
        ...,
        min_length=MOTIVO_ELIMINACION_MIN,
        max_length=1000,
        description=(
            "Por qué se borra esta OC. Queda guardado para siempre junto con "
            "la copia completa del documento."
        ),
    )

    @model_validator(mode="after")
    def motivo_con_contenido(self) -> OcEliminarRequest:
        # `min_length` cuenta caracteres crudos: "          " (diez espacios)
        # pasa la validación de pydantic y rebota recién contra el CHECK de la
        # BD, con un 500 opaco. Se corta acá, con un mensaje que se entiende.
        if len(self.motivo.strip()) < MOTIVO_ELIMINACION_MIN:
            raise ValueError(
                f"El motivo tiene que tener al menos {MOTIVO_ELIMINACION_MIN} "
                "caracteres de texto real. Escribí qué pasó con esta OC: "
                "es lo único que va a quedar para explicar el borrado."
            )
        return self


class OcEliminadaListItem(BaseModel):
    """Una fila de la papelera. Los campos están denormalizados en la tabla
    para que el listado no tenga que abrir el snapshot JSON."""

    eliminacion_id: int
    oc_id: int
    numero_oc: str
    empresa_codigo: str
    estado_previo: str
    proveedor_nombre: str | None = None
    proveedor_rut: str | None = None
    fecha_emision: date | None = None
    moneda: str | None = None
    tipo_documento: str | None = None
    total: Decimal | None = None
    total_a_pagar: Decimal | None = None
    #: > 0 = se borró un documento firmado. Es el dato que hace que una fila
    #: de esta lista importe o no.
    firmas_puestas: int = 0
    firmantes: str | None = None
    vouchers_con_plata: int = 0
    voucher_ids: list[int] = Field(default_factory=list)
    motivo: str
    eliminado_por_email: str | None = None
    eliminado_el: datetime


class OcEliminadaRead(OcEliminadaListItem):
    """El detalle agrega la copia completa de la OC."""

    #: Cabecera + ítems + cuotas + firmas + adjuntos + vouchers vinculados,
    #: tal como estaban el segundo antes del borrado.
    snapshot: dict
    ip: str | None = None
    user_agent: str | None = None
