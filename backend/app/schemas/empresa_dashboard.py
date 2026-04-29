"""Schemas Pydantic para el Dashboard rico por empresa (V3 fase 6).

Todos los endpoints empresa-scoped (`/api/v1/empresa/{codigo}/...`) emiten
estas formas. Se exponen por separado del módulo `dashboard.py` (consolidado
del portafolio) para mantener responsabilidades claras y mantener la
documentación OpenAPI navegable.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


# =====================================================================
# /resumen-cc — Hero KPIs + tabla Composición Completa CC
# =====================================================================
class ResumenCCKpis(BaseModel):
    """Las 5 tarjetas grandes de la cabecera del dashboard."""

    egresos_totales_cc: Decimal
    abonos_totales_cc: Decimal
    egresos_operacionales: Decimal
    presupuesto_corfo: Decimal
    ejecucion_pcto: float  # 0-100+, puede pasar de 100 si hay sobre-ejecución


class ComposicionRow(BaseModel):
    """Una fila de la tabla Composición Completa CC."""

    categoria: str            # concepto_general
    egresos: Decimal
    abonos: Decimal
    neto: Decimal             # abonos - egresos (positivo = entró plata)
    tipo: str                 # Capital | Tesoreria | Ajuste | Operacional | Financiero | Otros
    transaction_count: int


class ResumenCC(BaseModel):
    empresa_codigo: str
    razon_social: str
    transaction_count: int
    periodo_filtro: str | None = None
    real_proyectado_filtro: str | None = None
    kpis: ResumenCCKpis
    composicion: list[ComposicionRow]


# =====================================================================
# /egresos-por-tipo — Donut chart
# =====================================================================
class EgresoTipoItem(BaseModel):
    categoria: str
    total_egreso: Decimal
    transaction_count: int
    porcentaje: float        # del total egresos del slice agregado
    color: str               # hex usado por el frontend (server-decidido)


# =====================================================================
# /egresos-por-proyecto — Treemap
# =====================================================================
class EgresoProyectoItem(BaseModel):
    proyecto: str
    total_egreso: Decimal
    transaction_count: int
    porcentaje: float


# =====================================================================
# /flujo-mensual — Line chart
# =====================================================================
class FlujoMensualPoint(BaseModel):
    periodo: str             # MM_YY
    fecha_inicio: date
    abono_real: Decimal
    egreso_real: Decimal
    abono_proyectado: Decimal
    egreso_proyectado: Decimal
    flujo_neto: Decimal      # (abono_real + abono_proy) - (egreso_real + egreso_proy)
    saldo_acumulado: Decimal


# =====================================================================
# /transacciones-recientes — feed/tabla
# =====================================================================
class TransaccionRecienteItem(BaseModel):
    movimiento_id: int
    fecha: str
    descripcion: str | None
    abono: Decimal
    egreso: Decimal
    saldo_contable: Decimal | None
    concepto_general: str | None
    concepto_detallado: str | None
    proyecto: str | None
    real_proyectado: str | None
    hipervinculo: str | None


# =====================================================================
# /categorias — Breakdown por concepto_general → concepto_detallado
# =====================================================================
class SubCategoriaItem(BaseModel):
    concepto_detallado: str
    total_egreso: Decimal
    total_abono: Decimal
    transaction_count: int


class CategoriaBreakdown(BaseModel):
    concepto_general: str
    total_egreso: Decimal
    total_abono: Decimal
    transaction_count: int
    sub_categorias: list[SubCategoriaItem]


# =====================================================================
# /proyectado-vs-real — Comparativa
# =====================================================================
class ProyectadoVsRealRow(BaseModel):
    categoria: str           # concepto_general
    real: Decimal
    proyectado: Decimal
    delta_pct: float         # cuán lejos del proyectado: (real - proy) / proy * 100
