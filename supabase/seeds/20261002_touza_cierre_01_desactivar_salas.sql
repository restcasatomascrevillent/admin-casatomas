set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- =============================================================================
-- NO APLICADA: la aplica el dueño a mano.
-- CIERRE DE RESERVAS DE TOUZA (fase de datos) · 01 · DESACTIVAR LAS 3 SALAS DE TOUZA
-- =============================================================================
-- Decisión del dueño (01/10/2026): «toda la lógica de reservas de Touza va
-- fuera, no se reserva». Este script pone `activa = false` en las 3 salas de
-- Touza de public.espacios_reserva. NO borra nada (ni salas, ni mesas, ni
-- reservas). Se deshace con 20261002_touza_cierre_01_desactivar_salas_ROLLBACK.sql.
--
-- PASOS, EN ORDEN (desde adminpanelct/, una orden por línea; ver
-- 20261002_touza_cierre_LEEME.md):
--   1. ANTES, desplegar reservas-web con el 409 de Touza (commit «feat(reservas-web):
--      Touza no admite reservas, el servidor las rechaza con 409»):
--        npx supabase functions deploy reservas-web
--      Con la versión vieja (v16, 30/09) desplegada, al quedar Touza sin aforo
--      la web de Touza ya no recibiría el 409 amable sino «sin disponibilidad»,
--      y cada intento podría acabar como solicitud pendiente en la campana.
--   2. ESTE script:
--        npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_01_desactivar_salas.sql
--   3. Comprobar:
--        npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--
-- QUÉ SALAS. Se identifican por caracteristicas->>'marca' = 'touza' Y por id,
-- NUNCA por nombre (Casa Tomás también tiene una sala «Terraza»):
--   1c976f78-0bd7-4d10-b7bf-5208c910d16d  El Reservado  20 plazas  (alta 22/09)
--   1d268991-ab58-49c6-b70e-10d9533595a7  Interior      30 plazas  (alta 26/09)
--   0ca1e7aa-d1bc-4c70-994a-4932db7e5c12  Terraza       30 plazas  (alta 26/09)
--   Aforo activo de Touza: 80 -> 0. Casa Tomás no cambia: 4 salas, 170 plazas.
--
-- QUÉ CAMBIA
--   · BD (lo importante). El trigger trg_validar_capacidad
--     (validar_capacidad_reserva) suma solo las salas ACTIVAS de la MISMA marca
--     que la reserva. Touza pasa a aforo 0, así que la BD rechaza con 23514
--     («Aforo superado para el turno. Capacidad total: 0…») cualquier alta, o
--     cualquier cambio que AÑADA ocupación, de una reserva viva de Touza, venga
--     de la web, del bot, del panel o de SQL. Pasar una reserva a cancelada,
--     no_show o completada, o editarla sin añadir ocupación, sigue funcionando
--     (el cron de no-show no se rompe).
--   · Bots telefónicos (restaurante-phone). En origin/main (lo que más
--     probablemente está desplegado en Vercel; no se puede comprobar desde
--     aquí) los DOS webhooks, api/vapi-webhook.js y api/el-webhook.js, suman
--     en getEspaciosConOcupacion TODAS las salas activas sin mirar la marca:
--     hoy ven 250 plazas (170 + 80), dan por bueno un hueco que el trigger de
--     Casa Tomás (170) rechaza después y el cliente oye «reservation_error» en
--     vez de quedar registrado como solicitud. Además cuentan las salas de
--     Touza como «sala con sitio libre». Tras este script los dos pasan a ver
--     170, lo mismo que ya valida el trigger de aforo. La rama
--     feat/reservas-sin-salas de restaurante-phone (commit «feat(telefono):
--     aforo por turno y marca, sin salas en Casa Tomás», NO está en main) ya
--     filtra por marca: para ella no cambia nada en Casa Tomás.
--   · Panel (adminpanelct desde el commit «refactor(reservas): el panel deja de
--     gestionar reservas de Touza (solo Casa Tomas)»): ya ignora las salas de Touza
--     (salaAdmiteReservas, por marca); no cambia nada visible. Un panel más
--     antiguo dejaría de sumarlas en el aforo (250 -> 170).
--   · reservas-web nueva: el 409 va antes de leer ninguna sala; no cambia.
--   · emails-reserva lee los nombres de sala sin filtrar por `activa`: no cambia.
--   · updated_at de las 3 salas pasa a la hora de aplicación (lo pone el
--     trigger update_espacios_reserva_updated_at, el único de la tabla). El
--     ROLLBACK no puede devolver el valor anterior (el trigger lo vuelve a pisar).
--   · No dispara ninguna FK: el UPDATE no toca `id`. Mesas, planos, turnos,
--     asignaciones y reservas quedan igual.
--   · RLS no aplica: `db query --linked` entra como postgres, dueño de la tabla
--     y con BYPASSRLS (sin FORCE ROW LEVEL SECURITY).
--
-- PRE-COMPROBACIONES (si alguna falla, RAISE y no se escribe nada):
--   a) las salas con marca touza son exactamente las 3 de arriba;
--   b) ninguna reserva VIVA (pendiente/verificada/confirmada) de Casa Tomás está
--      asignada (espacio_id) a una de ellas;
--   c) nada depende de ellas: mesas, planos_espacio, configuracion_turnos,
--      asignaciones_mesa, asignaciones_mesa_descartadas, solicitudes_pendientes
--      con propuesta en ellas y exclusiones de configuracion_reservas;
--   d) Casa Tomás tiene al menos una sala activa (no se ha confundido de negocio).
-- IDEMPOTENTE: si ya está aplicado, el UPDATE no cambia ninguna fila y la
-- verificación pasa igual.
-- VERIFICACIÓN dentro de la transacción: 0 salas de Touza activas y las salas
-- de Casa Tomás exactamente como estaban (activa, capacidad, características).
-- lock_timeout de 5 s: un 55P03 significa que no ha escrito nada; reintentar.
-- SALIDA: una fila por sala (de los dos negocios) con el aforo activo por
-- negocio y el total que ven los dos bots de origin/main.
--
-- Comprobado SOLO con SELECT el 02/10/2026 (16:30, hora de Madrid): 3 salas de
-- Touza activas (80) y 4 de Casa Tomás (170); 0 mesas, planos, turnos,
-- asignaciones, descartadas y solicitudes en salas de Touza; 0 reservas de
-- Casa Tomás en ellas (en ningún estado); las 5 reservas de Touza (lote demo
-- del 25/09) están en El Reservado; ninguna sala excluida en configuracion_reservas.
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- Foto de las salas de Casa Tomás ANTES (para la verificación final).
create temp table _touza_01_ct_antes on commit drop as
  select id, activa, capacidad_maxima, caracteristicas
    from public.espacios_reserva
   where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza';

-- 0) Pre-comprobaciones.
do $pre$
declare
  -- Ordenadas por uuid (así las devuelve array_agg(... order by id)).
  c_salas constant uuid[] := array[
    '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',  -- Terraza (Touza)
    '1c976f78-0bd7-4d10-b7bf-5208c910d16d',  -- El Reservado
    '1d268991-ab58-49c6-b70e-10d9533595a7'   -- Interior
  ]::uuid[];
  v_touza        uuid[];
  v_n            integer;
  v_ids          text;
  v_mesas        integer;
  v_planos       integer;
  v_turnos       integer;
  v_asig         integer;
  v_descartadas  integer;
  v_solicitudes  integer;
  v_excluidas    integer;
begin
  -- a) Exactamente las 3 salas esperadas llevan la marca touza.
  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]) into v_touza
    from public.espacios_reserva e
   where e.caracteristicas->>'marca' = 'touza';
  if v_touza is distinct from c_salas then
    raise exception 'Las salas con marca touza no son las 3 esperadas (hay %: %). No se ha tocado nada: revisarlo antes.',
      cardinality(v_touza), v_touza;
  end if;

  -- b) Ninguna reserva viva de Casa Tomás asignada a esas salas.
  select count(*), string_agg(r.id::text, ', ' order by r.fecha, r.hora)
    into v_n, v_ids
    from public.reservas r
   where r.espacio_id = any (c_salas)
     and r.marca <> 'touza'
     and r.estado in ('pendiente', 'verificada', 'confirmada');
  if v_n > 0 then
    raise exception 'Hay % reservas VIVAS de Casa Tomás asignadas a salas de Touza (ids: %). Pásalas antes a una sala de Casa Tomás. No se ha tocado nada.',
      v_n, v_ids;
  end if;

  -- c) Nada depende de esas salas.
  select count(*) into v_mesas       from public.mesas                         where espacio_id = any (c_salas);
  select count(*) into v_planos      from public.planos_espacio                where espacio_id = any (c_salas);
  select count(*) into v_turnos      from public.configuracion_turnos          where espacio_id = any (c_salas);
  select count(*) into v_asig        from public.asignaciones_mesa             where espacio_id = any (c_salas);
  select count(*) into v_descartadas from public.asignaciones_mesa_descartadas where espacio_id = any (c_salas);
  select count(*) into v_solicitudes from public.solicitudes_pendientes        where espacio_propuesto_id = any (c_salas);
  select count(*) into v_excluidas    from public.configuracion_reservas        where asignacion_espacios_excluidos && c_salas;
  if v_mesas + v_planos + v_turnos + v_asig + v_descartadas + v_solicitudes + v_excluidas > 0 then
    raise exception 'Hay datos que dependen de las salas de Touza: mesas %, planos %, turnos %, asignaciones_mesa %, asignaciones descartadas %, solicitudes con propuesta %, exclusiones en configuracion_reservas %. El 02/10/2026 todo era 0: revisarlo antes. No se ha tocado nada.',
      v_mesas, v_planos, v_turnos, v_asig, v_descartadas, v_solicitudes, v_excluidas;
  end if;

  -- d) Casa Tomás conserva al menos una sala activa.
  if not exists (select 1 from public.espacios_reserva
                  where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas') then
    raise exception 'Casa Tomás no tiene ninguna sala activa: algo no cuadra. No se ha tocado nada.';
  end if;
end
$pre$;

-- 1) Desactivar las 3 salas (doble cerrojo: marca Y id). Solo las que sigan activas.
update public.espacios_reserva
   set activa = false
 where caracteristicas->>'marca' = 'touza'
   and id = any (array[
         '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',
         '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
         '1d268991-ab58-49c6-b70e-10d9533595a7'
       ]::uuid[])
   and activa is distinct from false;

-- 2) Verificación (dentro de la transacción: si falla, no queda nada escrito).
do $post$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.espacios_reserva
   where caracteristicas->>'marca' = 'touza'
     and activa is distinct from false;
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: siguen % salas de Touza activas. Se deshace todo.', v_n;
  end if;

  select count(*) into v_n from (
    (select id, activa, capacidad_maxima, caracteristicas from _touza_01_ct_antes
     except
     select id, activa, capacidad_maxima, caracteristicas from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza')
    union all
    (select id, activa, capacidad_maxima, caracteristicas from public.espacios_reserva
      where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza'
     except
     select id, activa, capacidad_maxima, caracteristicas from _touza_01_ct_antes)
  ) d;
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: las salas de Casa Tomás han cambiado (% diferencias). Se deshace todo.', v_n;
  end if;
end
$post$;

commit;

-- 3) Salida (solo lectura): todas las salas, con el aforo activo por negocio.
--    Esperado: Touza 3 salas activa=false y aforo 0; Casa Tomás 4 activas, 170;
--    aforo_activo_total (lo que suman los dos bots de origin/main) 170.
select coalesce(e.caracteristicas->>'marca', 'casa_tomas') as negocio,
       e.nombre                                               as sala,
       e.id,
       e.activa,
       e.capacidad_maxima,
       coalesce(sum(e.capacidad_maxima) filter (where e.activa)
                  over (partition by coalesce(e.caracteristicas->>'marca', 'casa_tomas')), 0) as aforo_activo_negocio,
       coalesce(sum(e.capacidad_maxima) filter (where e.activa) over (), 0)                   as aforo_activo_total
  from public.espacios_reserva e
 order by 1, 2, 3;
