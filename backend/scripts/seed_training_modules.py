"""Seed 5 módulos del Centro de Aprendizaje + quizzes."""
import asyncio
import json
import asyncpg

DB = "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"

MODULES = [
    {
        "slug": "crear-voucher",
        "title": "Crear tu primer voucher",
        "description": "Aprendé a registrar una factura de compra con IVA en 3 líneas contables.",
        "difficulty": "principiante",
        "duration_min": 5,
        "content_md": (
            "### Qué vas a aprender\n"
            "- Cómo abrir el formulario de un voucher nuevo\n"
            "- Cómo cargar las 3 líneas típicas: gasto + IVA + cuenta por pagar\n"
            "- Cómo validar que el voucher esté cuadrado (debe = haber)\n\n"
            "### Pasos\n"
            "1. Ir a /vouchers/nuevo\n"
            "2. Elegir empresa, tipo COMPRA, fecha\n"
            "3. Cargar las líneas con cuenta + monto\n"
            "4. Verificar que suma debe = suma haber\n"
            "5. Guardar como DRAFT (podés volver a editarlo)\n"
        ),
        "quiz": [
            {"q": "Una factura de compra de $100.000 + IVA 19% genera...",
             "options": ["1 línea", "2 líneas", "3 líneas (gasto + IVA + cta x pagar)", "4 líneas"],
             "correct": 2},
            {"q": "¿Qué estado tiene un voucher recién creado?",
             "options": ["EXECUTED", "APPROVED", "DRAFT", "SYNCED"], "correct": 2},
            {"q": "Para enviar a firma, el voucher debe...",
             "options": ["Tener una factura adjunta", "Estar cuadrado (debe = haber)",
                         "Tener más de 10 líneas", "Tener proyecto contable"], "correct": 1},
        ],
        "sort_order": 10,
    },
    {
        "slug": "firmar-voucher",
        "title": "Aprobar y firmar vouchers",
        "description": "Cómo es el flujo de las 2 firmas y por qué es obligatorio.",
        "difficulty": "principiante",
        "duration_min": 4,
        "content_md": (
            "### Por qué 2 firmas\n"
            "Por gobernanza CMF y estándares de fondos institucionales (OPIM): "
            "ningún pago sale sin doble validación. Es protección del dinero del FIP.\n\n"
            "### Cómo firmar\n"
            "1. Ir a /aprobaciones\n"
            "2. Revisar el voucher: empresa + monto + glosa + líneas\n"
            "3. Si está OK → Firmar. Si no → Rechazar (vuelve a DRAFT para corregir).\n"
            "4. Con 2 firmas el voucher pasa a APPROVED y se puede pagar.\n\n"
            "### Firma supletoria\n"
            "Victoria y Benja son GG de las 10 empresas. Si un gerente no está, "
            "ellos pueden firmar en su lugar."
        ),
        "quiz": [
            {"q": "¿Cuántas firmas necesita un voucher para pasar a APPROVED?",
             "options": ["1", "2", "3", "Ninguna"], "correct": 1},
            {"q": "Si rechazás un voucher, este vuelve a estado...",
             "options": ["VOID", "DRAFT", "PENDING", "REJECTED permanente"], "correct": 1},
            {"q": "¿Quién puede firmar como GG cuando un gerente no está?",
             "options": ["Cualquier user finance", "Victoria o Benja",
                         "Solo el admin", "Nadie"], "correct": 1},
        ],
        "sort_order": 20,
    },
    {
        "slug": "confirmar-pago",
        "title": "Confirmar pago y planilla del banco",
        "description": "Cómo bajar la planilla del banco y marcar vouchers como pagados.",
        "difficulty": "principiante",
        "duration_min": 5,
        "content_md": (
            "### Flujo\n"
            "1. Voucher APPROVED → /transferencias\n"
            "2. Marcá los que querés pagar → clic 'Excel transferencia'\n"
            "3. Cargá la planilla en el portal del banco (BCI, Itaú, etc.)\n"
            "4. Volvé → 'Marcar Pagados' (opcional: adjuntar comprobante)\n"
            "5. Vouchers pasan a EXECUTED\n\n"
            "### Tip\n"
            "El comprobante de pago es opcional pero recomendado para auditoría."
        ),
        "quiz": [
            {"q": "El Excel de transferencia se genera desde...",
             "options": ["/vouchers", "/transferencias", "/admin", "/movimientos"], "correct": 1},
            {"q": "Tras marcar pagado, el voucher pasa a...",
             "options": ["DRAFT", "PENDING", "EXECUTED", "SYNCED"], "correct": 2},
            {"q": "¿El comprobante de pago es obligatorio?",
             "options": ["Sí siempre", "No, opcional", "Solo para >$1M", "Solo en CSL"], "correct": 1},
        ],
        "sort_order": 30,
    },
    {
        "slug": "cargar-vouchers-masivo",
        "title": "Cargar muchos vouchers a la vez",
        "description": "Usar el template Excel para subir 50+ vouchers de un golpe.",
        "difficulty": "intermedio",
        "duration_min": 7,
        "content_md": (
            "### Para qué sirve\n"
            "Cargar el histórico contable, cerrar un mes con varias facturas pasadas, etc.\n\n"
            "### Pasos\n"
            "1. /vouchers/importar → botón 'Descargar template'\n"
            "2. Llenar Excel: una fila = una línea contable; mismo voucher_ref agrupa\n"
            "3. Exportar a CSV UTF-8 separador ;\n"
            "4. Subir en /vouchers/import → 'Validar (dry-run)' → 'Importar'\n"
            "5. Todos quedan en DRAFT para revisar antes de firmar"
        ),
        "quiz": [
            {"q": "En el CSV, una FILA representa...",
             "options": ["Un voucher", "Una línea contable", "Una empresa", "Una factura"], "correct": 1},
            {"q": "¿Qué separador usa el CSV chileno?",
             "options": ["coma (,)", "punto y coma (;)", "tab", "pipe (|)"], "correct": 1},
            {"q": "Tras importar, los vouchers quedan en estado...",
             "options": ["APPROVED", "PENDING", "DRAFT", "EXECUTED"], "correct": 2},
        ],
        "sort_order": 40,
    },
    {
        "slug": "sii-nubox",
        "title": "SII y Nubox — qué hace cada uno",
        "description": "Entender las 2 integraciones tributarias y cuándo se usa cada una.",
        "difficulty": "intermedio",
        "duration_min": 6,
        "content_md": (
            "### SII\n"
            "- 9 empresas con credenciales cifradas\n"
            "- Sirve para: validar logins, descargar RCV (compras+ventas)\n"
            "- Hoy: login OK funciona, descarga RCV pivoteada a Nubox\n\n"
            "### Nubox API\n"
            "- 10 empresas con par UAT cifrado\n"
            "- Sirve para: emitir DTEs, sincronizar ventas/compras/gastos\n"
            "- Ya bajamos 216 docs UAT en prueba\n\n"
            "### Nubox Export (CSV)\n"
            "- Lleva tus vouchers locales a la contabilidad oficial (Nubox de MCG)\n"
            "- 100% manual hoy, no necesita credenciales"
        ),
        "quiz": [
            {"q": "¿Cuál integración bajamos para validar las claves SII?",
             "options": ["Nubox", "SII login", "Dropbox", "Anthropic"], "correct": 1},
            {"q": "Para emitir factura electrónica automatizada usamos...",
             "options": ["SII directo", "Nubox API REST", "Excel manual", "Email a contador"], "correct": 1},
            {"q": "El export CSV a Nubox sirve para...",
             "options": ["Subir vouchers a contabilidad oficial", "Bajar facturas",
                         "Emitir DTEs", "Validar SII"], "correct": 0},
        ],
        "sort_order": 50,
    },
]


async def main():
    db = await asyncpg.connect(DB, timeout=60, statement_cache_size=0)
    for m in MODULES:
        await db.execute(
            """
            INSERT INTO core.training_modules
                (slug, title, description, difficulty, duration_min, content_md, quiz, sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
            ON CONFLICT (slug) DO UPDATE SET
                title = EXCLUDED.title, description = EXCLUDED.description,
                difficulty = EXCLUDED.difficulty, duration_min = EXCLUDED.duration_min,
                content_md = EXCLUDED.content_md, quiz = EXCLUDED.quiz,
                sort_order = EXCLUDED.sort_order, updated_at = NOW()
            """,
            m["slug"], m["title"], m["description"], m["difficulty"], m["duration_min"],
            m["content_md"], json.dumps(m["quiz"]), m["sort_order"],
        )
        print(f'  [OK] {m["slug"]:<28} ({m["duration_min"]}min, {len(m["quiz"])} preguntas)')
    total = await db.fetchval("SELECT count(*) FROM core.training_modules WHERE active = TRUE")
    print(f"\n[OK] {total} módulos activos")
    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
