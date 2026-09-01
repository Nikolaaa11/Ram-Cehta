"""Recordatorios de firmas de OC pendientes.

# EL HUECO QUE ESTO CIERRA

La migración 0068 creó `oc_firmas.reminder_sent_at` "para el recordatorio de
48h del monitor horario", y `enviar_a_firma` promete lo mismo en un
comentario — pero NADA lo escribía: el recordatorio nunca existió. El
resultado es exactamente lo que reportó Nicolás: con muchas OC en firma,
nadie sabe cuáles le faltan, y las OC quedan estancadas.

# CÓMO AVISA

UN correo por firmante con TODAS sus OC pendientes (no un correo por OC:
cinco correos por cinco firmas del mismo día es spam que se aprende a
ignorar), más la notificación in-app de campanita. El correo lista número,
empresa, proveedor, monto y días esperando, con link directo a cada OC.

# CUÁNDO AVISA

La primera vez a las ~44 horas de la invitación, y después cada ~44 horas
(el cron corre por hora; 44 en vez de 48 para que "cada dos días" no se
corra un día entero si el cron pasa justo antes del umbral). El umbral se
mide contra GREATEST(notified_at, reminder_sent_at): invitar de nuevo o
recordar resetea el reloj. Se estampa reminder_sent_at ANTES de enviar y en
la misma transacción: si el envío falla, el próximo ciclo lo reintenta un
día después — perder un recordatorio es mejor que un bucle que spamea.

Excluye siempre: placeholders `@sin-correo...` (firmantes de papel), OC que
no están `en_firma`, y firmas nunca invitadas (notified_at NULL — a esas
las invita `enviar-a-firma`, no este servicio).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger(__name__)

APP_URL = "https://cehta-capital.vercel.app"
_SIN_EMAIL_DOMAIN = "sin-correo.cehtacapital.com"

#: Horas desde el último aviso (invitación o recordatorio) para volver a
#: avisar. 44 y no 48: el cron es horario y con 48 exactas el aviso "cada
#: dos días" se deslizaba un ciclo entero.
HORAS_ENTRE_AVISOS = 44


async def firmas_para_recordar(db: AsyncSession) -> list[dict[str, Any]]:
    """Las firmas PENDIENTE que ya merecen recordatorio, con su contexto."""
    filas = (
        await db.execute(
            text(
                """
                SELECT f.firma_id, f.firmante_email, f.firmante_nombre,
                       f.notified_at, f.reminder_sent_at,
                       o.oc_id, o.numero_oc, o.empresa_codigo, o.moneda,
                       o.total,
                       GREATEST(f.notified_at,
                                COALESCE(f.reminder_sent_at, f.notified_at))
                           AS ultimo_aviso,
                       EXTRACT(EPOCH FROM (now() - f.notified_at)) / 86400.0
                           AS dias_esperando,
                       p.razon_social AS proveedor
                  FROM core.oc_firmas f
                  JOIN core.ordenes_compra o ON o.oc_id = f.oc_id
                  LEFT JOIN core.proveedores p
                         ON p.proveedor_id = o.proveedor_id
                 WHERE f.status = 'PENDIENTE'
                   AND f.notified_at IS NOT NULL
                   AND o.estado = 'en_firma'
                   AND f.firmante_email NOT LIKE :placeholder
                   AND GREATEST(f.notified_at,
                                COALESCE(f.reminder_sent_at, f.notified_at))
                       < now() - make_interval(hours => :horas)
                 ORDER BY f.firmante_email, o.fecha_emision
                """
            ),
            {"placeholder": f"%@{_SIN_EMAIL_DOMAIN}", "horas": HORAS_ENTRE_AVISOS},
        )
    ).mappings().all()
    return [dict(f) for f in filas]


def agrupar_por_firmante(filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """UN aviso por persona, con todas sus OC. Función pura, testeable."""
    grupos: dict[str, dict[str, Any]] = {}
    for f in filas:
        email = str(f["firmante_email"]).lower()
        g = grupos.setdefault(
            email,
            {"email": email, "nombre": f.get("firmante_nombre") or email, "ocs": []},
        )
        g["ocs"].append(
            {
                "firma_id": f["firma_id"],
                "oc_id": f["oc_id"],
                "numero_oc": f["numero_oc"],
                "empresa_codigo": f["empresa_codigo"],
                "proveedor": f.get("proveedor"),
                "moneda": f.get("moneda") or "CLP",
                "total": f.get("total"),
                "dias_esperando": int(f.get("dias_esperando") or 0),
            }
        )
    return list(grupos.values())


def _monto(total: Any, moneda: str) -> str:
    if total is None:
        return "—"
    d = Decimal(str(total))
    if moneda == "CLP":
        return f"${int(d):,}".replace(",", ".")
    return f"{moneda} {d:,.2f}"


def html_recordatorio(grupo: dict[str, Any]) -> tuple[str, str]:
    """(asunto, html) del correo para UN firmante."""
    n = len(grupo["ocs"])
    asunto = (
        f"Tenés {n} orden{'es' if n != 1 else ''} de compra esperando tu firma"
    )
    filas = "".join(
        f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <a href="{APP_URL}/ordenes-compra/{oc['oc_id']}"
               style="color:#1a793b;font-weight:600;text-decoration:none;">
              {oc['numero_oc']}</a><br>
            <span style="color:#777;font-size:12px;">{oc['empresa_codigo']}
              · {oc.get('proveedor') or 'sin proveedor'}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;
                     text-align:right;white-space:nowrap;">
            {_monto(oc.get('total'), oc.get('moneda') or 'CLP')}<br>
            <span style="color:#b45309;font-size:12px;">
              hace {oc['dias_esperando']} día{'s' if oc['dias_esperando'] != 1 else ''}</span>
          </td>
        </tr>"""
        for oc in grupo["ocs"]
    )
    html = f"""
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;">
      <h2 style="color:#16202e;">Firmas pendientes</h2>
      <p>Hola {grupo['nombre']}: estas órdenes de compra están esperando tu
         firma. Cada una se destraba con un clic adentro.</p>
      <table style="border-collapse:collapse;width:100%;">{filas}</table>
      <p style="margin-top:16px;">
        <a href="{APP_URL}/ordenes-compra/firmas"
           style="background:#1a793b;color:#fff;padding:10px 18px;
                  border-radius:10px;text-decoration:none;font-weight:600;">
          Ver el tablero de firmas</a>
      </p>
      <p style="color:#999;font-size:12px;">Este recordatorio se repite cada
         dos días mientras la firma siga pendiente.</p>
    </div>"""
    return asunto, html


async def enviar_recordatorios(
    db: AsyncSession, *, dry_run: bool = False, empresa_codigo: str | None = None
) -> dict[str, Any]:
    """Manda los recordatorios que correspondan. Devuelve el resumen.

    `dry_run=True` cuenta y lista SIN enviar ni estampar — es lo que usa la
    verificación e2e y el botón de vista previa.
    """
    filas = await firmas_para_recordar(db)
    if empresa_codigo:
        filas = [f for f in filas if f["empresa_codigo"] == empresa_codigo]
    grupos = agrupar_por_firmante(filas)
    if dry_run or not grupos:
        return {
            "dry_run": dry_run,
            "firmantes": [
                {"email": g["email"], "ocs": [o["numero_oc"] for o in g["ocs"]]}
                for g in grupos
            ],
            "enviados": 0,
        }

    # Estampar ANTES de enviar y commitear: si el proceso muere a mitad del
    # envío, el próximo ciclo NO vuelve a spamear a los ya estampados; a los
    # no enviados los retoma en ~44 h. Perder un aviso < spamear a diario.
    ids = [oc["firma_id"] for g in grupos for oc in g["ocs"]]
    await db.execute(
        text(
            "UPDATE core.oc_firmas SET reminder_sent_at = now() "
            "WHERE firma_id = ANY(:ids)"
        ),
        {"ids": ids},
    )
    await db.commit()

    from app.services.email_service import get_email_service

    svc = get_email_service()
    enviados = 0
    for g in grupos:
        try:
            asunto, html = html_recordatorio(g)
            await svc.send_async(to=g["email"], subject=asunto, html=html)
            enviados += 1
        except Exception:  # el recordatorio jamás tumba el cron
            log.warning("recordatorio_firma.fallo", email=g["email"])

    log.info("recordatorios_firma.enviados", firmantes=enviados, firmas=len(ids))
    return {
        "dry_run": False,
        "firmantes": [
            {"email": g["email"], "ocs": [o["numero_oc"] for o in g["ocs"]]}
            for g in grupos
        ],
        "enviados": enviados,
    }
