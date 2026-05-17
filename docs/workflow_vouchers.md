# Flujo completo de un voucher — del DRAFT al EXECUTED

Mapa visual de los 5 estados y qué hacer en cada uno. La app refleja este
flow en sidebar, badges y empty-states (Rounds 67–76).

## Diagrama

```
┌──────────┐  enviar a    ┌─────────┐  firmar      ┌──────────┐
│  DRAFT   │ ───────────► │ PENDING │ ───────────► │ APPROVED │
└──────────┘  aprobación  └─────────┘  GG +        └──────────┘
   ▲                                    DIRECTOR        │
   │  crear                                             │ descargar
   │  voucher                                           │ planilla
   │                                                    │ + transferir
   │                                                    ▼
   │                                              ┌──────────┐
   │                                              │ EXECUTED │
   │                                              └──────────┘
   │
   └─ Alternativas: VOID (anulado) · REJECTED (rechazado en aprobación)
```

## Estados y dónde verlos en la app

| Estado | Significado | Dónde aparece | Próximo paso |
|---|---|---|---|
| **DRAFT** | Borrador, edición libre | `/vouchers?status=DRAFT` · *Mis pendientes* | Subir factura adjunta → "Enviar a aprobación" |
| **PENDING** | Esperando 2 firmas | `/aprobaciones` (badge ámbar en sidebar) | GG firma → DIRECTOR firma |
| **APPROVED** | Aprobado, listo para pagar | `/transferencias` (badge verde "Confirmar pagos · Planilla") | Descargar Excel → cargar al banco |
| **EXECUTED** | Pago confirmado | `/vouchers?status=EXECUTED` | Conciliar con extracto bancario |
| **VOID** | Anulado | `/vouchers?status=VOID` | Histórico, no se modifica |

## Quién hace qué

| Rol | Qué hace |
|---|---|
| **Operador (admin/finance)** | Crea DRAFT · sube adjunto · envía a aprobación · descarga planilla · marca EXECUTED |
| **GG titular o `btoro@cenergy.cl` (fallback)** | 1ra firma en `/aprobaciones` |
| **DIRECTOR (`grietta@cehtacapital.com` o backup)** | 2da firma en `/aprobaciones` |

(Ver `docs/validacion_vouchers_cuentas.md` para el detalle por empresa.)

## Errores típicos y qué significan

| Mensaje | Causa | Solución |
|---|---|---|
| *"Voucher de COMPRA requiere al menos un adjunto"* | Click en "Enviar a aprobación" sin factura | Subí factura/boleta en sección "Adjuntos" del voucher |
| *"Las líneas no cuadran"* | `total_debit ≠ total_credit` | Revisar imputación contable, debe ser partida doble |
| *"No tenés el rol 'GG' activo en empresa X"* | Quisiste firmar sin tener el rol asignado | Solo GG y DIRECTOR pueden firmar |
| *"El próximo rol que debe firmar es DIRECTOR"* | Quisiste firmar fuera de orden | Esperá la 1ra firma (GG) antes |
| *"Solo vouchers APPROVED pueden marcarse como EXECUTED"* | Bulk-execute sobre PENDING/DRAFT | Solo se ejecutan los ya aprobados |

## Atajos de teclado

| Tecla | Destino |
|---|---|
| `gp` | Mis pendientes |
| `gv` | Vouchers (lista) |
| `gd` | Dashboard |
| `gi` | Inbox (mailbox) |
| `Ctrl/Cmd + K` | Búsqueda global |
| `Esc` | Cerrar modal abierto |

## Rounds relacionados al flow

- **Round 67**: badge verde en sidebar con count APPROVED ready-to-pay
- **Round 68**: índices SQL parciales por status (perf futura)
- **Round 71**: fix de permisos `app_role` (sin esto el operador era viewer)
- **Round 72**: gating del botón "Enviar a aprobación" si falta adjunto
- **Round 73**: rename a "Confirmar pagos · Planilla" + tooltip
- **Round 74**: empty-state contextual `/transferencias`
- **Round 75**: *Mis pendientes* muestra los 3 estados con CTAs
- **Round 76**: empty-state `/aprobaciones` cierra el loop hacia transferencias + OnboardingTour incluye el paso nuevo

---

*Última actualización: 17/05/2026.*
