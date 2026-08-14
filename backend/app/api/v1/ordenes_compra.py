"""CRUD Órdenes de Compra — Session 2.5."""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
# Motor de cálculo de la OC. La aritmética de los cuatro tipos de documento
# vive ahí y NO se reimplementa acá: este módulo decide qué tasa corresponde
# (leyendo core.tax_config) y aporta la única regla que el motor no conoce a
# propósito — que en moneda extranjera la OC no calcula IVA.
from app.domain.value_objects.retencion import (
    IVA_PORCENTAJE_GENERAL,
    TIPOS_AFECTOS,
    TIPOS_CON_RETENCION,
    calcular_totales,
    paso_de_moneda,
    normalizar_porcentajes,
    porcentaje_retencion_por_fecha,
)
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.orden_compra_repository import OrdenCompraRepository
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.models.orden_compra import OrdenCompra
from app.services.oc_filename_util import oc_pdf_content_disposition
from app.schemas.proveedor import ProveedorCreate
from app.schemas.bulk import (
    BulkItemError,
    BulkUpdateEstadoRequest,
    BulkUpdateResult,
)
from app.schemas.common import Page
from app.schemas.orden_compra import (
    DuplicateOcRequest,
    EstadoUpdateRequest,
    OCDetalleCreate,
    OCDetalleRead,
    OrdenCompraCreate,
    OrdenCompraListItem,
    OrdenCompraRead,
    OrdenCompraUpdate,
)
from app.services.audit_service import audit_log
from app.services.authorization_service import AuthorizationService
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.services.webhook_dispatcher import publish_event

router = APIRouter()
_authz = AuthorizationService()


# =====================================================================
# Derivación tributaria de la OC (contrato §3 y §4.3)
# =====================================================================
#
# Los cuatro tokens son los del catálogo SII que ya usa
# `core.vouchers.doc_tributario_tipo`: el mapeo OC → voucher tiene que ser
# la identidad. Toda tabla de traducción entre dos catálogos termina
# divergiendo, y acá divergir significa declararle al SII una operación
# afecta como exenta. Los sets de tipos salen del motor (`retencion.py`), no
# se redeclaran: dos listas de tipos es cómo empieza una divergencia.

# Sólo para mensajes de error: el operador no tiene por qué leer tokens en
# mayúscula. La columna guarda el token, nunca la etiqueta.
_ETIQUETA_TIPO_DOC = {
    "FACTURA": "Factura afecta",
    "FACTURA_EXENTA": "Factura exenta",
    "BOLETA": "Boleta de ventas y servicios",
    "HONORARIOS": "Boleta de honorarios",
}


def _campo_explicito(body: Any, campo: str) -> Any:
    """Valor que el cliente mandó EXPLÍCITAMENTE, o None si no lo mandó.

    Usa `model_fields_set` en vez de comparar contra el default. Si el schema
    tuviera default 0 en vez de None, un `getattr` pelado devolvería 0 y la
    trampa del cero falso entraría por la puerta de atrás: un honorario
    retendría 0% porque nadie mandó la tasa, en lugar de leer la vigente de
    `core.tax_config`. "No lo mandó" y "lo mandó en 0" son cosas distintas.
    """
    if campo not in getattr(body, "model_fields_set", ()):
        return None
    return getattr(body, campo, None)


def _col(oc: OrdenCompra, nombre: str, por_defecto: Decimal) -> Decimal:
    """Lee una columna nueva tolerando que la migración todavía no corrió.

    El deploy NO aplica migraciones (el `release_command` está desactivado y
    el SQL se corre a mano), así que existe una ventana en la que el código
    nuevo pide columnas que la fila todavía no tiene, o que existen con NULL
    en las OCs anteriores al backfill. `is not None`, nunca `or`: un monto de
    0 es un valor legítimo y `or` lo reemplazaría por el default.
    """
    valor = getattr(oc, nombre, None)
    return valor if valor is not None else por_defecto


def _validar_coherencia_tributaria(
    *,
    tipo_documento: str,
    moneda: str,
    retencion_porcentaje: Decimal | None,
) -> None:
    """422 en castellano cuando el tipo de documento y la tasa se contradicen.

    Asimetría deliberada con el IVA (§4.3): lo que el cliente AFIRMA se
    rechaza, lo que quedó HEREDADO en la fila se pisa en silencio. Por eso
    `retencion_porcentaje` acá es el valor explícito del body — si es None,
    el operador no dijo nada y no hay nada que rechazar.

    Incluye FACTURA_EXENTA entre los tipos sin retención aunque el CHECK de
    BD sólo nombre FACTURA/BOLETA: una exenta con retención dejaría
    `total_a_pagar != total` en un documento que no retiene nada, y eso es
    plata mal girada. La API puede ser más estricta que la BD; al revés no.
    """
    tipo = (tipo_documento or "FACTURA").upper()

    # `is not None` y no `if retencion_porcentaje:` — un 0 explícito es un
    # dato válido, no la ausencia del campo.
    if (
        retencion_porcentaje is not None
        and retencion_porcentaje > 0
        and tipo not in TIPOS_CON_RETENCION
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El documento es '{_ETIQUETA_TIPO_DOC.get(tipo, tipo)}' y no "
                "admite retención: la retención del Art. 74 N°2 de la LIR "
                "sólo corre en boletas de honorarios. Cambiá el tipo de "
                "documento a 'Boleta de honorarios' o dejá la retención en 0."
            ),
        )

    if tipo in TIPOS_CON_RETENCION and (moneda or "CLP") != "CLP":
        # El redondeo del motor es a peso chileno. Aplicarlo sobre UF daría
        # una retención cuantizada a la unidad (15,33 UF → 15 UF), y además
        # la boleta de honorarios electrónica se emite en pesos: la retención
        # se entera al SII en CLP. Mejor un 422 legible que un monto mudo.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Una boleta de honorarios se emite en pesos: la retención se "
                f"calcula y se entera al SII en CLP, no en {moneda}. Cambiá "
                "la moneda a CLP o usá otro tipo de documento."
            ),
        )


def _derivar_totales_oc(
    *,
    neto: Decimal,
    moneda: str,
    tipo_documento: str,
    iva_porcentaje: Decimal,
    retencion_porcentaje: Decimal,
) -> dict[str, Decimal]:
    """Los seis números tributarios de una OC, calculados en el servidor.

    El cliente propone el tipo y las tasas; los montos los calcula el
    servidor y nunca se aceptan del body (§4.3). Devuelve un dict listo para
    el `derived=` del repositorio, con las TASAS ya normalizadas por el motor:
    si el tipo no admite IVA o no admite retención, la tasa correspondiente
    vuelve pisada a 0. Así lo que se persiste y lo que se calcula no se pueden
    contradecir, ni siquiera si alguien edita la fila a mano después.

    `neto` es la B de la §3: la suma del itemizado. En HONORARIOS es el
    honorario BRUTO, no el líquido.

    La aritmética no está acá: es toda de `calcular_totales`. Este wrapper
    aporta lo único que el motor no puede saber — la moneda — y traduce los
    `ValueError` del motor a 422 en vez de dejarlos salir como 500.
    """
    tipo = (tipo_documento or "FACTURA").upper()

    # La regla de la moneda. La UF **sí** lleva IVA: es una unidad de cuenta
    # chilena —pesos indexados a la inflación—, no una moneda extranjera, y una
    # OC pactada en UF (arriendos, construcción) es una operación afecta como
    # cualquier otra. Antes se le forzaba IVA 0 junto con el dólar y las OC en
    # UF salían sin impuesto: había una así en producción.
    #
    # El dólar SÍ queda afuera y a propósito: una operación en USD suele ser
    # exportación o importación, con tratamiento tributario distinto (exenta, o
    # el IVA lo liquida Aduana). Meterlas en la misma bolsa sería asumir un
    # criterio tributario que nadie pidió. Si hace falta, se decide aparte.
    #
    # Se aplica sobre el PORCENTAJE y no sobre el monto: si se pisara el monto,
    # la fila quedaría con `iva_porcentaje = 19` e `iva = 0` y el PDF imprimiría
    # "IVA 19% ......... 0". Pisando el porcentaje, la fila es coherente consigo
    # misma y el PDF dice la verdad.
    MONEDAS_AFECTAS = ("CLP", "UF")
    iva_pct_pedido = (
        iva_porcentaje if moneda in MONEDAS_AFECTAS else Decimal("0")
    )

    # Unidad mínima de la moneda. En UF los decimales son plata: 123,45 UF al
    # 19% da 23,4555 UF de IVA, y redondear eso a 23 UF pierde casi media UF
    # (~$17.000). El motor por defecto redondea a peso entero, así que sin este
    # paso el arreglo de arriba habría cambiado un error por otro.
    paso = paso_de_moneda(moneda)

    # El peso chileno no tiene centavos. La suma del itemizado puede traerlos
    # igual —`precio_unitario` es NUMERIC(18,2) y una cantidad fraccionaria o
    # un gross-up escalado dejan restos— y de ahí se propagan a `neto`,
    # `total`, `total_a_pagar`, a los hitos de pago y a los vouchers.
    # Se corta acá, en el único punto por el que pasan TODAS las altas y
    # ediciones (formulario, duplicar, importación CSV e inbox), en vez de
    # parchear cada origen. El motor no lo hace a propósito: no conoce la
    # moneda, y en UF/USD los decimales sí son significativos.
    if moneda == "CLP":
        neto = neto.quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    try:
        # `normalizar_porcentajes` devuelve lo que hay que PERSISTIR;
        # `calcular_totales` los montos. Se llama a las dos porque la segunda
        # no devuelve las tasas, y las tasas también se guardan (invariante 5:
        # la OC es el snapshot de la tasa que se le aplicó).
        iva_pct, ret_pct = normalizar_porcentajes(
            tipo,
            iva_porcentaje=iva_pct_pedido,
            retencion_porcentaje=retencion_porcentaje,
        )
        # Sin `fecha_emision`: el default por fecha del motor es el fallback en
        # código, y acá la tasa ya viene resuelta contra core.tax_config, que
        # es la fuente de verdad (invariante 10). Pasar los dos dejaría que el
        # motor decidiera cuando el llamador ya decidió.
        totales = calcular_totales(
            tipo,
            neto,
            iva_porcentaje=iva_pct,
            retencion_porcentaje=ret_pct,
            paso=paso,
        )
    except ValueError as exc:
        # Tipo desconocido, porcentaje fuera de 0..100, retención en un tipo
        # que no la admite. Son errores del pedido, no del servidor: 422 con
        # el mensaje del motor, que ya está en castellano y explica cuál es
        # la contradicción.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    return {
        # `neto` viaja en el derived aunque el cliente ya lo haya mandado:
        # el redondeo a peso entero de arriba tiene que PERSISTIRSE, no sólo
        # usarse para calcular. Sin esto quedaba un `neto` con centavos y un
        # `total` entero, o sea la fila contradiciendo la identidad
        # total = neto + iva contra la que después se concilia.
        "neto": neto,
        "iva_porcentaje": iva_pct,
        "iva": totales.iva,
        # §3.1: `total` NO cambia de significado. Sigue siendo neto + IVA, o
        # sea el VALOR DEL CONTRATO. El líquido es una columna nueva, no una
        # redefinición de ésta.
        "total": totales.total,
        "retencion_porcentaje": ret_pct,
        "retencion_monto": totales.retencion_monto,
        "total_a_pagar": totales.total_a_pagar,
    }


async def _retencion_porcentaje_vigente(db: DBSession, fecha: date) -> Decimal:
    """Tasa de retención de honorarios vigente a `fecha`, desde `core.tax_config`.

    Invariante 10: la tasa vive en la tabla, no en el código. La escala del
    Art. 74 N°2 (Ley 21.133) sube todos los años hasta 2028, así que una OC
    con fecha 2027 tiene que traer 16% sin que nadie toque una línea.

    Dos motivos reales por los que la tabla puede no responder: el deploy no
    corre migraciones (hay una ventana en la que `core.tax_config` todavía no
    existe) y la escala sembrada podría no cubrir la fecha pedida. En los dos
    casos caemos al fallback puro del motor y lo dejamos logueado — lo que no
    se hace nunca es devolver 0 en silencio, porque eso es no retener nada.
    """
    import structlog

    log = structlog.get_logger(__name__)
    valor: Decimal | None = None
    try:
        # SAVEPOINT: si `core.tax_config` todavía no existe, el error aborta
        # la transacción entera en Postgres y se llevaría puesto lo que el
        # endpoint haya hecho antes.
        async with db.begin_nested():
            valor = await db.scalar(
                text(
                    """
                    SELECT valor
                      FROM core.tax_config
                     WHERE clave = 'RETENCION_HONORARIOS'
                       AND vigencia_desde <= :f
                       AND (vigencia_hasta IS NULL OR vigencia_hasta >= :f)
                     ORDER BY vigencia_desde DESC
                     LIMIT 1
                    """
                ),
                {"f": fecha},
            )
    except Exception as exc:
        valor = None
        log.warning(
            "oc_tax_config_inaccesible", fecha=str(fecha), error=str(exc)
        )

    if valor is not None:
        return Decimal(str(valor))

    try:
        fallback = porcentaje_retencion_por_fecha(fecha)
    except ValueError as exc:
        # La escala en código arranca en 2024 y no se extrapola hacia atrás
        # (antes había otros valores; inventarlos sería inventar un dato
        # tributario). Con tax_config caído y una OC retroactiva no hay tasa
        # que aplicar, y adivinar sería peor que pedirla.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"{exc}. Cargá la tasa de retención a mano en la OC, o sembrá "
                "la vigencia que falta en core.tax_config."
            ),
        ) from exc
    log.warning(
        "oc_retencion_fallback_motor",
        fecha=str(fecha),
        porcentaje=str(fallback),
        motivo="core.tax_config sin fila vigente o inaccesible",
    )
    return fallback


def _iva_porcentaje_efectivo(
    tipo_documento: str,
    *,
    explicito: Decimal | None,
    actual: Decimal | None,
    tipo_anterior: str | None,
) -> Decimal:
    """IVA% que hay que guardar, contemplando la VUELTA a un tipo afecto.

    El "pisar en vez de rechazar" de §4.3 del contrato es cómodo pero
    unidireccional: cuando una OC pasa a HONORARIOS o FACTURA_EXENTA el
    servidor le escribe `iva_porcentaje = 0` (correcto, esos tipos no llevan
    IVA). El problema aparece al volver: `PATCH {"tipo_documento":"FACTURA"}`
    no manda IVA%, así que se reusaba el 0 que el propio servidor había
    forzado y quedaba una **factura afecta con 0% de IVA** — 19% menos de lo
    que el proveedor va a facturar, y encima indistinguible de una exenta,
    que es exactamente el estado que la §2.1 dice que hay que evitar.

    Regla: si la OC entra a un tipo afecto VINIENDO de uno que no lo era, y
    el cliente no mandó una tasa, se restaura la general. Si ya era afecta,
    manda su tasa guardada — incluido un 0 puesto a propósito, que en una
    afecta es raro pero es del operador, no nuestro.
    """
    if (tipo_documento or "").upper() not in TIPOS_AFECTOS:
        return Decimal("0")
    if explicito is not None:
        return explicito
    venia_sin_iva = (tipo_anterior or "").upper() not in TIPOS_AFECTOS
    if venia_sin_iva:
        return IVA_PORCENTAJE_GENERAL
    return actual if actual is not None else IVA_PORCENTAJE_GENERAL


async def _resolver_retencion_porcentaje(
    db: DBSession,
    *,
    tipo_documento: str,
    fecha_emision: date,
    explicito: Decimal | None,
    actual: Decimal | None = None,
    tipo_anterior: str | None = None,
) -> Decimal:
    """Tasa de retención que hay que guardar en la OC.

    Precedencia:
      1. Lo que el cliente mandó explícitamente — puede ser 0 y es válido
         (hay prestadores que no sufren retención: extranjeros sin domicilio,
         casos con resolución del SII).
      2. La que la OC YA tiene, si venía siendo del mismo tipo. Invariante 5,
         snapshot: una OC de 2026 sigue con 15,25% aunque el SII suba la tasa
         en 2027, y un 0 cargado a propósito no se pisa.
      3. La vigente en `core.tax_config` a la FECHA DE EMISIÓN de la OC. Sólo
         cuando la OC ACABA de convertirse en honorarios y no traía tasa.
    Cualquier tipo que no sea honorarios devuelve 0 sin tocar la BD.

    La condición del paso 2 es "el tipo no cambió", NO "la tasa es > 0". Con
    `actual > 0` una OC de honorarios con retención 0 puesta a mano volvía a
    15,25% en cualquier PATCH que disparara el recálculo — la trampa del cero
    falso escrita con otra sintaxis, y además una violación del invariante de
    snapshot: el sistema le cambiaba la plata a una OC sin que nadie lo pida.
    """
    if (tipo_documento or "").upper() not in TIPOS_CON_RETENCION:
        return Decimal("0")
    if explicito is not None:
        return explicito
    era_del_mismo_tipo = (tipo_anterior or "").upper() == (
        tipo_documento or ""
    ).upper()
    if actual is not None and era_del_mismo_tipo:
        return actual
    return await _retencion_porcentaje_vigente(db, fecha_emision)


async def _assert_oc_sin_firmas(db: DBSession, oc: OrdenCompra) -> None:
    """Invariante 2: una OC firmada no cambia de tipo de documento ni de tasa.

    `_OC_EDITABLE_ESTADOS` bloquea el estado 'firmada', pero el estado y las
    firmas son dos cosas distintas: una OC puede tener una firma puesta y
    seguir figurando 'emitida' si el flujo quedó a mitad de camino. Cambiarle
    el tipo tributario después de que alguien la firmó altera un documento
    probatorio: el firmante aprobó un total con IVA y le queda uno con
    retención.

    409 y no 403 a propósito: no es falta de permiso — no hay permiso que lo
    habilite — es que el documento ya no admite ese cambio.
    """
    firmas = (
        await db.scalar(
            text(
                "SELECT COUNT(*) FROM core.oc_firmas "
                "WHERE oc_id = :id AND status = 'FIRMADA'"
            ),
            {"id": oc.oc_id},
        )
    ) or 0
    if firmas > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La OC {oc.numero_oc} ya tiene {firmas} firma(s) puesta(s): "
                "no se le puede cambiar el tipo de documento ni las tasas de "
                "IVA o retención. Es un documento probatorio. Si el tipo está "
                "mal, anulá la OC y emitila de nuevo."
            ),
        )

    # Segundo guard, independiente del anterior: plata ya girada. Una OC en
    # estado 'parcial' está dentro de `_OC_EDITABLE_ESTADOS` y puede tener
    # vouchers EXECUTED. Recalcularle los totales deja los hitos y los pagos
    # ya hechos apuntando a un total que dejó de existir — y en el caso de
    # honorarios la diferencia es exactamente la retención.
    # Es el mismo criterio que ya aplican `delete_oc` y `anular_oc`; faltaba
    # acá, que es el único camino por el que el total puede cambiar.
    # Misma condición que el guard de `delete_oc`: un voucher se ata a la OC
    # por `v.oc_id` (voucher creado sobre la OC) o por `oc_cuotas.voucher_id`
    # (voucher generado desde un hito). Mirar sólo uno de los dos caminos
    # dejaría pasar la mitad de los casos.
    con_plata = (
        await db.scalar(
            text(
                "SELECT COUNT(*) FROM core.vouchers v "
                "WHERE v.status = ANY(:estados) "
                "  AND (v.oc_id = :id "
                "       OR v.voucher_id IN (SELECT c.voucher_id "
                "                             FROM core.oc_cuotas c "
                "                            WHERE c.oc_id = :id "
                "                              AND c.voucher_id IS NOT NULL))"
            ),
            {"id": oc.oc_id, "estados": list(_VOUCHER_ESTADOS_CON_PLATA)},
        )
    ) or 0
    if con_plata > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La OC {oc.numero_oc} tiene {con_plata} pago(s) ya "
                "aprobado(s) o ejecutado(s): cambiarle el tipo de documento o "
                "las tasas movería el total contra el que se giró esa plata. "
                "Anulá la OC y emitila de nuevo con el tipo correcto."
            ),
        )


def _to_list_item(user: AuthenticatedUser, oc: OrdenCompra) -> OrdenCompraListItem:
    return OrdenCompraListItem(
        oc_id=oc.oc_id,
        numero_oc=oc.numero_oc,
        empresa_codigo=oc.empresa_codigo,
        proveedor_id=oc.proveedor_id,
        fecha_emision=oc.fecha_emision,
        moneda=oc.moneda,
        neto=oc.neto,
        total=oc.total,
        # Los tres datos, y que el listado elija (§3.1). `total` sigue siendo
        # el valor del contrato; `total_a_pagar` es lo que se gira; el tipo es
        # lo que permite saber si los dos difieren. Cuál se muestra en la
        # columna es una decisión de producto, pero la API no puede obligar a
        # adivinarla — sin estos campos el listado no podría ni distinguir una
        # boleta de honorarios de una factura.
        tipo_documento=oc.tipo_documento,
        retencion_monto=_col(oc, "retencion_monto", Decimal("0")),
        total_a_pagar=_col(oc, "total_a_pagar", oc.total),
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


def _to_read(user: AuthenticatedUser, oc: OrdenCompra) -> OrdenCompraRead:
    return OrdenCompraRead(
        oc_id=oc.oc_id,
        numero_oc=oc.numero_oc,
        empresa_codigo=oc.empresa_codigo,
        proveedor_id=oc.proveedor_id,
        fecha_emision=oc.fecha_emision,
        validez_dias=oc.validez_dias,
        moneda=oc.moneda,
        neto=oc.neto,
        iva=oc.iva,
        total=oc.total,
        forma_pago=oc.forma_pago,
        plazo_pago=oc.plazo_pago,
        plazo_entrega=oc.plazo_entrega,
        observaciones=oc.observaciones,
        proveedor_contacto_id=oc.proveedor_contacto_id,
        atte_nombre=oc.atte_nombre,
        atte_cargo=oc.atte_cargo,
        tipo_documento=oc.tipo_documento,
        iva_porcentaje=oc.iva_porcentaje,
        retencion_porcentaje=_col(oc, "retencion_porcentaje", Decimal("0")),
        retencion_monto=_col(oc, "retencion_monto", Decimal("0")),
        # Ninguna OC anterior a la migración tiene retención, así que en la
        # ventana previa al backfill el líquido ES el total. Con `_col` el
        # detalle nunca devuelve un `null` que el frontend imprima como "—".
        total_a_pagar=_col(oc, "total_a_pagar", oc.total),
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        items=[OCDetalleRead.model_validate(d) for d in (oc.items or [])],
        created_at=oc.created_at,
        updated_at=oc.updated_at,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


async def _persistir_unidades(
    db: DBSession, oc_id: int, items: list[OCDetalleCreate]
) -> None:
    """Graba `unidad` en core.ordenes_compra_detalle para los ítems recién creados.

    ¿Por qué acá y no en OrdenCompraRepository.create()? Porque el modelo ORM
    `OrdenCompraDetalle` no mapea la columna `unidad` (se agregó por migración
    SQL directa), así que el INSERT del repo no la puede escribir y la unidad
    se perdía. Un solo UPDATE con UNNEST — nada de un query por ítem — que
    matchea por (oc_id, item), que es UNIQUE en la tabla.

    No abre transacción propia: corre dentro de la del endpoint, antes del
    commit, para que la OC y sus unidades sean atómicas.
    """
    # Normalizamos acá (no en el schema) para que "  " no quede guardado como
    # unidad vacía y el PDF imprima "—" en vez de un espacio.
    pares = [
        (it.item, (it.unidad or "").strip())
        for it in items
        if (it.unidad or "").strip()
    ]
    if not pares:
        return
    await db.execute(
        text(
            """
            UPDATE core.ordenes_compra_detalle AS d
               SET unidad = u.unidad
              FROM UNNEST(CAST(:items AS INT[]), CAST(:unidades AS TEXT[]))
                   AS u(item, unidad)
             WHERE d.oc_id = :oc_id
               AND d.item = u.item
            """
        ),
        {
            "oc_id": oc_id,
            "items": [item for item, _ in pares],
            "unidades": [unidad for _, unidad in pares],
        },
    )


async def _leer_unidades(db: DBSession, oc_id: int) -> dict[int, str]:
    """Devuelve {detalle_id: unidad} de una OC en UNA query (sin N+1)."""
    rows = (
        await db.execute(
            text(
                "SELECT detalle_id, unidad FROM core.ordenes_compra_detalle "
                "WHERE oc_id = :oc_id AND unidad IS NOT NULL"
            ),
            {"oc_id": oc_id},
        )
    ).all()
    return {int(r[0]): str(r[1]) for r in rows}


async def _to_read_con_unidades(
    db: DBSession, user: AuthenticatedUser, oc: OrdenCompra
) -> OrdenCompraRead:
    """`_to_read` + hidratación de `unidad` por ítem.

    El ORM no trae `unidad` (columna no mapeada), así que sin esto la API
    devolvería siempre `unidad: null` aunque en la BD esté cargada — mentirle
    al frontend sobre un dato que el PDF sí imprime.
    """
    out = _to_read(user, oc)
    if not out.items:
        return out
    unidades = await _leer_unidades(db, oc.oc_id)
    if unidades:
        for item in out.items:
            item.unidad = unidades.get(item.detalle_id)
    return out


async def _resolve_atte_snapshot(
    db: DBSession, proveedor_id: int, proveedor_contacto_id: int
) -> tuple[str, str | None]:
    """Nombre/cargo del encargado elegido, para snapshotear en atte_nombre/
    atte_cargo. 404 explícito si el contacto no existe o es de otro
    proveedor — evitar que una OC quede "dirigida a" alguien de otra empresa
    por un id mal armado en el body.
    """
    row = (
        await db.execute(
            text(
                """SELECT nombre, cargo FROM core.proveedor_contactos
                   WHERE contacto_id = :cid AND proveedor_id = :pid AND activo"""
            ),
            {"cid": proveedor_contacto_id, "pid": proveedor_id},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"El contacto {proveedor_contacto_id} no existe en el "
                f"catálogo del proveedor {proveedor_id}."
            ),
        )
    return str(row[0]), (str(row[1]) if row[1] else None)


@router.get("", response_model=Page[OrdenCompraListItem])
async def list_ocs(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    empresa_codigo: str | None = None,
    estado: str | None = None,
) -> Page[OrdenCompraListItem]:
    """V5++ ola AD: auto-filtra por empresas a las que el user tiene rol."""
    repo = OrdenCompraRepository(db)

    # Multi-tenant scope
    scoped_codes = scope.filter_codes(empresa_codigo)
    # Si scope retornó 1 código, usamos empresa_codigo. Si retornó lista, usamos in.
    if scoped_codes is not None and len(scoped_codes) == 1:
        empresa_codigo = scoped_codes[0]
        scoped_codes = None

    items, total = await repo.list(
        page=page,
        size=size,
        empresa_codigo=empresa_codigo,
        estado=estado,
        empresa_codigos_in=scoped_codes,
    )
    return Page.build(
        items=[_to_list_item(user, oc) for oc in items],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=OrdenCompraRead, status_code=status.HTTP_201_CREATED)
async def create_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    request: Request,
    body: OrdenCompraCreate,
) -> OrdenCompraRead:
    # V5++ ola AD: validar acceso a empresa
    await assert_empresa_access(user, db, body.empresa_codigo)

    # §4.3 — coherencia tributaria ANTES de tocar nada. Si el tipo y la tasa
    # se contradicen no tiene sentido haber auto-creado un proveedor primero:
    # el 422 dejaría el proveedor huérfano en la BD.
    retencion_explicita = _campo_explicito(body, "retencion_porcentaje")
    _validar_coherencia_tributaria(
        tipo_documento=body.tipo_documento,
        moneda=body.moneda,
        retencion_porcentaje=retencion_explicita,
    )
    # La tasa por defecto de un honorario sale de core.tax_config POR LA FECHA
    # DE EMISIÓN, no de una constante: una OC fechada en 2027 tiene que nacer
    # con 16%. Se resuelve acá arriba, antes de cualquier INSERT, para que el
    # SAVEPOINT de la consulta no se cruce con nada escrito.
    retencion_pct = await _resolver_retencion_porcentaje(
        db,
        tipo_documento=body.tipo_documento,
        fecha_emision=body.fecha_emision,
        explicito=retencion_explicita,
    )

    # R152EEEEEE — Guard explícito: una OC SIN proveedor identificable
    # quedaba con proveedor_id=NULL → orphan FK, rompía reportes,
    # auditoría legal sin contraparte. Exigir id O rut+nombre.
    if body.proveedor_id is None and not body.proveedor_rut:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Falta el proveedor. Proporcioná proveedor_id (existente) "
                "o proveedor_rut + proveedor_nombre para crearlo."
            ),
        )

    # V5++ ola CE: auto-resolver/crear proveedor si vino RUT+nombre en lugar
    # de proveedor_id. Mismo patron que el form Nubox de vouchers.
    if body.proveedor_id is None and body.proveedor_rut:
        if not validate_rut(body.proveedor_rut):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"RUT proveedor '{body.proveedor_rut}' invalido "
                    "(digito verificador incorrecto)."
                ),
            )
        rut_canonical = format_rut(body.proveedor_rut)
        prov_repo = ProveedorRepository(db)
        proveedor = await prov_repo.get_by_rut(rut_canonical)
        if proveedor is None:
            if not body.proveedor_nombre or not body.proveedor_nombre.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Proveedor no existe y falta proveedor_nombre para "
                        "crearlo automaticamente."
                    ),
                )
            proveedor = await prov_repo.create(
                ProveedorCreate(
                    rut=rut_canonical,
                    razon_social=body.proveedor_nombre.strip(),
                )
            )
        # Reemplazamos el body con proveedor_id resuelto.
        body = body.model_copy(update={"proveedor_id": proveedor.proveedor_id})

    # Si vino un contacto del catálogo, el catálogo manda: resolvemos
    # nombre/cargo ahí y pisamos lo que haya venido suelto en atte_nombre/
    # atte_cargo (evita mandar un texto libre inconsistente con el id).
    if body.proveedor_contacto_id is not None and body.proveedor_id is not None:
        atte_nombre, atte_cargo = await _resolve_atte_snapshot(
            db, body.proveedor_id, body.proveedor_contacto_id
        )
        body = body.model_copy(
            update={"atte_nombre": atte_nombre, "atte_cargo": atte_cargo}
        )

    repo = OrdenCompraRepository(db)
    # Optimistic check para feedback rápido — pero el verdadero gate es el
    # IntegrityError abajo (cierra ventana TOCTOU en alta concurrencia).
    if await repo.exists_numero_oc(body.empresa_codigo, body.numero_oc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {body.empresa_codigo}",
        )
    # El cliente propone, el servidor calcula: iva, retención, total y
    # total_a_pagar salen de una sola función y jamás del body.
    derived = _derivar_totales_oc(
        neto=body.neto or Decimal("0"),
        moneda=body.moneda,
        tipo_documento=body.tipo_documento,
        iva_porcentaje=body.iva_porcentaje,
        retencion_porcentaje=retencion_pct,
    )
    try:
        oc = await repo.create(body, derived=derived)
        # La unidad de cada ítem va en el mismo commit que la OC (ver
        # `_persistir_unidades`: el repo no puede escribirla).
        await _persistir_unidades(db, oc.oc_id, body.items)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {body.empresa_codigo}",
        ) from exc
    oc_id_created = oc.oc_id
    oc = await repo.get(oc_id_created)  # re-fetch para cargar items via selectin
    if not oc:
        import structlog
        structlog.get_logger(__name__).error(
            "oc_refetch_failed_after_create",
            oc_id=oc_id_created,
            empresa=body.empresa_codigo,
            numero_oc=body.numero_oc,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"OC #{oc_id_created} creada pero no se pudo recargar para "
                "devolver. Refrescá la lista en unos segundos."
            ),
        )
    creada = await _to_read_con_unidades(db, user, oc)
    after = creada.model_dump(mode="json")
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="orden_compra",
        entity_id=str(oc.oc_id),
        entity_label=oc.numero_oc,
        summary=f"OC {oc.numero_oc} creada para {oc.empresa_codigo}",
        before=None,
        after=after,
    )
    # Webhook: oc.created — suscriptores externos reciben el alta de OC.
    await publish_event(
        db,
        "oc.created",
        {
            "oc_id": oc.oc_id,
            "numero_oc": oc.numero_oc,
            "empresa_codigo": oc.empresa_codigo,
            "proveedor_id": oc.proveedor_id,
            "total": float(oc.total) if oc.total else None,
            # Campos NUEVOS, no redefinición de `total` (§3.1). Los
            # suscriptores externos ya publicados siguen leyendo `total` con
            # el mismo significado de siempre; el que quiera saber cuánta
            # plata sale lee `total_a_pagar` y lo elige explícitamente.
            "total_a_pagar": float(_col(oc, "total_a_pagar", oc.total)),
            "retencion_monto": float(_col(oc, "retencion_monto", Decimal("0"))),
            "tipo_documento": oc.tipo_documento,
            "moneda": oc.moneda,
            "estado": oc.estado,
            "created_by": str(user.sub),
        },
    )
    return creada


@router.get("/{oc_id:int}", response_model=OrdenCompraRead)
async def get_oc(
    user: CurrentUser, db: DBSession, scope: EmpresaScopeDep, oc_id: int
) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    # V5++ ola AD: scope check
    if not scope.can_access(oc.empresa_codigo):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Sin acceso a OCs de empresa '{oc.empresa_codigo}'",
        )
    return await _to_read_con_unidades(db, user, oc)


_OC_EDITABLE_ESTADOS = {"emitida", "parcial"}


# V5++ ola CG — Renderizado HTML branded de OC (para print → PDF)
@router.get("/{oc_id:int}.html", response_class=Response)
async def get_oc_html(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    oc_id: int,
) -> Response:
    """Renderiza la OC como HTML branded (con logo de la empresa emisora).

    Print-friendly: el browser convierte a PDF con Ctrl+P sin perder
    formato. No genera PDF server-side para mantenerlo simple y
    multi-plataforma.

    Si la empresa tiene logo_dropbox_path, se incluye via URL temporal
    Dropbox (4h). Sino, fallback a razón social en texto grande.
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=404, detail="OC no encontrada")
    if not scope.can_access(oc.empresa_codigo):
        raise HTTPException(status_code=403, detail="Sin acceso a esta OC")

    # Datos de la empresa emisora
    from sqlalchemy import text as _text

    empresa_row = (
        await db.execute(
            _text(
                """
                SELECT codigo, razon_social, rut, direccion, ciudad, telefono,
                       representante_legal, email_firmante, logo_dropbox_path
                FROM core.empresas
                WHERE codigo = :cod
                """
            ),
            {"cod": oc.empresa_codigo},
        )
    ).mappings().first()

    empresa_dict = dict(empresa_row) if empresa_row else {"codigo": oc.empresa_codigo}

    # Logo URL temporal si hay path
    logo_url: str | None = None
    if empresa_dict.get("logo_dropbox_path"):
        try:
            from app.infrastructure.repositories.integration_repository import (
                IntegrationRepository,
            )
            from app.services.dropbox_service import DropboxNotConfigured, DropboxService
            import asyncio as _asyncio

            integration_repo = IntegrationRepository(db)
            integration = await integration_repo.get_by_provider("dropbox")
            if integration and integration.access_token:
                dbx = DropboxService(
                    access_token=integration.access_token,
                    refresh_token=integration.refresh_token,
                )
                logo_url = await _asyncio.to_thread(
                    dbx.get_temporary_link, empresa_dict["logo_dropbox_path"]
                )
        except Exception:  # noqa: BLE001
            # Sin logo si Dropbox falla — el render hace fallback a texto
            pass

    # Datos del proveedor
    proveedor_dict: dict | None = None
    if oc.proveedor_id:
        prov_row = (
            await db.execute(
                _text(
                    """
                    SELECT razon_social, rut, direccion, email
                    FROM core.proveedores
                    WHERE proveedor_id = :pid
                    """
                ),
                {"pid": oc.proveedor_id},
            )
        ).mappings().first()
        if prov_row:
            proveedor_dict = dict(prov_row)

    # OC dict
    oc_dict = {
        "numero_oc": oc.numero_oc,
        "estado": oc.estado,
        "fecha_emision": oc.fecha_emision.isoformat(),
        "validez_dias": oc.validez_dias,
        "moneda": oc.moneda,
        "neto": str(oc.neto),
        "iva": str(oc.iva),
        "total": str(oc.total),
        # Sin estos cuatro, este HTML imprimía una boleta de honorarios como
        # si fuera una factura: el BRUTO rotulado "Total", sin línea de
        # retención, sin líquido y sin decir de qué documento tributario se
        # trata. Es la misma inducción a error que el PDF v2 evita, en un
        # endpoint que también termina impreso (está pensado para Ctrl+P).
        "tipo_documento": oc.tipo_documento or "FACTURA",
        "iva_porcentaje": str(oc.iva_porcentaje),
        "retencion_porcentaje": str(_col(oc, "retencion_porcentaje", Decimal("0"))),
        "retencion_monto": str(_col(oc, "retencion_monto", Decimal("0"))),
        "total_a_pagar": str(_col(oc, "total_a_pagar", oc.total)),
        "forma_pago": oc.forma_pago or "",
        "plazo_pago": oc.plazo_pago or "",
        "observaciones": oc.observaciones or "",
    }

    # Items
    items_list = [
        {
            "item": d.item,
            "descripcion": d.descripcion,
            "cantidad": str(d.cantidad),
            "precio_unitario": str(d.precio_unitario),
            "total_linea": str(d.total_linea) if d.total_linea else "0",
        }
        for d in (oc.items or [])
    ]

    from app.services.report_renderer_service import render_orden_compra_html

    html = render_orden_compra_html(
        oc=oc_dict,
        items=items_list,
        empresa=empresa_dict,
        proveedor=proveedor_dict,
        logo_url=logo_url,
    )
    return Response(content=html, media_type="text/html")


# =====================================================================
# GET /ordenes-compra/{oc_id}/pdf — descarga PDF branded + attachments
# =====================================================================


@router.get("/{oc_id:int}/pdf")
async def download_oc_pdf(
    oc_id: int,
    user: CurrentUser,
    db: DBSession,
    include_attachments: bool = True,
):
    """Genera un PDF branded de la OC con (opcional) adjuntos incrustados.

    El cover trae header de la empresa emisora (logo + razón social + RUT),
    título "ORDEN DE COMPRA", ficha del proveedor, info grid de fechas y
    forma de pago, tabla de items con totales, observaciones (si las hay)
    y placeholder de firma.

    Si `include_attachments=True` (default) y existe la tabla
    `core.oc_attachments`, los adjuntos se mergean al final del PDF.
    Falla silenciosa: errores fetching del logo o de adjuntos no rompen
    la generación.

    R152KKKK — logging estructurado para diagnosticar "Failed to fetch"
    reportado por el operador. Cada step loggea para que en Fly logs
    podamos ver dónde se cuelga.
    """
    import time as _time

    from fastapi.responses import StreamingResponse
    import structlog

    from app.services.oc_pdf_service import generate_oc_pdf_bundle

    _pdf_log = structlog.get_logger(__name__)
    t0 = _time.monotonic()

    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OC no encontrada",
        )
    await assert_empresa_access(user, db, oc.empresa_codigo)
    # R152UUUUUU — capturar los atributos ANTES del try/rollback de abajo:
    # si el SELECT de oc_template falla y se hace rollback, el objeto ORM
    # queda expirado y `oc.numero_oc` lanza MissingGreenlet (500) justo al
    # armar el filename, después de haber generado el PDF completo.
    oc_numero = oc.numero_oc
    oc_empresa = oc.empresa_codigo
    _pdf_log.info(
        "oc_pdf.start",
        oc_id=oc_id,
        empresa=oc_empresa,
        include_attachments=include_attachments,
        user_email=getattr(user, "email", None),
    )

    # R152QQQQ — dispatch v1 reportlab vs v2 HTML+CSS+WeasyPrint.
    # Feature flag via settings.oc_pdf_renderer ("v1" default | "v2").
    try:
        from app.core.config import settings as _settings
        renderer = (getattr(_settings, "oc_pdf_renderer", "v1") or "v1").lower()
    except Exception:
        renderer = "v1"

    # R152MMMMMM — si la empresa tiene template custom (ej. RHO →
    # 'panimavida'), forzamos v2 aunque el flag global siga en v1.
    # Best-effort: si la columna no existe aún, sigue el flag global.
    try:
        emp_template = await db.scalar(
            text("SELECT oc_template FROM core.empresas WHERE codigo = :c"),
            {"c": oc.empresa_codigo},
        )
        if (emp_template or "").lower() == "panimavida":
            renderer = "v2"
            _pdf_log.info(
                "oc_pdf.template_override", oc_id=oc_id, template=emp_template
            )
    except Exception:
        import contextlib as _ctx
        with _ctx.suppress(Exception):
            await db.rollback()

    try:
        if renderer == "v2":
            from app.services.oc_pdf_v2_service import generate_oc_pdf_v2_bundle
            _pdf_log.info("oc_pdf.using_v2", oc_id=oc_id)
            pdf_bytes = await generate_oc_pdf_v2_bundle(
                oc_id=oc_id,
                db=db,
                include_attachments=include_attachments,
                generated_by_email=getattr(user, "email", None),
            )
        else:
            pdf_bytes = await generate_oc_pdf_bundle(
                oc_id=oc_id,
                db=db,
                include_attachments=include_attachments,
                # Round 14 — footer notarial registra user que descargo.
                generated_by_email=getattr(user, "email", None),
            )
    except ValueError as exc:
        _pdf_log.warning("oc_pdf.value_error", oc_id=oc_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001
        _pdf_log.error(
            "oc_pdf.generation_failed",
            oc_id=oc_id,
            error=str(exc),
            error_type=type(exc).__name__,
            duration_s=round(_time.monotonic() - t0, 2),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generando PDF de la OC: {exc}",
        ) from exc

    _pdf_log.info(
        "oc_pdf.success",
        oc_id=oc_id,
        pdf_bytes=len(pdf_bytes),
        duration_s=round(_time.monotonic() - t0, 2),
    )

    # OC-FILENAME — el nombre lo arma oc_filename_util (misma regla que el
    # frontend). Antes era f"oc-{oc_numero}.pdf": minúscula y con el prefijo
    # duplicado, porque los numero_oc reales ya empiezan con "OC".
    # Content-Disposition va con fallback ASCII + filename* RFC 5987: Starlette
    # codifica los headers en latin-1 y un número con un carácter fuera de
    # latin-1 tiraba un 500 al descargar.
    content_disposition = oc_pdf_content_disposition(oc_numero)

    # Round 17 — audit log de descarga PDF (forense). Soft-fail.
    # R152KKKK — Bug fix: `request` no estaba en scope. Lo omito (audit_log
    # acepta request=None, solo pierde el IP/user-agent en el registro).
    try:
        await audit_log(
            db, None, user,
            action="download_pdf",
            entity_type="orden_compra",
            entity_id=str(oc_id),
            entity_label=str(oc_numero),
            summary=(
                f"Descarga PDF de OC {oc_numero} "
                f"({len(pdf_bytes)} bytes, attachments={include_attachments})"
            ),
            before=None,
            after={
                "bytes": len(pdf_bytes),
                "include_attachments": include_attachments,
                "empresa_codigo": oc_empresa,
            },
        )
    except Exception:
        pass

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": content_disposition,
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.post(
    "/{oc_id:int}/duplicate",
    response_model=OrdenCompraRead,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    request: Request,
    oc_id: int,
    body: DuplicateOcRequest,
) -> OrdenCompraRead:
    """Duplica una OC existente. Copia proveedor, items, montos, moneda, forma_pago.

    El user pasa el numero_oc nuevo (obligatorio, no auto-generamos para no
    pisar correlativos manuales). Opcionalmente puede sobrescribir fecha_emision
    y observaciones; el resto se hereda del original.

    La OC duplicada arranca en estado 'emitida' sin pdf_url (se generara cuando
    el flujo de export lo dispare).
    """
    repo = OrdenCompraRepository(db)
    original = await repo.get(oc_id)
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    # Scope check sobre la empresa del original (el duplicado vive en la misma).
    await assert_empresa_access(user, db, original.empresa_codigo)
    # Numero unico por empresa: si el nuevo ya existe, 409 sin tocar nada.
    if await repo.exists_numero_oc(original.empresa_codigo, body.numero_oc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {original.empresa_codigo}",
        )
    # La unidad de cada ítem del original en UNA query: el ORM no la mapea,
    # y sin esto el duplicado perdería las unidades (aparecerían como "—"
    # en el PDF de la copia).
    unidades_originales = await _leer_unidades(db, original.oc_id)

    fecha_dup = body.fecha_emision or date.today()
    # El tipo de documento y el IVA% se copian; la tasa de RETENCIÓN no: se
    # relee por la fecha de emisión del duplicado. Un duplicado es una OC
    # nueva y la escala del Art. 74 N°2 sube todos los años — arrastrar el
    # 15,25% de 2026 a una OC de 2027 retiene de menos, y la diferencia se la
    # come el mandante ante el SII. El invariante 5 (snapshot) protege a la OC
    # original de re-derivarse, no a su copia. Si la tasa era pactada distinto,
    # se corrige con un PATCH sobre el duplicado.
    _validar_coherencia_tributaria(
        tipo_documento=original.tipo_documento,
        moneda=original.moneda,
        retencion_porcentaje=None,
    )
    retencion_pct_dup = await _resolver_retencion_porcentaje(
        db,
        tipo_documento=original.tipo_documento,
        fecha_emision=fecha_dup,
        explicito=None,
        # El duplicado HEREDA la tasa del original (mismo tipo → gana el
        # snapshot). Sin esto, duplicar una OC de honorarios con retención 0
        # cargada a mano devolvía una con 15,25%: duplicar le cambiaría la
        # plata al documento en silencio, que es justo lo que nadie espera
        # del botón "Duplicar".
        actual=_col(original, "retencion_porcentaje", None),
        tipo_anterior=original.tipo_documento,
    )
    # Construir el OrdenCompraCreate copiando los campos del original. Los
    # montos los deriva el servidor abajo (`_derivar_totales_oc`), nunca el
    # schema, asi que no hay riesgo de inconsistencia.
    duplicate_payload = OrdenCompraCreate(
        numero_oc=body.numero_oc,
        empresa_codigo=original.empresa_codigo,
        proveedor_id=original.proveedor_id,
        fecha_emision=fecha_dup,
        validez_dias=original.validez_dias,
        moneda=original.moneda,  # type: ignore[arg-type]
        neto=original.neto,
        forma_pago=original.forma_pago,
        plazo_pago=original.plazo_pago,
        plazo_entrega=original.plazo_entrega,
        observaciones=body.observaciones if body.observaciones is not None else original.observaciones,
        proveedor_contacto_id=original.proveedor_contacto_id,
        atte_nombre=original.atte_nombre,
        atte_cargo=original.atte_cargo,
        tipo_documento=original.tipo_documento,
        iva_porcentaje=original.iva_porcentaje,
        retencion_porcentaje=retencion_pct_dup,
        items=[
            OCDetalleCreate(
                item=d.item,
                descripcion=d.descripcion,
                unidad=unidades_originales.get(d.detalle_id),
                precio_unitario=d.precio_unitario,
                cantidad=d.cantidad,
            )
            for d in (original.items or [])
        ],
    )
    derived_dup = _derivar_totales_oc(
        neto=duplicate_payload.neto or Decimal("0"),
        moneda=duplicate_payload.moneda,
        tipo_documento=duplicate_payload.tipo_documento,
        iva_porcentaje=duplicate_payload.iva_porcentaje,
        retencion_porcentaje=retencion_pct_dup,
    )
    try:
        new_oc = await repo.create(duplicate_payload, derived=derived_dup)
        await _persistir_unidades(db, new_oc.oc_id, duplicate_payload.items)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {original.empresa_codigo}",
        ) from exc
    new_oc_id = new_oc.oc_id
    new_oc = await repo.get(new_oc_id)
    if not new_oc:  # pragma: no cover — invariant
        import structlog
        structlog.get_logger(__name__).error(
            "oc_refetch_failed_after_duplicate",
            new_oc_id=new_oc_id,
            source_oc_id=oc_id,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"OC #{new_oc_id} duplicada pero no se pudo recargar. "
                "Refrescá la lista para verla."
            ),
        )
    duplicada = await _to_read_con_unidades(db, user, new_oc)
    after = duplicada.model_dump(mode="json")
    # Que la retención cambió al duplicar tiene que quedar dicho en la
    # auditoría: es el único campo que NO se copia, y si el operador no lo
    # espera, lo descubre en el PDF y no sabe por qué.
    retencion_original = _col(original, "retencion_porcentaje", Decimal("0"))
    nota_retencion = (
        f" · retención {retencion_original}% → {retencion_pct_dup}% "
        f"(tasa vigente al {fecha_dup})"
        if retencion_pct_dup != retencion_original
        else ""
    )
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="orden_compra",
        entity_id=str(new_oc.oc_id),
        entity_label=new_oc.numero_oc,
        summary=(
            f"OC {new_oc.numero_oc} duplicada desde {original.numero_oc} "
            f"({original.empresa_codigo}){nota_retencion}"
        ),
        before=None,
        after=after,
    )
    await publish_event(
        db,
        "oc.created",
        {
            "oc_id": new_oc.oc_id,
            "numero_oc": new_oc.numero_oc,
            "empresa_codigo": new_oc.empresa_codigo,
            "proveedor_id": new_oc.proveedor_id,
            "total": float(new_oc.total) if new_oc.total else None,
            "total_a_pagar": float(_col(new_oc, "total_a_pagar", new_oc.total)),
            "retencion_monto": float(
                _col(new_oc, "retencion_monto", Decimal("0"))
            ),
            "tipo_documento": new_oc.tipo_documento,
            "moneda": new_oc.moneda,
            "estado": new_oc.estado,
            "created_by": str(user.sub),
            "duplicated_from_oc_id": original.oc_id,
        },
    )
    return duplicada


@router.patch("/{oc_id}", response_model=OrdenCompraRead)
async def update_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    request: Request,
    oc_id: int,
    body: OrdenCompraUpdate,
) -> OrdenCompraRead:
    """Edita campos no-críticos. Estado se cambia vía `/{oc_id}/estado`.

    V5++ ola CJ — scope check sobre `oc.empresa_codigo` (era un gap
    crítico: user con oc:update global podía editar OC de empresa ajena).
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    await assert_empresa_access(user, db, oc.empresa_codigo)
    if oc.estado not in _OC_EDITABLE_ESTADOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo OCs en estado 'emitida' o 'parcial' son editables",
        )
    before = _to_read(user, oc).model_dump(mode="json")

    # Si viene un contacto del catálogo, el catálogo manda (mismo criterio
    # que en la creación): resuelve y pisa atte_nombre/atte_cargo sueltos.
    if body.proveedor_contacto_id is not None:
        if oc.proveedor_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta OC no tiene proveedor asociado, no se le puede asignar un contacto.",
            )
        atte_nombre, atte_cargo = await _resolve_atte_snapshot(
            db, oc.proveedor_id, body.proveedor_contacto_id
        )
        body = body.model_copy(
            update={"atte_nombre": atte_nombre, "atte_cargo": atte_cargo}
        )

    # iva / retención / total / total_a_pagar son DERIVADOS del neto y del
    # tipo de documento: nunca vienen directo en el body. El disparador del
    # recálculo son las TRES entradas, no sólo el IVA%. Antes miraba únicamente
    # `iva_porcentaje`, y un PATCH {"tipo_documento": "HONORARIOS"} dejaba la
    # OC marcada como honorario con el IVA del 19% intacto y sin retención:
    # incoherente con el CHECK de la BD (IntegrityError → 500 opaco), con el
    # PDF y con lo que después se le gira al profesional.
    tipo_nuevo = _campo_explicito(body, "tipo_documento")
    iva_pct_nuevo = _campo_explicito(body, "iva_porcentaje")
    ret_pct_nuevo = _campo_explicito(body, "retencion_porcentaje")

    derived: dict = {}
    if tipo_nuevo is not None or iva_pct_nuevo is not None or ret_pct_nuevo is not None:
        # Invariante 2 — el estado 'firmada' ya está fuera de
        # `_OC_EDITABLE_ESTADOS`, pero las firmas y el estado son cosas
        # distintas: chequeamos la evidencia, no la etiqueta.
        await _assert_oc_sin_firmas(db, oc)
        tipo_efectivo = tipo_nuevo if tipo_nuevo is not None else oc.tipo_documento
        _validar_coherencia_tributaria(
            tipo_documento=tipo_efectivo,
            moneda=oc.moneda,
            retencion_porcentaje=ret_pct_nuevo,
        )
        # La fecha de emisión NO se puede editar (no está en el schema), así
        # que la tasa por defecto de un honorario sigue siendo la del año en
        # que se emitió la OC. Cambiar de FACTURA a HONORARIOS en 2026 no
        # trae la tasa de hoy: trae la que correspondía a esa OC.
        retencion_pct = await _resolver_retencion_porcentaje(
            db,
            tipo_documento=tipo_efectivo,
            fecha_emision=oc.fecha_emision,
            explicito=ret_pct_nuevo,
            actual=_col(oc, "retencion_porcentaje", Decimal("0")),
            tipo_anterior=oc.tipo_documento,
        )
        derived = _derivar_totales_oc(
            neto=oc.neto,
            moneda=oc.moneda,
            tipo_documento=tipo_efectivo,
            iva_porcentaje=_iva_porcentaje_efectivo(
                tipo_efectivo,
                explicito=iva_pct_nuevo,
                actual=oc.iva_porcentaje,
                tipo_anterior=oc.tipo_documento,
            ),
            retencion_porcentaje=retencion_pct,
        )

    updated = await repo.update_fields(oc, body, derived=derived)
    await db.commit()
    # re-fetch para refrescar items via selectin
    refreshed = await repo.get(oc_id)
    if not refreshed:  # pragma: no cover — invariant
        import structlog
        structlog.get_logger(__name__).error(
            "oc_refetch_failed_after_edit",
            oc_id=oc_id,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"OC #{oc_id} editada pero no se pudo recargar. "
                "Refrescá la pagina para ver los cambios."
            ),
        )
    after = _to_read(user, refreshed).model_dump(mode="json")
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=refreshed.numero_oc,
        summary=f"OC {refreshed.numero_oc} editada",
        before=before,
        after=after,
    )
    # Con unidades: el PATCH no las toca, pero la respuesta alimenta la
    # pantalla de detalle y no pueden "desaparecer" tras editar la cabecera.
    return await _to_read_con_unidades(db, user, refreshed)


# =====================================================================
# DELETE /ordenes-compra/{oc_id} — borrar OC mal cargada
# =====================================================================
#
# El criterio NO es el estado por sí solo sino el impacto real:
#   1. ¿Hay una firma puesta? → documento firmado, evidencia legal, no se
#      borra nunca (se anula).
#   2. ¿Hay plata comprometida o movida (vouchers APPROVED/EXECUTED/
#      SYNCED/RECONCILED)? → no se borra, hay que revertir la plata primero.
# Si no pasa ninguna de las dos, la OC es "papel" y se puede borrar.
#
# Por eso el allowlist de estados incluye los 4 estados PRE-firma:
# `borrador`, `emitida`, `en_firma` y `anulada`. Los estados posteriores
# (`firmada`, `enviada_proveedor`, `facturada`) y los que implican pago
# (`parcial`, `pagada`) quedan fuera: ahí el camino es anular, no borrar.
_OC_ESTADOS_BORRABLES = ("borrador", "emitida", "en_firma", "anulada")
_VOUCHER_ESTADOS_CON_PLATA = ("APPROVED", "EXECUTED", "SYNCED", "RECONCILED")


@router.delete(
    "/{oc_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("oc:update"))],
)
async def delete_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    request: Request,
    oc_id: int,
) -> Response:
    """Borra fisicamente una OC mal cargada. Estados permitidos: borrador,
    emitida, en_firma, anulada.

    Bloqueos (409, con explicacion de que hacer en su lugar):
      · la OC tiene al menos una firma con status='FIRMADA' → documento
        firmado, evidencia legal, se anula pero no se borra;
      · la OC tiene vouchers APPROVED/EXECUTED/SYNCED/RECONCILED (directos
        via vouchers.oc_id o via sus cuotas) → ya hay plata comprometida.
    Ambas condiciones se chequean en UNA sola query (subselects), no una
    query por condicion.

    Borrado en cascada — verificado contra las FK reales:
      · core.ordenes_compra_detalle  ON DELETE CASCADE (+ cascade ORM)
      · core.oc_cuotas               ON DELETE CASCADE  → forma de pago
      · core.oc_firmas               ON DELETE CASCADE  → firmantes pendientes
      · core.oc_attachments          ON DELETE CASCADE  → adjuntos del email
      · core.vouchers.oc_id          ON DELETE SET NULL → el voucher sobrevive
      · webhooks/eventos de email    ON DELETE SET NULL
    La excepcion es core.inbox_messages.linked_oc_id, cuya FK quedo SIN
    ON DELETE (NO ACTION): si la OC nacio de un email, Postgres abortaba el
    DELETE con un 500 opaco. Lo desligamos explicitamente antes de borrar —
    mismo efecto que un SET NULL, el correo NO se borra.

    V5++ ola CJ — scope check sobre empresa.
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, oc.empresa_codigo)
    if oc.estado not in _OC_ESTADOS_BORRABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La OC {oc.numero_oc} esta en estado '{oc.estado}' y ya no se "
                "puede borrar: solo se borran las que todavia no avanzaron "
                "(borrador, emitida, en firma o anulada). Si esta mal cargada, "
                "anulala — queda registrada como anulada y no se puede pagar."
            ),
        )

    # UNA query: firmas puestas + quienes firmaron + vouchers con plata.
    # Los vouchers se cuentan una sola vez aunque esten enlazados por los dos
    # caminos (vouchers.oc_id directo y oc_cuotas.voucher_id).
    guard = (
        await db.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(*) FROM core.oc_firmas f
                      WHERE f.oc_id = :id AND f.status = 'FIRMADA')
                        AS firmas,
                    (SELECT string_agg(
                                DISTINCT COALESCE(f.firmante_nombre,
                                                  f.firmante_email),
                                ', ')
                       FROM core.oc_firmas f
                      WHERE f.oc_id = :id AND f.status = 'FIRMADA')
                        AS firmantes,
                    (SELECT COUNT(*) FROM core.vouchers v
                      WHERE v.status = ANY(:estados_plata)
                        AND (v.oc_id = :id
                             OR v.voucher_id IN (
                                 SELECT c.voucher_id FROM core.oc_cuotas c
                                  WHERE c.oc_id = :id
                                    AND c.voucher_id IS NOT NULL)))
                        AS vouchers
                """
            ),
            {"id": oc_id, "estados_plata": list(_VOUCHER_ESTADOS_CON_PLATA)},
        )
    ).mappings().one()

    if (guard["firmas"] or 0) > 0:
        quienes = guard["firmantes"] or "un firmante"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Esta OC ya la firmo {quienes}. Un documento firmado no se "
                "puede borrar porque es respaldo legal de la operacion. "
                f"Anulala en vez de borrarla: la OC {oc.numero_oc} queda como "
                "anulada, sin efecto, y con el historial intacto."
            ),
        )
    if (guard["vouchers"] or 0) > 0:
        cantidad = guard["vouchers"]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Esta OC tiene {cantidad} voucher(s) aprobado(s) o pagado(s) "
                "asociados: ya se comprometio o se movio la plata, y borrarla "
                "dejaria esos pagos sin respaldo. Primero anula o revierte "
                "esos vouchers; si igual queres dejarla sin efecto, anula la "
                f"OC {oc.numero_oc}."
            ),
        )

    numero_oc = oc.numero_oc
    estado_prev = oc.estado
    empresa_prev = oc.empresa_codigo
    # Snapshot completo (con unidades) ANTES de borrar: es lo unico que queda
    # de la OC en el audit_log si despues hay que reconstruirla.
    before = (await _to_read_con_unidades(db, user, oc)).model_dump(mode="json")
    # Desligar los emails que apuntan a esta OC (la FK no tiene ON DELETE).
    # El correo queda en la bandeja, solo pierde el vinculo.
    await db.execute(
        text(
            "UPDATE core.inbox_messages SET linked_oc_id = NULL "
            "WHERE linked_oc_id = :id"
        ),
        {"id": oc_id},
    )
    try:
        await db.delete(oc)
        await db.commit()
    except IntegrityError as exc:
        # Alguna FK sin ON DELETE que no cubrimos: mejor un mensaje claro
        # que un 500 opaco.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se pudo borrar la OC {numero_oc}: todavia hay registros "
                "en el sistema que dependen de ella. Anulala en vez de "
                "borrarla, o avisa a soporte con este numero de OC."
            ),
        ) from exc
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=numero_oc,
        summary=f"OC {numero_oc} eliminada (estado previo: {estado_prev}, empresa: {empresa_prev})",
        before=before,
        after=None,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{oc_id}/estado", response_model=OrdenCompraRead)
async def update_estado(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    oc_id: int,
    body: EstadoUpdateRequest,
) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)

    # R152YYYYY — Row lock pesimista para evitar race conditions.
    # Sin esto, 2 PATCH simultáneos pasaban ambos el check de estado y
    # ambos hacían update — la 2da transición podía ser ilegal (ej.
    # PENDING→APPROVED→EXECUTED sin firmar). SELECT FOR UPDATE serializa.
    locked = (
        await db.execute(
            text("SELECT oc_id FROM core.ordenes_compra WHERE oc_id = :id FOR UPDATE"),
            {"id": oc_id},
        )
    ).first()
    if locked is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")

    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")

    # V5++ ola CJ — scope check sobre empresa.
    await assert_empresa_access(user, db, oc.empresa_codigo)
    allowed = _authz.allowed_actions_for_oc(user, oc.estado)
    _ESTADO_ACTION = {"pagada": "mark_paid", "anulada": "cancel", "parcial": "mark_paid"}
    required = _ESTADO_ACTION.get(body.estado)
    if not required or required not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"No tienes permiso para cambiar estado a '{body.estado}'",
        )

    # R152YYYYY — Validar que el estado destino sea consistente con el
    # estado actual lockeado (ya validado por allowed_actions pero
    # defensivo si _authz cambia en el futuro).
    if oc.estado == body.estado:
        # Idempotente: ya está en ese estado, no hacemos nada.
        return _to_read(user, oc)

    # R152UUUUUU — Anti-anulación con vouchers vivos, igual que el bulk
    # (R152EEEEEE). El comentario del bulk asumía que "_authz ya lo bloquea
    # en el single PATCH", pero _authz solo mira rol+estado: este endpoint
    # permitía anular una OC con vouchers APROBADOS/EJECUTADOS (plata
    # comprometida o salida), dejándolos huérfanos de una OC anulada.
    if body.estado == "anulada":
        vouchers_bloq = (await db.execute(
            text(
                """SELECT COUNT(*) FROM core.oc_cuotas c
                   JOIN core.vouchers v ON v.voucher_id = c.voucher_id
                   WHERE c.oc_id = :id AND v.status IN ('APPROVED','EXECUTED','SYNCED','RECONCILED')"""
            ),
            {"id": oc_id},
        )).scalar() or 0
        if vouchers_bloq > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"La OC tiene {vouchers_bloq} voucher(s) aprobado(s)/"
                    "ejecutado(s) asociados a sus cuotas. Anulá o revertí esos "
                    "vouchers antes de anular la OC."
                ),
            )

    estado_before = oc.estado
    updated = await repo.update_estado(oc, body.estado)
    await db.commit()
    # `anulada` mapea a 'reject', el resto a 'approve' / 'update' según semántica.
    audit_action = (
        "reject" if body.estado == "anulada"
        else "approve" if body.estado == "pagada"
        else "update"
    )
    await audit_log(
        db,
        request,
        user,
        action=audit_action,
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=updated.numero_oc,
        summary=f"OC {updated.numero_oc}: {estado_before} -> {body.estado}",
        before={"estado": estado_before},
        after={"estado": body.estado},
    )
    # Webhook: mapea estado interno (español) → event type registrado (inglés).
    # `pagada`/`parcial` → oc.paid (con partial_payment flag). `anulada` →
    # oc.cancelled. Best-effort async — fallo del dispatcher no rompe la mutación.
    _OC_EVENT_MAP = {
        "pagada": "oc.paid",
        "parcial": "oc.paid",
        "anulada": "oc.cancelled",
    }
    _evt = _OC_EVENT_MAP.get(body.estado)
    if _evt:
        await publish_event(
            db,
            _evt,
            {
                "oc_id": oc_id,
                "numero_oc": updated.numero_oc,
                "empresa_codigo": updated.empresa_codigo,
                "estado_before": estado_before,
                "estado_after": body.estado,
                "partial_payment": body.estado == "parcial",
                "total": float(updated.total) if updated.total else None,
                # `oc.paid` es plata que YA salió: el suscriptor que concilia
                # contra el banco necesita el líquido, no el bruto (§3.1).
                # `total` se conserva con su significado histórico.
                "total_a_pagar": float(
                    _col(updated, "total_a_pagar", updated.total)
                ),
                "retencion_monto": float(
                    _col(updated, "retencion_monto", Decimal("0"))
                ),
                "tipo_documento": updated.tipo_documento,
                "moneda": updated.moneda,
                "proveedor_id": updated.proveedor_id,
                "changed_by": str(user.sub),
            },
        )
    return _to_read(user, updated)


@router.post("/bulk-update-estado", response_model=BulkUpdateResult)
async def bulk_update_estado(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    body: BulkUpdateEstadoRequest,
) -> BulkUpdateResult:
    """Cambio masivo de estado en hasta 200 OCs.

    Reglas:
    - Reusa la misma autorización por-OC que `PATCH /{oc_id}/estado` — si el
      usuario no tiene permiso para el cambio en algún ID, ese ID falla y los
      demás siguen.
    - Cada cambio es una mutación independiente con su propio `audit_log`,
      auditado bajo `action='bulk_update'` con `entity_label` que enumera
      cuántos quedaron.
    - El commit es uno solo al final — atómico por endpoint pero idempotente
      por id (re-correr no re-aplica si el estado ya quedó).
    """
    repo = OrdenCompraRepository(db)
    failed: list[BulkItemError] = []
    succeeded = 0
    _ESTADO_ACTION = {"pagada": "mark_paid", "anulada": "cancel", "parcial": "mark_paid"}
    required_action = _ESTADO_ACTION.get(body.estado)

    for oc_id in body.ids:
        # R152JJJJJJ — Row lock por OC (mismo patrón que el PATCH single).
        # Sin esto, un bulk concurrente con otro update sobre la misma OC
        # pasaba ambos el check de estado y aplicaba transiciones ilegales.
        locked = (
            await db.execute(
                text("SELECT oc_id FROM core.ordenes_compra WHERE oc_id = :id FOR UPDATE"),
                {"id": oc_id},
            )
        ).first()
        if locked is None:
            failed.append(BulkItemError(id=oc_id, detail="not found"))
            continue
        oc = await repo.get(oc_id)
        if not oc:
            failed.append(BulkItemError(id=oc_id, detail="not found"))
            continue
        # R152UUUUUU — scoping multi-tenant por OC: el single PATCH valida
        # empresa (ola CJ) pero el bulk no lo hacía — un usuario scopeado a
        # una empresa podía cambiar estados de OCs de cualquier otra
        # enumerando IDs. Falla por-item para no abortar el batch completo.
        try:
            await assert_empresa_access(user, db, oc.empresa_codigo)
        except HTTPException:
            failed.append(
                BulkItemError(id=oc_id, detail="sin acceso a la empresa de esta OC")
            )
            continue
        if oc.estado == body.estado:
            failed.append(BulkItemError(id=oc_id, detail="ya en ese estado"))
            continue
        allowed = _authz.allowed_actions_for_oc(user, oc.estado)
        if not required_action or required_action not in allowed:
            failed.append(
                BulkItemError(id=oc_id, detail=f"sin permiso para {body.estado}")
            )
            continue

        # R152EEEEEE — Anti-anulación de OCs con vouchers APROBADOS/EJECUTADOS.
        # Sin este check, `bulk_update_estado` permitía anular una OC cuyas
        # cuotas ya se transformaron en vouchers ejecutados (plata salida),
        # dejando el voucher huérfano de su OC. El single PATCH ya lo bloquea
        # via `_authz`, pero el bulk path se saltaba.
        if body.estado == "anulada":
            vouchers_bloq = (await db.execute(
                text(
                    """SELECT COUNT(*) FROM core.oc_cuotas c
                       JOIN core.vouchers v ON v.voucher_id = c.voucher_id
                       WHERE c.oc_id = :id AND v.status IN ('APPROVED','EXECUTED','SYNCED','RECONCILED')"""
                ),
                {"id": oc_id},
            )).scalar() or 0
            if vouchers_bloq > 0:
                failed.append(BulkItemError(
                    id=oc_id,
                    detail=f"tiene {vouchers_bloq} voucher(s) APROBADO/EJECUTADO — anular vouchers primero",
                ))
                continue

        await repo.update_estado(oc, body.estado)
        succeeded += 1

    if succeeded:
        await db.commit()
        await audit_log(
            db,
            request,
            user,
            action="update",
            entity_type="orden_compra",
            entity_id=f"bulk:{succeeded}",
            entity_label=f"{succeeded} OCs → {body.estado}",
            summary=(
                f"Bulk update estado={body.estado}: {succeeded} OCs ok, "
                f"{len(failed)} fallaron"
            ),
            before=None,
            after={"estado": body.estado, "ids": body.ids[:50]},
        )

    return BulkUpdateResult(
        operation="update_estado",
        requested=len(body.ids),
        succeeded=succeeded,
        failed=failed,
    )


# =====================================================================
# V5++ ola AA — POST /ordenes-compra/import-csv (bulk import desde Excel)
# =====================================================================


class OcImportCsvResponse(BaseModel):
    total_rows: int
    total_ocs_intended: int
    ocs_created_count: int
    errors_count: int
    ocs_created: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


@router.post(
    "/import-csv",
    response_model=OcImportCsvResponse,
    dependencies=[Depends(require_scope("oc:create"))],
)
async def import_ocs_csv(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
) -> OcImportCsvResponse:
    """Bulk-import de Órdenes de Compra desde CSV (Excel chileno).

    Formato esperado:
        - Separador: `;`  (Excel chileno) o `,`
        - Encoding: UTF-8 (BOM opcional)
        - Una fila por ITEM de la OC; mismo `numero_oc` agrupa filas
          en una OC con sus items. La key real para agrupar combina
          `empresa_codigo|numero_oc`.

    Columnas obligatorias (case-insensitive, aliases en español OK):
        numero_oc, empresa_codigo, fecha_emision,
        item, descripcion, precio_unitario, cantidad

    Columnas opcionales:
        proveedor_id, validez_dias, moneda, forma_pago, plazo_pago,
        observaciones

    El `neto` de la OC se calcula como Σ(precio_unitario * cantidad) de
    los items. El IVA y total se calculan con la regla CLP estándar.

    Todas las OCs se crean en estado `emitida`. Idempotencia: si una OC
    con `(empresa_codigo, numero_oc)` ya existe, se reporta error y se
    continúa con las demás (best-effort).

    `dry_run=true` valida y devuelve el reporte sin insertar nada.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo debe tener extensión .csv",
        )

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:  # 10 MB
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV excede 10 MB. Dividir en partes más chicas.",
        )

    from app.services.oc_csv_import_service import (
        OcCsvImportError,
        parse_csv_to_ocs,
    )

    parsed_ocs, report = parse_csv_to_ocs(raw)

    if dry_run or not parsed_ocs:
        return OcImportCsvResponse(**report.to_dict())

    repo = OrdenCompraRepository(db)
    for oc_data in parsed_ocs:
        try:
            # R152UUUUUU — scoping multi-tenant por fila: el CSV trae
            # empresa_codigo libre y antes se insertaba sin validar contra
            # las empresas permitidas del usuario (un operador de RHO podía
            # importar OCs "para" CENERGY). Falla por-OC, sigue el batch.
            try:
                await assert_empresa_access(user, db, oc_data.empresa_codigo)
            except HTTPException:
                report.errors.append(
                    OcCsvImportError(
                        numero_oc=oc_data.numero_oc,
                        row=0,
                        field="empresa_codigo",
                        message=(
                            f"sin acceso a la empresa {oc_data.empresa_codigo}"
                        ),
                    )
                )
                continue
            if await repo.exists_numero_oc(
                oc_data.empresa_codigo, oc_data.numero_oc
            ):
                report.errors.append(
                    OcCsvImportError(
                        numero_oc=oc_data.numero_oc,
                        row=0,
                        field="numero_oc",
                        message=(
                            f"OC {oc_data.numero_oc} ya existe "
                            f"para empresa {oc_data.empresa_codigo}"
                        ),
                    )
                )
                continue

            # Mismo cálculo server-side que el alta individual. Hoy el CSV no
            # trae columna de tipo de documento y todo cae en FACTURA, pero el
            # camino es el mismo a propósito: el día que se agregue la columna
            # no hay una segunda aritmética que acordarse de actualizar. Y
            # `total_a_pagar` es NOT NULL: dejar este path con los defaults del
            # schema reventaba el INSERT.
            retencion_csv = _campo_explicito(oc_data, "retencion_porcentaje")
            _validar_coherencia_tributaria(
                tipo_documento=oc_data.tipo_documento,
                moneda=oc_data.moneda,
                retencion_porcentaje=retencion_csv,
            )
            derived_csv = _derivar_totales_oc(
                neto=oc_data.neto or Decimal("0"),
                moneda=oc_data.moneda,
                tipo_documento=oc_data.tipo_documento,
                iva_porcentaje=oc_data.iva_porcentaje,
                retencion_porcentaje=await _resolver_retencion_porcentaje(
                    db,
                    tipo_documento=oc_data.tipo_documento,
                    fecha_emision=oc_data.fecha_emision,
                    explicito=retencion_csv,
                ),
            )
            oc = await repo.create(oc_data, derived=derived_csv)
            await db.flush()
            report.ocs_created.append({
                "oc_id": oc.oc_id,
                "numero_oc": oc.numero_oc,
                "empresa_codigo": oc.empresa_codigo,
                "neto": str(oc.neto),
                "total": str(oc.total),
                "total_a_pagar": str(_col(oc, "total_a_pagar", oc.total)),
                "moneda": oc.moneda,
                "items": len(oc_data.items),
            })

            # Webhook por OC creada (mismo patrón que create_oc individual)
            try:
                await publish_event(
                    db,
                    "oc.created",
                    {
                        "oc_id": oc.oc_id,
                        "numero_oc": oc.numero_oc,
                        "empresa_codigo": oc.empresa_codigo,
                        "proveedor_id": oc.proveedor_id,
                        "total": float(oc.total) if oc.total else None,
                        "total_a_pagar": float(
                            _col(oc, "total_a_pagar", oc.total)
                        ),
                        "retencion_monto": float(
                            _col(oc, "retencion_monto", Decimal("0"))
                        ),
                        "tipo_documento": oc.tipo_documento,
                        "moneda": oc.moneda,
                        "estado": oc.estado,
                        "created_by": str(user.sub),
                        "via_csv_import": True,
                    },
                )
            except Exception:
                pass  # soft-fail
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            report.errors.append(
                OcCsvImportError(
                    numero_oc=oc_data.numero_oc,
                    row=0,
                    field=None,
                    message=f"error: {exc}",
                )
            )

    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error commiteando OCs: {exc}",
        ) from exc

    return OcImportCsvResponse(**report.to_dict())


# ─────────────────────────────────────────────────────────────────────
# R152IIII — Endpoint manual: enviar OC al GG + CC
# ─────────────────────────────────────────────────────────────────────


@router.post("/{oc_id}/send-to-signers")
async def send_oc_to_signers_endpoint(
    user: CurrentUser, db: DBSession, oc_id: int, force: bool = False
) -> dict:
    """Envía (o reenvía con ?force=true) el PDF de la OC al GG firmante.

    Auto-disparado al crear OC desde email. Endpoint manual útil para:
      - Re-enviar si Resend falló la primera vez
      - Enviar OCs creadas antes de aplicar la migración R152IIII
      - Forzar re-envío después de cambiar email del GG
    """
    # R152UUUUUU — scoping multi-tenant: este endpoint reenviaba el PDF de
    # CUALQUIER oc_id sin validar la empresa contra el scope del usuario.
    emp = await db.scalar(
        text("SELECT empresa_codigo FROM core.ordenes_compra WHERE oc_id = :id"),
        {"id": oc_id},
    )
    if emp is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, str(emp))

    if force:
        await db.execute(
            text(
                "UPDATE core.ordenes_compra "
                "SET oc_sent_at = NULL, oc_send_error = NULL "
                "WHERE oc_id = :id"
            ),
            {"id": oc_id},
        )
        await db.commit()

    from app.services.send_oc_to_signers_service import send_oc_to_signers
    return await send_oc_to_signers(db, oc_id)
