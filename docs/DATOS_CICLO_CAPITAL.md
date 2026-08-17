# Datos de Ciclo Capital — ficha de referencia

> Única fuente de los datos identificatorios que se repiten en contratos, fichas, cartas
> y material LP-facing. Cada dato indica de dónde salió. Lo que no está confirmado va
> marcado como **FALTA** — no inventar.

---

## 1 · EL FONDO

| Dato | Valor | Fuente |
|---|---|---|
| Nombre | **Fondo de Inversión Privado Ciclo Capital** | Carta oferta oficial (`CICLO_Capital_Operacion_Financiamiento.docx`) |
| Tipo | Fondo de inversión privado, Capítulo V de la Ley N°20.712 | — |
| Régimen | No regulado ni fiscalizado por la CMF (art. 93 inc. 2 Ley 20.712) | Verificado contra LeyChile |
| Límite legal de partícipes | Menos de 50 (máx. **49**) que no sean de una misma familia | Art. 84 Ley 20.712 |
| Objeto | Financiamiento inmobiliario por compraventa con pacto de retroventa sobre inmuebles urbanos en Chile | `docs/MEGA_PROMPT.md` |
| Moneda de operación | Unidad de Fomento (UF) | Canon |
| **RUT del Fondo** | **FALTA** | — |
| **Fecha de constitución** | **FALTA** | — |
| **Valor de la cuota (UF)** | **FALTA** | — |

## 2 · LA ADMINISTRADORA

Todos estos datos están verificados contra el contrato de suscripción de cuotas de AFIS
(Orbicorp, 30-oct-2025) y su contrato de promesa (29-jul-2026).

| Dato | Valor |
|---|---|
| Razón social | **ADMINISTRADORA DE FONDOS DE LA INDUSTRIA SOSTENIBLE S.A.** (AFIS) |
| RUT | **77.423.556-6** |
| Tipo | Sociedad anónima cerrada |
| Objeto exclusivo | Administración de fondos de inversión privados |
| Constitución | Escritura pública de **5 de agosto de 2021**, Notaría de Santiago de **Juan Ricardo San Martín Urrejola** |
| Inscripción | Fojas **60.822** N°**28.338**, Registro de Comercio de Santiago, año 2021 |
| Publicación | Diario Oficial del **11 de agosto de 2021** |
| Registro CMF | **N°619 del 26 de abril de 2022**, Registro Especial de Entidades Informantes |

> ⚠️ **Prohibido** usar la expresión *"administradora general de fondos"* en el nombre o en
> cualquier documentación que emita (art. 90 Ley 20.712). Alcanza a contratos, fichas,
> carta oferta y sitio web.

### Representantes de AFIS

| Nombre | RUT | Profesión | Personería |
|---|---|---|---|
| **Guido Anatole Rietta González** | 15.341.198-0 | Ingeniero comercial | Escritura de **30-01-2025**, Notaría de Santiago de Juan Ricardo San Martín Urrejola |
| **Andrés Ramiro Fernández Méndez** | FALTA | — | FALTA |

### ⚠️ Discrepancia de domicilio a resolver

Los dos contratos de AFIS declaran domicilios distintos:

| Documento | Domicilio declarado |
|---|---|
| Contrato de suscripción (30-oct-2025) | Calle **Américo Vespucio 80, oficina 31, Las Condes**, Santiago |
| Contrato de promesa (29-jul-2026) | **Av. del Valle Norte 945, oficina 3613, Huechuraba**, Santiago |

El primero coincide con el domicilio de Ciclo Capital. Puede ser un *domicilio especial*
("para estos efectos") o un cambio de oficina. **Confirmar cuál va en los contratos de
Ciclo antes de firmar.**

## 3 · CONTACTO Y DIRECCIÓN (Ciclo Capital)

| Dato | Valor |
|---|---|
| Dirección | **Av. Américo Vespucio Sur 80, Oficina 31, Las Condes, Santiago** |
| Email general | **contacto@ciclocapital.cl** |
| Email Juan Pablo | **jpvelasco@ciclocapital.cl** |
| Contacto operativo | **Pablo Solis** (aparece en el pie de la carta oferta) |
| Plataforma | https://fondo-ciclo.vercel.app |
| Bot de Telegram | **@CicloCapital_Bot** |

## 4 · JUAN PABLO

| Dato | Valor | Fuente |
|---|---|---|
| Nombre | **Juan Pablo Velasco** | Encabezado de la plataforma y `lib/cerebro.ts` |
| Email | **jpvelasco@ciclocapital.cl** | Confirmado por el usuario en sesión |
| Rol | Principal del Fondo Ciclo | — |
| **RUT** | **FALTA** | — |
| **Domicilio** | **FALTA** | — |
| **Profesión** | **FALTA** | — |
| **Personería para firmar por AFIS / el Fondo** | **FALTA** | — |

> ⚠️ **No confundir** con **Juan Pablo Chinchón Salgado** (RUT 10.485.442-7), que es el
> representante de *Ingeniería Orbicorp Limitada* — el aportante del ejemplo de AFIS, no
> del equipo de Ciclo.

## 5 · CANON FINANCIERO (intocable sin orden humana)

Proviene de `Prueba.xlsx` y de la carta oficial. Única fuente en código: `lib/model.ts`.

### Caso base de la operación

| Concepto | UF | MM CLP (a UF 40.000) |
|---|---|---|
| Tasación | 12.500 | 500 |
| LTV | 60% | — |
| Monto de la operación | 7.500 | 300 |
| Arriendos prepagados (1,5% mensual × 12) | — | 54 |
| Gastos día 1 | — | 8,5 |
| └ gestión financiera | — | 3 |
| └ operaciones y legales | — | 3,5 |
| └ contribuciones prepagadas | — | 2 |
| **Valor operación líquido** | **5.937,5** | **237,5** |
| Valor de recompra (indexado UF) | 7.500 | 300 |
| Colchón | — | 40% |

### Parámetros

| Parámetro | Valor |
|---|---|
| LTV estándar | 0,60 (premium 0,72 · ajustado 0,55) |
| Tasa mensual | 1,5% (premium 1,3% · ajustado 1,7%) |
| Plazo base | 12 meses |
| Tope legal de retroventa | 48 meses (CC art. 1885) |
| Comisión bróker inversionistas | 4 MM estimado por operación |

### Lado del inversionista

| Concepto | Valor |
|---|---|
| Retorno | **12% anual en CLP** |
| Periodicidad | **Trimestral** (4 pagos al año) |
| Compromiso | **2 años** |
| Split del 1,5% mensual | 1,0% inversionista · 0,5% gestora |
| Base de cálculo | Sobre capital **efectivamente enterado** |

## 6 · LENGUAJE OBLIGATORIO

| Regla | Detalle |
|---|---|
| Nunca "garantizado" | Se dice **respaldado** / **pactado** / **acordado**. Art. 61 Ley 18.045 sanciona la información falsa o tendenciosa. |
| Nunca "administradora general de fondos" | Art. 90 Ley 20.712. |
| Oferta privada | Nunca oferta pública ni medios masivos (Ley 18.045, NCG 336). |
| Cuotas | Se emiten contra capital **efectivamente enterado**, nunca contra el comprometido. |

## 7 · LO QUE FALTA — checklist para completar

Estos son los datos que hoy salen en **amarillo** en las plantillas de
`docs/Entrega_JuanPablo/`. Al tenerlos, se fijan en `tools/gen-contratos.js` y desaparecen:

- [ ] RUT del Fondo de Inversión Privado Ciclo Capital
- [ ] Fecha de constitución del Fondo
- [ ] Valor de la cuota en UF
- [ ] Quién firma por la Administradora (nombre, RUT, profesión)
- [ ] Personería del firmante (fecha de escritura y notaría)
- [ ] Domicilio correcto de AFIS para los contratos de Ciclo
- [ ] Cuenta bancaria del Fondo para recibir aportes
- [ ] RUT y domicilio de Juan Pablo Velasco, si va a firmar
