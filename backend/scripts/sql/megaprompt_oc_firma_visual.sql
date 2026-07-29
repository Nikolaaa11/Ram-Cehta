-- MEGAPROMPT OC · Firma visual (manuscrita) en el PDF
-- =====================================================================
-- Hasta ahora, al firmar sólo se estampaba el texto
-- "✓ Firmado electrónicamente" + timestamp + hash. Pedido de Nicolás:
-- que se vea la firma con nombre y apellido en cursiva, como cuando uno
-- firma un PDF.
--
-- `firma_visual` guarda EL TEXTO EXACTO que la persona aceptó firmar, no
-- se deriva al vuelo del nombre del miembro. Motivo: si mañana alguien
-- corrige el nombre en el catálogo de equipo, la firma ya estampada en
-- una OC firmada no puede cambiar — es un documento con valor probatorio.
--
-- Idempotente.

BEGIN;

ALTER TABLE core.oc_firmas
    ADD COLUMN IF NOT EXISTS firma_visual TEXT;

COMMENT ON COLUMN core.oc_firmas.firma_visual IS
    'Texto que se dibuja en cursiva sobre la línea de firma en el PDF. '
    'Congelado al momento de firmar: NO se re-deriva del catálogo de '
    'equipo, porque el documento firmado es probatorio.';

-- Las firmas que ya existían (si hubiera) se rellenan con el nombre del
-- firmante para que el PDF no salga con la línea vacía.
UPDATE core.oc_firmas
SET firma_visual = firmante_nombre
WHERE status = 'FIRMADA'
  AND firma_visual IS NULL
  AND firmante_nombre IS NOT NULL;

COMMIT;
