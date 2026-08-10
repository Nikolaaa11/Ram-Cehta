"""Los números que imprime el PDF del voucher, sin reportlab en el medio.

Estos tests existen por un bug concreto: el PDF de `AFIS-2026-COM-00010` —dos
líneas de $220.084, debe contra haber, un asiento que cuadra perfecto— imprimía
"DIFERENCIA -$440.168" en rojo. La fórmula rota vivía adentro del constructor
de la tabla de reportlab, o sea en un lugar donde ningún test la podía mirar:
una función que devuelve un `Table` no se puede afirmar.

Por eso el cálculo está separado del dibujo, y por eso este archivo sólo toca
funciones que devuelven números. Si mañana alguien vuelve a mezclar una suma
con el armado de la tabla, este archivo deja de cubrirla — y eso es señal de
que el refactor está mal, no de que falten tests.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.voucher_pdf_service import (
    ESTADO_CUADRA,
    ESTADO_DESCUADRE,
    ESTADO_SIN_LINEAS,
    ESTADO_SIN_MONTOS,
    calcular_cuadratura_contable,
    calcular_desglose_tributario,
    formatear_debe_haber,
)


def linea(
    numero: int,
    cuenta: str,
    *,
    debe: str = "0",
    haber: str = "0",
    neto: str | None = None,
    iva: str | None = None,
    tratamiento: str | None = None,
    descripcion: str = "",
) -> dict:
    """Una fila de `core.voucher_lines` como la devuelve el SELECT del PDF.

    `debit`/`credit` son NOT NULL DEFAULT 0 en la BD; `neto_amount`,
    `iva_amount` e `iva_tratamiento` son nullables y hoy están en NULL en las 6
    líneas de producción. El default de este helper replica eso a propósito.
    """
    return {
        "line_number": numero,
        "cuenta_codigo": cuenta,
        "cuenta_nombre": "",
        "proyecto_codigo": None,
        "area_codigo": None,
        "debit": Decimal(debe),
        "credit": Decimal(haber),
        "descripcion": descripcion,
        "neto_amount": None if neto is None else Decimal(neto),
        "iva_amount": None if iva is None else Decimal(iva),
        "iva_tratamiento": tratamiento,
        "tipo_imputacion": "NA",
    }


# El asiento real de la captura que motivó todo este trabajo.
LINEAS_AFIS_00010 = [
    linea(1, "4101-01", debe="220084", descripcion="Insumos"),
    linea(2, "2102-01", haber="220084", descripcion="Proveedor SpA"),
]


# ---------------------------------------------------------------------------
# Cuadratura contable — la pregunta que responde el papel
# ---------------------------------------------------------------------------


def test_el_voucher_de_la_captura_cuadra() -> None:
    """AFIS-2026-COM-00010: el caso que imprimía DIFERENCIA -$440.168.

    Este es EL test. Si vuelve a fallar, el gerente vuelve a recibir un
    documento que le dice que su asiento está mal cuando está bien.
    """
    c = calcular_cuadratura_contable(LINEAS_AFIS_00010)

    assert c.estado == ESTADO_CUADRA
    assert c.cuadra is True
    assert c.total_debe == Decimal("220084")
    assert c.total_haber == Decimal("220084")
    assert c.diferencia == Decimal("0")


def test_la_diferencia_nunca_es_la_suma_de_debe_mas_haber() -> None:
    """El bug de origen, escrito como propiedad para que no vuelva.

    `Σ(debit + credit)` da SIEMPRE el doble del asiento en cualquier voucher
    correcto — no era un problema de este voucher, la fórmula estaba rota para
    todos. Acá se fija que la diferencia se calcula por RESTA entre los dos
    lados, y que 440.168 no aparece por ningún lado.
    """
    c = calcular_cuadratura_contable(LINEAS_AFIS_00010)
    suma_de_los_dos_lados = c.total_debe + c.total_haber

    assert suma_de_los_dos_lados == Decimal("440168")  # el número de la captura
    assert c.diferencia != suma_de_los_dos_lados
    assert c.diferencia == c.total_debe - c.total_haber


def test_asiento_descuadrado_reporta_la_diferencia_real() -> None:
    lineas = [
        linea(1, "4101-01", debe="100000"),
        linea(2, "2102-01", haber="90000"),
    ]
    c = calcular_cuadratura_contable(lineas)

    assert c.estado == ESTADO_DESCUADRE
    assert c.cuadra is False
    assert c.diferencia == Decimal("10000")  # el debe supera al haber


def test_el_signo_de_la_diferencia_dice_que_lado_sobra() -> None:
    """Debe menos haber: negativo = sobra haber. El PDF lo traduce a palabras."""
    c = calcular_cuadratura_contable([
        linea(1, "4101-01", debe="90000"),
        linea(2, "2102-01", haber="100000"),
    ])

    assert c.diferencia == Decimal("-10000")


def test_sin_lineas_no_dice_que_cuadra() -> None:
    """PANIMAVIDA-2026-COM-00001 está en producción con 0 líneas.

    `0 == 0` es cierto y a la vez mentira: no hay asiento que cuadrar. Un
    booleano solo obligaría al papel a felicitar una hoja vacía.
    """
    c = calcular_cuadratura_contable([])

    assert c.estado == ESTADO_SIN_LINEAS
    assert c.cuadra is False
    assert c.hay_asiento is False
    assert c.cantidad_lineas == 0


def test_lineas_todas_en_cero_tampoco_dice_que_cuadra() -> None:
    c = calcular_cuadratura_contable([
        linea(1, "4101-01"),
        linea(2, "2102-01"),
    ])

    assert c.estado == ESTADO_SIN_MONTOS
    assert c.cuadra is False
    assert c.hay_asiento is False


def test_las_dos_sumas_son_independientes() -> None:
    """La BD NO tiene el CHECK de debe XOR haber (pg_constraint está vacío).

    Una línea con los dos lados cargados es posible hoy. Sumarlos por separado
    la deja a la vista como descuadre en vez de compensarla en silencio.
    """
    c = calcular_cuadratura_contable([
        linea(1, "4101-01", debe="50000", haber="20000"),
        linea(2, "2102-01", haber="30000"),
    ])

    assert c.total_debe == Decimal("50000")
    assert c.total_haber == Decimal("50000")
    assert c.estado == ESTADO_CUADRA  # cuadra igual: 50.000 contra 50.000


def test_muchas_lineas_cuadran_por_resta_y_no_por_redondeo() -> None:
    """Peso chileno sin centavos: el residuo va por resta, nunca por división."""
    c = calcular_cuadratura_contable([
        linea(1, "4201-02", debe="1000000"),
        linea(2, "2105-04", haber="152500"),
        linea(3, "2102-11", haber="847500"),
    ])

    assert c.diferencia == Decimal("0")
    assert c.estado == ESTADO_CUADRA


# ---------------------------------------------------------------------------
# Desglose tributario — lo que NO se sabe se dice, no se rellena con cero
# ---------------------------------------------------------------------------


def test_sin_desglose_todo_es_none_y_no_cero() -> None:
    """El caso de los 4 vouchers de producción: neto/IVA en NULL.

    La distinción entre None y Decimal(0) es todo el punto: el renderer imprime
    "—" para None y "$0" para el cero. Un cero acá sería afirmar que el IVA de
    la compra fue cero, y eso es falso.
    """
    d = calcular_desglose_tributario({}, LINEAS_AFIS_00010)

    assert d.hay_desglose is False
    assert d.neto is None
    assert d.iva is None
    assert d.retencion is None
    assert d.total_documento is None
    assert d.neto != Decimal("0")  # explícito: no es cero, es "no está cargado"


def test_sin_lineas_tampoco_inventa_desglose() -> None:
    d = calcular_desglose_tributario({}, [])

    assert d.hay_desglose is False
    assert d.total_documento is None


def test_con_desglose_afecto_compone_el_total() -> None:
    """Factura afecta: neto 100.000 + IVA 19.000 = 119.000."""
    lineas = [
        linea(
            1, "4101-01", debe="119000",
            neto="100000", iva="19000", tratamiento="AFECTO",
        ),
        linea(2, "2102-01", haber="119000"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.hay_desglose is True
    assert d.neto == Decimal("100000")
    assert d.iva == Decimal("19000")
    assert d.total_documento == Decimal("119000")
    assert d.tratamiento_iva == "AFECTO"


def test_exento_declarado_permite_afirmar_iva_cero() -> None:
    """EXENTO dice que la operación no lleva IVA: ahí el cero SÍ es un dato."""
    lineas = [
        linea(1, "4101-01", debe="80000", neto="80000", tratamiento="EXENTO"),
        linea(2, "2102-01", haber="80000"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.iva == Decimal("0")
    assert d.total_documento == Decimal("80000")
    assert d.tratamiento_iva == "EXENTO"


def test_el_iva_puede_vivir_en_su_propia_linea() -> None:
    """La forma REAL de una factura afecta: neto en el gasto, IVA en 1113-02.

    Esta es la trampa que casi se me pasa. Emparejar neto e IVA línea por línea
    parece razonable hasta que se mira un asiento de verdad: el IVA crédito
    fiscal va en su propia línea, así que la línea del gasto tiene neto y no
    tiene IVA. Con la regla per-línea el PDF decía "IVA —" sobre una factura
    perfectamente cargada. El IVA se decide a nivel documento.
    """
    lineas = [
        linea(1, "4101-01", debe="184944", neto="184944", tratamiento="AFECTO"),
        linea(2, "1113-02", debe="35140", iva="35140", tratamiento="AFECTO"),
        linea(3, "2102-01", haber="220084", tratamiento="AFECTO"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.neto == Decimal("184944")
    assert d.iva == Decimal("35140")
    assert d.total_documento == Decimal("220084")
    # Y el total del documento coincide con el total del asiento: no es
    # casualidad, es la prueba de que las dos vistas hablan del mismo hecho.
    assert d.total_documento == calcular_cuadratura_contable(lineas).total_debe


def test_neto_cargado_sin_iva_ni_regimen_deja_el_total_en_none() -> None:
    """Desglose a medias: no sabemos el IVA, así que no sabemos el total.

    Es la elección conservadora a propósito. Poner el total igual al neto sería
    suponer IVA cero sin que nadie lo haya declarado.
    """
    lineas = [
        linea(1, "4101-01", debe="119000", neto="100000"),
        linea(2, "2102-01", haber="119000"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.neto == Decimal("100000")
    assert d.iva is None
    assert d.total_documento is None
    assert d.hay_desglose is True  # el neto sí se muestra


def test_solo_las_lineas_con_neto_suman() -> None:
    """La contrapartida no lleva desglose: eso es la forma normal del asiento."""
    lineas = [
        linea(1, "4101-01", debe="59500", neto="50000", iva="9500", tratamiento="AFECTO"),
        linea(2, "6101-01", debe="59500", neto="50000", iva="9500", tratamiento="AFECTO"),
        linea(3, "2102-01", haber="119000"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.neto == Decimal("100000")
    assert d.iva == Decimal("19000")


def test_impuesto_especifico_entra_en_el_total() -> None:
    """Combustibles/ILA: total = neto + IVA + impuesto específico."""
    voucher = {"impuesto_especifico": Decimal("5000")}
    lineas = [
        linea(1, "4101-01", debe="124000", neto="100000", iva="19000",
              tratamiento="AFECTO"),
        linea(2, "2102-01", haber="124000"),
    ]
    d = calcular_desglose_tributario(voucher, lineas)

    assert d.impuesto_especifico == Decimal("5000")
    assert d.total_documento == Decimal("124000")


def test_impuesto_especifico_null_es_no_aplica_y_no_bloquea_el_total() -> None:
    """El modelo documenta NULL como "no aplica": ahí el cero lo dice el schema."""
    lineas = [
        linea(1, "4101-01", debe="119000", neto="100000", iva="19000",
              tratamiento="AFECTO"),
        linea(2, "2102-01", haber="119000"),
    ]
    d = calcular_desglose_tributario({"impuesto_especifico": None}, lineas)

    assert d.impuesto_especifico is None
    assert d.total_documento == Decimal("119000")


def test_impuesto_especifico_en_cero_no_se_confunde_con_ausente() -> None:
    """Un cero guardado es un dato: entra al total por la rama del dato.

    Con `or` como fallback el cero caería por la rama de "no aplica". Da el
    mismo número, pero es la trampa clásica de este repo y así queda cerrada.
    """
    lineas = [
        linea(1, "4101-01", debe="119000", neto="100000", iva="19000",
              tratamiento="AFECTO"),
        linea(2, "2102-01", haber="119000"),
    ]
    d = calcular_desglose_tributario({"impuesto_especifico": Decimal("0")}, lineas)

    assert d.impuesto_especifico == Decimal("0")
    assert d.hay_desglose is True
    assert d.total_documento == Decimal("119000")


def test_retencion_se_lee_de_la_linea_2105_04() -> None:
    """No hay columna `retencion` en el voucher: el registro ES esa línea.

    Boleta de honorarios de $1.000.000 con 15,25% de retención: el gasto va al
    debe por el bruto, la retención al haber en 2105-04 y el líquido al haber
    en honorarios por pagar.
    """
    lineas = [
        linea(1, "4201-02", debe="1000000", neto="1000000",
              tratamiento="NO_GRAVADO"),
        linea(2, "2105-04", haber="152500"),
        linea(3, "2102-11", haber="847500"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.retencion == Decimal("152500")
    assert d.iva == Decimal("0")  # NO_GRAVADO lo declara
    assert d.total_documento == Decimal("1000000")
    assert d.total_a_pagar == Decimal("847500")  # coincide con el líquido


def test_sin_linea_de_retencion_la_retencion_es_none() -> None:
    """Una compra normal no tiene retención — y "—" no es lo mismo que "$0"."""
    d = calcular_desglose_tributario({}, LINEAS_AFIS_00010)

    assert d.retencion is None
    assert d.total_a_pagar is None


def test_tratamientos_mezclados_se_reportan_como_mixto() -> None:
    lineas = [
        linea(1, "4101-01", debe="59500", neto="50000", iva="9500",
              tratamiento="AFECTO"),
        linea(2, "4101-02", debe="50000", neto="50000", tratamiento="EXENTO"),
        linea(3, "2102-01", haber="109500"),
    ]
    d = calcular_desglose_tributario({}, lineas)

    assert d.tratamiento_iva == "MIXTO"
    assert d.iva == Decimal("9500")


def test_tratamiento_na_no_se_muestra_como_regimen() -> None:
    """"NA" es el default de la columna, no describe un régimen tributario."""
    lineas = [linea(1, "4101-01", debe="1000", tratamiento="NA")]
    d = calcular_desglose_tributario({}, lineas)

    assert d.tratamiento_iva is None


# ---------------------------------------------------------------------------
# Celdas de la vista contable
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("debe", "haber", "esperado"),
    [
        (Decimal("220084"), Decimal("0"), ("$220.084", "")),
        (Decimal("0"), Decimal("220084"), ("", "$220.084")),
    ],
)
def test_el_lado_sin_monto_va_vacio_no_en_guion(
    debe: Decimal, haber: Decimal, esperado: tuple[str, str]
) -> None:
    """El guion significa "no sé" y acá sí sabemos: ese lado es cero.

    Antes la guarda era `if debit`, o sea truthiness — la trampa clásica de
    este repo. Un lado vacío se lee como un libro contable; un "—" en cada
    fila afirma desconocimiento donde no lo hay.
    """
    assert formatear_debe_haber(debe, haber) == esperado


def test_linea_sin_monto_en_ningun_lado_imprime_los_dos_ceros() -> None:
    """Esa línea está mal cargada: taparla con dos celdas en blanco la esconde."""
    assert formatear_debe_haber(Decimal("0"), Decimal("0")) == ("$0", "$0")


# ──────────────────────────────────────────────────────────────────────
# Los defectos que encontró la verificación adversarial
# ──────────────────────────────────────────────────────────────────────


def test_retencion_al_debe_no_imprime_cero_contradiciendo_al_asiento() -> None:
    """El REVERSO de un voucher de honorarios lleva 2105-04 al DEBE.

    Buscando la retención por cuenta pero sumándola por HABER, ese caso daba
    Decimal("0") —que no es None—, encendía la vista financiera y estampaba
    "Retención $0" ocho líneas debajo de una vista contable que mostraba
    "2105-04 · Debe $152.500". El mismo papel afirmando dos cosas
    incompatibles.
    """
    lines = [
        {"cuenta_codigo": "2105-04", "debit": "152500", "credit": "0"},
        {"cuenta_codigo": "4201-02", "debit": "0", "credit": "1000000"},
        {"cuenta_codigo": "2102-11", "debit": "847500", "credit": "0"},
    ]
    d = calcular_desglose_tributario({}, lines)
    assert d.retencion == Decimal("-152500"), (
        "la retención tiene que reflejar la posición neta con su signo, no un cero"
    )


def test_retencion_al_haber_sigue_dando_positivo() -> None:
    lines = [
        {"cuenta_codigo": "4201-02", "debit": "1000000", "credit": "0"},
        {"cuenta_codigo": "2105-04", "debit": "0", "credit": "152500"},
        {"cuenta_codigo": "2102-11", "debit": "0", "credit": "847500"},
    ]
    assert calcular_desglose_tributario({}, lines).retencion == Decimal("152500")


def test_sin_linea_de_retencion_la_retencion_es_ausencia_no_cero() -> None:
    lines = [
        {"cuenta_codigo": "4101-01", "debit": "220084", "credit": "0"},
        {"cuenta_codigo": "2102-01", "debit": "0", "credit": "220084"},
    ]
    d = calcular_desglose_tributario({}, lines)
    assert d.retencion is None
    assert d.hay_desglose is False, (
        "sin ningún dato tributario, el PDF tiene que mostrar el cartel honesto"
    )


def test_impuesto_especifico_en_cero_no_enciende_la_vista_financiera() -> None:
    """Un 0 guardado SIGUE siendo un dato — pero no enciende la sección solo.

    Distinguir el cero de la ausencia es correcto y hay que conservarlo. Lo que
    no sirve es prender toda la vista financiera para mostrar un único número
    que dice cero, con neto, IVA y total en guiones: eso es "un número impreso
    que no significa nada".
    """
    lines = [
        {"cuenta_codigo": "4101-01", "debit": "220084", "credit": "0"},
        {"cuenta_codigo": "2102-01", "debit": "0", "credit": "220084"},
    ]
    d = calcular_desglose_tributario({"impuesto_especifico": 0}, lines)
    assert d.impuesto_especifico == Decimal("0"), "el cero se conserva como dato"
    assert d.hay_desglose is False, "pero no justifica imprimir la sección"


def test_un_neto_en_cero_si_enciende_la_seccion() -> None:
    # El neto y el IVA son la composición del documento: valen por sí solos,
    # incluso en cero. Es la asimetría deliberada de `hay_desglose`.
    # `neto` se suma de las LÍNEAS (neto_amount), no del voucher.
    lines = [
        {"cuenta_codigo": "4101-01", "debit": "0", "credit": "0", "neto_amount": "0"},
    ]
    assert calcular_desglose_tributario({}, lines).hay_desglose is True
