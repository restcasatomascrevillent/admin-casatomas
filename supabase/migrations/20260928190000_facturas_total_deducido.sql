-- ===========================================================================
-- ##                                                                       ##
-- ##     ESCRITA Y **NO APLICADA**. NO SE HA EJECUTADO EN NINGUN SITIO.     ##
-- ##                                                                       ##
-- ##   Ni en produccion ni en local. Espera el OK del dueno.                ##
-- ##   OJO: `supabase db push` NO esta bloqueado en este repo, asi que un   ##
-- ##   push la manda A PRODUCCION junto con 20260928140000, que tambien     ##
-- ##   sigue pendiente de decision. Revisar las dos antes de empujar.       ##
-- ##                                                                       ##
-- ===========================================================================
--
-- facturas.total_origen -- distinguir un total LEIDO de uno CALCULADO
--
-- ---------------------------------------------------------------------------
-- EL CASO
-- ---------------------------------------------------------------------------
--
--   Factura F/25011959 de Salazones Garre (24/12/2025). Es una FACTURA, no un
--   albaran. Trae tres lineas con importe impreso:
--
--     HUEVA DE MARUCA CALIDAD EXTRA      4,960 x 42,000 EUR =  208,32 EUR
--     HUEVA DE MUJOL SELECCION EXTRA     1,500 x 70,000 EUR =  105,00 EUR
--     BONITO ENTERO                     10,300 x 12,000 EUR =  123,60 EUR
--                                                            ----------
--                                                              436,92 EUR
--
--   En la foto el bloque de totales se quedo FUERA DEL ENCUADRE: la tabla de
--   lineas termina y la imagen se corta antes de la base imponible, el IVA y
--   el total a pagar. El modelo hizo LO CORRECTO —no inventar lo que no puede
--   ver— y la fila se guardo con subtotal, iva y total a NULL. Antes de ese
--   reprocesado la fila tenia 436,92.
--
--   436,92 no es un dato inexistente: es la suma exacta de tres numeros que SI
--   estan leidos. `procesar-factura` la calcula ahora (ver `deducirImportes`
--   en supabase/functions/procesar-factura/esquema.ts, bloque 4).
--
-- ---------------------------------------------------------------------------
-- POR QUE HACE FALTA UNA COLUMNA Y NO VALE CON GUARDAR EL NUMERO
-- ---------------------------------------------------------------------------
--
--   Un total leido del papel y un total calculado por nosotros NO SON EL
--   MISMO DATO, y sin marcarlo son indistinguibles en la tabla:
--
--     · El leido es lo que el proveedor factura, IVA incluido.
--     · El calculado por suma de lineas es la BASE de esas lineas. Si el
--       original llevaba un desglose de IVA que no se ve en la imagen, el
--       total real es mayor. Es utilizable para no perder el importe, pero
--       hay que poder contrastarlo con el papel antes de darlo por bueno,
--       y hay que poder LISTAR cuales son.
--
--   `alertas_validacion` ya recibe un aviso `total_deducido` por documento,
--   pero es un JSONB de texto pensado para que lo lea una persona: no sirve
--   para filtrar, ni para pintar un distintivo en una tabla de 500 filas, ni
--   para que el chatbot sepa que ese importe no es de fiar al 100%. Por eso
--   la procedencia va ademas en una columna propia.
--
--   El vocabulario ('leido' / 'deducido') es el mismo que ya usa
--   `sync-trafico-web` en su campo `total_origen` ('by_day' / 'suma_rutas'):
--   misma pregunta, misma forma de responderla.
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTA MIGRACION **NO** HACE
-- ---------------------------------------------------------------------------
--
--   · NO recalcula ni rellena ningun total historico. El backfill solo
--     etiqueta la procedencia de lo que YA hay ('leido'), porque hasta hoy
--     ningun camino de codigo calculaba un total: todos los importes de
--     `facturas` salieron de la lectura del documento. Recalcular filas
--     viejas sumando `productos_factura` es otra decision (hay documentos con
--     lineas incompletas) y se deja fuera a proposito.
--     En particular, F/25011959 NO se arregla al aplicar esto: hay que volver
--     a subirla, o corregirla a mano desde el panel.
--   · NO toca `subtotal` ni `iva`, ni añade columnas para su procedencia.
--     Esos dos no se deducen NUNCA (el tipo de IVA no esta en el documento),
--     asi que no hay nada que marcar.
--   · NO toca ninguna politica RLS, funcion, vista ni trigger. Añadir una
--     columna no cambia quien puede leer o escribir la tabla.
--
-- ---------------------------------------------------------------------------
-- EFECTOS COLATERALES REVISADOS
-- ---------------------------------------------------------------------------
--
--   · `verificar_duplicado_factura` devuelve `row_to_json(factura_existente)`
--     con `SELECT *`: a partir de ahora ese JSON lleva un campo mas. Nadie lo
--     desestructura por posicion (`index.ts` solo mira `es_duplicado`).
--   · `validar_cordura_factura` hace `SELECT ... INTO f FROM facturas`: una
--     columna mas no la afecta; no la lee y no cambia ninguna de sus alertas.
--     En particular `descuadre_cabecera` seguira sin saltar en un documento
--     con total deducido, porque compara `coalesce(f.subtotal, f.total)` con
--     la suma de lineas y en ese caso son el mismo numero por construccion.
--     Eso NO es un fallo de la comprobacion: no hay nada que comprobar cuando
--     el documento no imprime la cifra con la que contrastar. La senal de que
--     ese total no se leyo es esta columna y el aviso `total_deducido`.
--   · `src/hooks/useFacturas.ts` pide las columnas una a una, no `select('*')`:
--     la columna nueva se añade alli explicitamente en el mismo cambio.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   supabase/rollbacks/20260928190000_facturas_total_deducido_ROLLBACK.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La columna
-- ---------------------------------------------------------------------------
--  Nullable a proposito: NULL significa "esta factura no tiene total", no
--  "no sabemos de donde salio". Un DEFAULT 'leido' etiquetaria como leidas
--  las filas sin total, que es justo la mentira que esta columna existe para
--  evitar (F/25011959 tiene hoy total NULL).
ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS total_origen TEXT;

-- Vocabulario cerrado: cualquier otro valor es un error de programacion.
ALTER TABLE public.facturas
  DROP CONSTRAINT IF EXISTS facturas_total_origen_valido;
ALTER TABLE public.facturas
  ADD CONSTRAINT facturas_total_origen_valido
  CHECK (total_origen IS NULL OR total_origen IN ('leido', 'deducido'));

-- No se puede declarar deducido un total que no existe. Esto es lo que
-- garantiza en la BASE DE DATOS —no solo en el codigo de la edge function—
-- que un albaran sin precios (el caso Joselito) no pueda acabar marcado como
-- si le hubiesemos calculado algo.
ALTER TABLE public.facturas
  DROP CONSTRAINT IF EXISTS facturas_total_deducido_exige_total;
ALTER TABLE public.facturas
  ADD CONSTRAINT facturas_total_deducido_exige_total
  CHECK (total_origen IS DISTINCT FROM 'deducido' OR total IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. Backfill: todo lo que hay hoy con total salio de leer el documento
-- ---------------------------------------------------------------------------
--  Verificable por construccion: la deduccion se estrena con esta migracion,
--  asi que ninguna fila anterior puede tener un total calculado por nosotros.
--  Que algunos de esos totales fuesen MAL leidos (Joselito, MR FRIOSAT) no
--  los convierte en deducidos: siguen viniendo de la lectura, que es lo que
--  esta columna describe. Los importes dudosos ya los marca
--  `alertas_validacion`.
UPDATE public.facturas
   SET total_origen = 'leido'
 WHERE total IS NOT NULL
   AND total_origen IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Indice para la vista de revision
-- ---------------------------------------------------------------------------
--  Parcial: solo interesan las deducidas, que seran una minoria. Un indice
--  sobre toda la columna costaria escritura en cada insert para responder a
--  una consulta que nadie hace ("dame las leidas").
CREATE INDEX IF NOT EXISTS idx_facturas_total_deducido
  ON public.facturas (fecha DESC)
  WHERE total_origen = 'deducido';

COMMENT ON COLUMN public.facturas.total_origen IS
  'De donde sale `total`. ''leido'' = lo extrajo el modelo del documento. ''deducido'' = lo CALCULO procesar-factura con aritmetica exacta porque el papel no lo imprime (bloque de totales recortado o fuera del encuadre): o subtotal + iva, o la suma de todas las lineas. NULL = la factura no tiene total. Un total deducido por suma de lineas es la BASE de esas lineas: si el original llevaba IVA no visible, el importe real es mayor. Ver `deducirImportes` en supabase/functions/procesar-factura/esquema.ts y el aviso `total_deducido` en alertas_validacion.';

COMMIT;
