-- ===========================================================================
-- ##                                                                       ##
-- ##                            APLICADA                                   ##
-- ##                                                                       ##
-- ##   Corregido 2026-09-23: SI esta aplicado (confirmado contra            ##
-- ##   supabase_migrations.schema_migrations, API de Supabase, solo         ##
-- ##   lectura).                                                           ##
-- ##   Es aditiva: añade una columna con DEFAULT seguro (todas las filas    ##
-- ##   existentes son de Casa Tomás) y no borra ni renombra nada.           ##
-- ##                                                                       ##
-- ===========================================================================
--
-- CONTEXTO (encargo: "los 4 correos de reservas-web llevan la marca Casa
-- Tomás escrita a fuego; El Reservado (Touza) ya reserva por la misma
-- función y recibe la marca equivocada")
--
-- `reservas` no distingue hoy a qué negocio del grupo pertenece cada fila.
-- Se añade `marca`, con DEFAULT 'casa_tomas' — el caso mayoritario y actual
-- (todas las reservas existentes son del restaurante) — para que CUALQUIER
-- camino que inserte en `reservas`, lo sepa o no, caiga siempre en un valor
-- válido. Verificado que hay más de un camino de inserción, no solo
-- `supabase/functions/reservas-web/index.ts` (territorio de esta sesión):
--
--   - restaurante-phone/api/vapi-webhook.js:1126 — `supabase.from('reservas')
--     .insert(insertData)` directo, con service role, desde el asistente de
--     voz. Todas sus reservas son telefónicas al restaurante: no hay línea
--     de teléfono de Touza en ese código, así que el DEFAULT es exactamente
--     lo correcto para este camino sin tocarlo.
--   - adminpanelct/src/components/reservas/FormularioReserva.tsx — el alta
--     manual desde el panel, autenticada (política `reservas_insert_seccion`,
--     ver `20260922170000_cerrar_insert_anonimo_reservas.sql`). Tampoco sabe
--     nada de `marca` todavía: cae en el DEFAULT hasta que ese componente
--     (fuera del territorio de esta sesión, vive en `src/**`) se actualice
--     para dejar elegir el negocio al crear a mano.
--
-- POR QUÉ UNA COLUMNA NUEVA (opción B del encargo) Y NO SOLO `espacio_id`
-- (opción A) — ambas se consideraron, se aplican las dos combinadas:
--
--   - Derivar la marca SOLO de `espacio_id` (vía
--     `espacios_reserva.caracteristicas->>'marca'`, que la migración
--     `20260922150000_espacio_el_reservado_touza.sql` ya usa para 'El
--     Reservado') es la solución "correcta" a largo plazo, pero HOY no
--     alcanza por sí sola: ni touza-restaurant-website/src/pages/
--     Reservado.tsx ni casa-tomas-story/src/components/ReservationForm.tsx
--     mandan `espacio_id` ni `sala` (verificado leyendo ambos formularios) —
--     y esa propia migración, en su sección "si el dueño quiere aprovechar
--     esta fila de verdad", ya avisa de que el frontend de Touza NO envía
--     `espacio_id` a propósito. Sin columna nueva, una reserva de Touza
--     seguiría siendo indistinguible de una de Casa Tomás.
--   - Por eso se añade `marca` en `reservas`, que SÍ puede rellenarse hoy: la
--     Edge Function la deriva, a falta de un valor explícito o de espacio
--     etiquetado, del propio texto fijo que Reservado.tsx escribe en
--     `notas_cliente` (ver `supabase/functions/reservas-web/plantillas.ts`,
--     `resolverMarca`). Es un puente deliberadamente temporal — informe de
--     la tarea tiene el detalle — pero es el único que funciona SIN
--     modificar ningún frontend, que queda fuera del territorio de esta
--     sesión.
--   - El código YA deja preparado el camino de `espacio_id` (lee
--     `caracteristicas->>'marca'` del espacio si se manda uno) para cuando
--     `20260922150000_...` se aplique y los formularios manden el espacio:
--     entonces ese camino pasa a ser la señal de mayor prioridad, sin tocar
--     `reservas-web/index.ts` otra vez.
--
-- POR QUÉ NO SE REUTILIZA EL PATRÓN `restaurante`/`touza` (dos columnas
-- booleanas) que ya usan `platos`/`bebidas`/`vinos`/`cocteles`: ahí un mismo
-- producto puede visibilizarse en las dos cartas a la vez, así que dos flags
-- independientes tiene sentido. Una reserva es de un negocio o del otro,
-- nunca de los dos — dos booleanos permitirían estados imposibles
-- (`{restaurante:true, touza:true}` o `{false,false}`). Un único valor con
-- CHECK y DEFAULT es el modelo correcto aquí. Tampoco se usa el valor
-- `"restaurante"` (el que sí usan esas tablas para "Casa Tomás"): en un
-- grupo que puede crecer a un tercer negocio, `"restaurante"` deja de
-- identificar a nadie en concreto — `"casa_tomas"` no tiene ese problema.
-- Añadir un negocio nuevo el día de mañana es añadir un valor al CHECK y una
-- entrada a `NEGOCIOS` (plantillas.ts) — ninguna plantilla cambia.
--
-- BACKFILL DE LAS RESERVAS EXISTENTES
-- El propio `ADD COLUMN ... NOT NULL DEFAULT 'casa_tomas'` rellena TODAS las
-- filas ya existentes con 'casa_tomas' como parte de la misma sentencia —
-- comportamiento estándar de PostgreSQL, no hace falta un UPDATE aparte. Es
-- además el valor correcto: hasta esta sesión el grupo solo tenía reservas
-- del restaurante.
-- ===========================================================================

begin;

-- Columna nueva. NOT NULL + DEFAULT a nivel de BASE DE DATOS (no solo en el
-- código de la Edge Function) para que cualquier INSERT que no la mande
-- —los dos casos listados arriba, y cualquiera futuro— caiga siempre en
-- 'casa_tomas', nunca en NULL. El ADD COLUMN backfillea las filas
-- existentes en la misma sentencia (ver "BACKFILL" arriba).
alter table public.reservas
  add column marca text not null default 'casa_tomas';

-- Solo dos valores hoy; añadir un tercer negocio es añadir un valor aquí.
alter table public.reservas
  add constraint reservas_marca_valida check (marca in ('casa_tomas', 'touza'));

comment on column public.reservas.marca is
  'Negocio del grupo al que pertenece la reserva (casa_tomas | touza). '
  'Default seguro: casa_tomas. Ver supabase/functions/reservas-web/plantillas.ts '
  '(resolverMarca) para cómo se decide en una reserva nueva.';

-- Backfill simétrico y ADITIVO de espacios_reserva.caracteristicas: la
-- migración `20260922150000_espacio_el_reservado_touza.sql` ya etiqueta 'El
-- Reservado' con `{"marca": "touza"}` (cuando se aplique); esto etiqueta los
-- 3 espacios del restaurante con `{"marca": "casa_tomas"}` para que
-- `resolverMarca` pueda leer la marca de CUALQUIER espacio por
-- `caracteristicas->>'marca'`, no solo la de Touza por ausencia de dato en
-- los demás. Solo RELLENA la clave 'marca' si no existe ya — no pisa
-- `caracteristicas` existente (p.ej. la propia fila de 'El Reservado', que
-- ya trae `{"privada": true, "marca": "touza"}` una vez se aplique esa otra
-- migración) ni nada que alguien haya puesto a mano.
update public.espacios_reserva
set caracteristicas = coalesce(caracteristicas, '{}'::jsonb) || '{"marca": "casa_tomas"}'::jsonb
where nombre in ('Salón', 'Comedor', 'Terraza')
  and (caracteristicas is null or not (caracteristicas ? 'marca'));

commit;

-- ---------------------------------------------------------------------------
-- CONSULTA DE VERIFICACIÓN — ejecutar DESPUÉS de aplicar esta migración.
-- Solo lee, no escribe nada.
-- ---------------------------------------------------------------------------
--
-- -- 1) Todas las reservas existentes deben haber quedado en 'casa_tomas':
-- select marca, count(*) from public.reservas group by marca;
--   -- esperado: una sola fila, ('casa_tomas', <total de reservas de hoy>)
--
-- -- 2) La columna no admite NULL ni valores fuera del CHECK:
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'reservas' and column_name = 'marca';
--   -- esperado: is_nullable = 'NO', column_default = "'casa_tomas'::text"
--
-- -- 3) Los 3 espacios del restaurante quedan etiquetados:
-- select nombre, caracteristicas->>'marca' as marca
-- from public.espacios_reserva
-- where nombre in ('Salón', 'Comedor', 'Terraza');
--   -- esperado: las 3 filas con marca = 'casa_tomas'
-- ---------------------------------------------------------------------------
