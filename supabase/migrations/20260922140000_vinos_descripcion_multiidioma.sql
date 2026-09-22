-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Este fichero NO se ha ejecutado contra ninguna base de datos.        ##
-- ##   Queda preparado para que el dueño lo revise y decida.                ##
-- ##   Es aditiva (solo ADD COLUMN IF NOT EXISTS) y no reescribe ninguna    ##
-- ##   fila existente, pero aun así debe aplicarse de forma consciente.     ##
-- ##                                                                       ##
-- ===========================================================================
--
-- QUÉ ARREGLA Y POR QUÉ
-- `Vinos` es, de las 4 tablas de la carta (Platos/Vinos/Bebidas/Cocteles), la
-- única sin columnas `descripcion_en`/`descripcion_fr`. `useVinos.ts`
-- (crearVino/actualizarVino) ya envía `descripcion` a la función
-- `traducir-contenido`, y el modelo la traduce, pero
-- `traducir-contenido/prompts.ts` (case "vino" -> mapResponse) la descarta a
-- propósito porque hoy no hay dónde guardarla: escribirla sin que la columna
-- exista tumbaría el UPDATE/INSERT entero con "column does not exist" (así
-- fallaba TODA la fila, incluido nombre/categoria, antes de la sesión que
-- corrigió `useVinos.ts` — ver el comentario de `traducirVino` en ese
-- fichero). Resultado actual: la ficha de un vino en la web en inglés/francés
-- nunca muestra su descripción, aunque el resto sí esté traducido.
--
-- Esta migración cierra ese hueco de esquema añadiendo las columnas. Por sí
-- sola NO activa la traducción de descripción: eso requiere además tocar
-- `supabase/functions/traducir-contenido/prompts.ts` (case "vino") para que
-- `mapResponse` empiece a devolver `descripcion_en`/`descripcion_fr` — ese
-- fichero vive fuera del territorio de esta sesión (zona de otro agente) y
-- por eso no se toca aquí. Una vez aplicada esta migración Y actualizado ese
-- mapResponse, `useVinos.ts` ya no necesita ningún cambio adicional: hoy
-- mismo hace `.update({ ...cambios, ...(traducciones || {}) })`, así que en
-- cuanto la función empiece a devolver esas claves, se guardan solas.
--
-- QUÉ **NO** HACE (a propósito) — ingredientes_en / ingredientes_fr
-- La tarea pedía valorar también columnas para `ingredientes`. Se decide NO
-- añadirlas, por consistencia con el resto del esquema real:
--   * `Platos` comparte con `Vinos` exactamente la misma forma base
--     (nombre/categoria/descripcion/ingredientes/alergenos_oficiales/
--     alergenos_notas/expanded/imagen_posicion_y) y TAMPOCO tiene
--     `ingredientes_en`/`ingredientes_fr` — es la única de las 4 columnas
--     "traducibles" que ninguna de las dos tablas hermanas expone.
--   * El prompt `VINO_SYSTEM` (`traducir-contenido/prompts.ts`) ni siquiera
--     pide traducir "ingredientes" (solo nombre, categoria,
--     ubicacion_pais/region y alergenos); no hay ninguna traducción esperando
--     columna donde caer.
--   * Añadir la columna igualmente crearía exactamente el tipo de esquema
--     muerto que esta sesión está retirando en otras zonas (TAREA 3): una
--     columna que ningún código real llena ni lee.
-- Si en el futuro se decide sí traducir ingredientes de vino, el patrón a
-- seguir es el mismo que esta migración usa para descripcion: añadir la(s)
-- columna(s) aquí y el mapeo correspondiente en prompts.ts.
--
-- CONVENCIÓN DE TIPO
-- `text`, igual que `Vinos.descripcion` y que `descripcion_en`/`descripcion_fr`
-- en Platos/Bebidas/Cocteles (`src/integrations/supabase/types.ts`).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas. IF NOT EXISTS: si alguna ya existiera (p. ej. porque se
--    adelantó a mano), la migración no falla ni la toca.
-- ---------------------------------------------------------------------------
ALTER TABLE public."Vinos"
  ADD COLUMN IF NOT EXISTS descripcion_en text,
  ADD COLUMN IF NOT EXISTS descripcion_fr text;

COMMENT ON COLUMN public."Vinos".descripcion_en IS
  'Traducción al inglés de "descripcion". Añadida para cerrar el hueco de esquema documentado en usePlatos.ts/useVinos.ts (TAREA 4); necesita además que traducir-contenido/prompts.ts (case "vino") empiece a devolver esta clave para que useVinos.ts la rellene sola.';

COMMENT ON COLUMN public."Vinos".descripcion_fr IS
  'Traducción al francés de "descripcion". Mismo hueco y misma dependencia que descripcion_en (ver su comentario).';


-- ===========================================================================
-- CONSULTA DE ENSAYO (opcional, solo lectura)
-- ---------------------------------------------------------------------------
-- Antes de aplicar, para confirmar que las columnas todavía no existen:
--
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'Vinos'
--     AND column_name IN ('descripcion_en', 'descripcion_fr');
--
-- Después de aplicar (y de que prompts.ts sepa devolverlas), para ver cuántos
-- vinos siguen pendientes de traducción de descripción:
--
--   SELECT count(*) FILTER (WHERE descripcion IS NOT NULL AND btrim(descripcion) <> ''
--                              AND (descripcion_en IS NULL OR btrim(descripcion_en) = '')) AS pendientes_en,
--          count(*) FILTER (WHERE descripcion IS NOT NULL AND btrim(descripcion) <> ''
--                              AND (descripcion_fr IS NULL OR btrim(descripcion_fr) = '')) AS pendientes_fr
--   FROM public."Vinos";
-- ===========================================================================
