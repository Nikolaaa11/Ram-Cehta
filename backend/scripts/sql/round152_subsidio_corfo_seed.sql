-- R152qqq — Seed del subsidio CORFO 2024-265638 ($3.000MM)
--
-- Para que el card de "ejecución acumulada" en /claudia se renderice,
-- la fila debe existir en core.subsidios.
--
-- Esta versión SQL es equivalente al script Python
-- backend/scripts/seed_corfo_3mil_round83.py — útil para correr 1 vez
-- desde Supabase Studio sin necesidad de Python local.
--
-- Idempotente: ON CONFLICT actualiza si ya existe.

-- Paso 1: Insertar (o actualizar) el subsidio
INSERT INTO core.subsidios
  (subsidio_codigo, programa, nombre, monto_total,
   entidad_otorgante, estado, fecha_inicio, fecha_termino, notas)
VALUES (
  'CORFO-2026-REVTECH-TRONGKAI',
  'CORFO',
  'CORFO 2026 — REVTECH + TRONGKAI coejecutores · $3.000MM',
  3000000000,
  'CORFO',
  'ACTIVO',
  '2026-01-01'::date,
  '2027-12-31'::date,
  'Subsidio CORFO compartido entre REVTECH y TRONGKAI como coejecutores. Cada empresa tiene su proyecto contable propio pero ambos descuentan del mismo pozo. Round 83 + R152qqq.'
)
ON CONFLICT (subsidio_codigo) DO UPDATE
  SET nombre = EXCLUDED.nombre,
      monto_total = EXCLUDED.monto_total,
      estado = EXCLUDED.estado,
      fecha_termino = EXCLUDED.fecha_termino,
      notas = EXCLUDED.notas,
      updated_at = now();

-- Paso 2: Verificar
SELECT
  subsidio_codigo,
  nombre,
  monto_total / 1000000 AS monto_MM,
  estado,
  fecha_inicio,
  fecha_termino
FROM core.subsidios
WHERE subsidio_codigo = 'CORFO-2026-REVTECH-TRONGKAI';
