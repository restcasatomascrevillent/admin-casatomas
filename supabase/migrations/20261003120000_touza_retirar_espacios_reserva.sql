set client_encoding = 'UTF8';
-- (Primera línea a propósito: psql en una consola de Windows puede arrancar en
-- WIN1252 y leer mal las tildes de los mensajes.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   RETIRA DE LA BASE DE DATOS LOS 3 ESPACIOS DE TOUZA                  ##
-- ##   (public.espacios_reserva, caracteristicas.marca = 'touza').         ##
-- ##   Solo borra esas 3 filas. No toca reservas, mesas ni Casa Tomás.     ##
-- ##                                                                       ##
-- ===========================================================================
--
-- DECISIÓN DEL DUEÑO (03/10/2026): Touza NUNCA va a gestionar reservas con este
-- sistema. Este paso es el último del cierre por fases de
-- supabase/seeds/20261002_touza_cierre_LEEME.md (fase «04»):
--   · reservas-web v17 con el 409 de Touza ........ desplegada el 02/10/2026
--   · 01 desactivar las 3 salas ................... APLICADO el 02/10/2026 16:24 UTC
--   · 02 borrar las 5 reservas demo + 2 sugerencias  OPCIONAL: ESTE SCRIPT LO EXIGE
--   · 03 avisos de campana ........................ opcional, hoy no cambia nada
--   · 04 ESTE: borrar las 3 salas
--
-- POR QUÉ BORRAR Y NO SOLO DESACTIVAR
--   Desactivadas (01) ya no suman aforo, pero siguen existiendo: cualquier
--   pantalla, bot o consulta que lea la tabla sin mirar `activa` ni la marca
--   las seguiría viendo («Terraza» además repite el nombre de la de Casa Tomás).
--   Si Touza no va a tener reservas nunca, no tiene sentido guardarlas. Con la
--   tabla limpia, la marca de la sala deja de importar para el aforo: el
--   trigger `validar_capacidad_reserva` suma 0 plazas para 'touza' igual que
--   ahora (suma las salas ACTIVAS de la MISMA marca; con las 3 desactivadas ya
--   da 0, borradas también), así que la BD sigue rechazando con 23514 cualquier
--   reserva viva de Touza.
--
-- POR QUÉ SE PUEDE BORRAR SIN PERDER HISTORIAL (SELECT del 03/10/2026)
--   FKs hacia espacios_reserva(id): reservas.espacio_id y
--   reservas.espacio_solicitado_id (ON DELETE SET NULL), solicitudes_pendientes.
--   espacio_propuesto_id (SET NULL), y mesas, asignaciones_mesa, planos_espacio
--   y configuracion_turnos (ON DELETE CASCADE). Sin FK pero con la columna:
--   asignaciones_mesa_descartadas.espacio_id y el array
--   configuracion_reservas.asignacion_espacios_excluidos.
--   Hoy, en las 3 salas de Touza: 0 mesas, 0 planos, 0 turnos, 0 asignaciones,
--   0 descartadas, 0 solicitudes con propuesta en ellas, 0 exclusiones. LO ÚNICO
--   QUE CUELGA son las 5 reservas demo de Touza (lote [DEMO-SEED] del 25/09, las
--   5 en «El Reservado»; espacio_id y espacio_solicitado_id): el SET NULL les
--   quitaría la sala y quedarían como reservas de Touza sin sala. Por eso este
--   script EXIGE que el 02 (borrar el lote demo) esté aplicado antes: si queda
--   alguna reserva, sea cual sea su estado, que apunte a una de las 3 salas,
--   ABORTA sin escribir nada. No decide por el dueño: borrar o no el lote sigue
--   siendo su decisión; si prefiere conservarlo, no se aplica este script y las
--   salas se quedan desactivadas (estado actual, seguro).
--
-- QUÉ BORRA (ids exactos, y además con caracteristicas->>'marca' = 'touza'):
--   1c976f78-0bd7-4d10-b7bf-5208c910d16d  El Reservado  20 plazas (alta 22/09)
--   1d268991-ab58-49c6-b70e-10d9533595a7  Interior      30 plazas (alta 26/09)
--   0ca1e7aa-d1bc-4c70-994a-4932db7e5c12  Terraza       30 plazas (alta 26/09)
--   Casa Tomás (Comedor, Salón, Terraza, Reservado; 170 plazas) no cambia.
--
-- QUÉ NO SE TOCA
--   · La columna `marca` de reservas/solicitudes y los CHECK reservas_marca_valida
--     y solicitudes_pendientes_marca_valida (la web de Touza y reservas-web
--     siguen mandando marca=touza y reservas-web contesta 409).
--   · La web pública de Touza y su carta.
--   · Funciones, triggers, vistas, políticas RLS y crons: ninguno depende de que
--     las 3 filas existan (vista_capacidad_espacios y vista_asignacion_dia las
--     leen con LEFT JOIN o desde espacios_reserva; fn_capacidad_efectiva_marca
--     y validar_capacidad_reserva suman 0 para 'touza').
--   · Triggers de espacios_reserva: solo existe uno, BEFORE UPDATE
--     (update_espacios_reserva_updated_at); un DELETE no dispara nada.
--   · Realtime: espacios_reserva no está en la publicación supabase_realtime.
--   · RLS no aplica: `db query --linked` entra como postgres (dueño de la tabla,
--     BYPASSRLS).
--
-- PASOS (desde adminpanelct/, una orden por línea; PowerShell no admite &&)
--   0. Foto de antes: npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--   1. Haber aplicado el 01 (hecho el 02/10) y el 02:
--        npx supabase db query --linked -f supabase/seeds/20261002_touza_cierre_02_borrar_reservas_demo.sql
--   2. ESTE script:
--        npx supabase db query --linked -f supabase/migrations/20261003120000_touza_retirar_espacios_reserva.sql
--   3. Pruebas (SQL plano, ASSERT dentro de BEGIN … ROLLBACK):
--        npx supabase db query --linked -f supabase/tests/touza_retirar_espacios_reserva_test.sql
--        npx supabase db query --linked -f supabase/tests/touza_cierre_comprobaciones.sql
--   Deshacer: supabase/rollbacks/20261003120000_touza_retirar_espacios_reserva_ROLLBACK.sql
--   (vuelven las 3 salas, DESACTIVADAS, con los mismos ids y datos). Orden para
--   deshacer todo el cierre: este ROLLBACK, luego el ROLLBACK del 01 (reactivar)
--   y por último el ROLLBACK del 02 (restaurar reservas).
--
-- GARANTÍAS
--   · PRE-COMPROBACIONES (RAISE y no se escribe nada): (a) las salas de Touza
--     son exactamente esas 3 o ninguna (ya borradas); ninguno de esos ids
--     pertenece a otro negocio; (b) todas siguen DESACTIVADAS (el 01 está
--     aplicado); (c) ninguna reserva (en cualquier estado) apunta a ellas; (d)
--     nada depende de ellas: mesas, planos, turnos, asignaciones, descartadas,
--     solicitudes con propuesta, exclusiones; (e) Casa Tomás conserva al menos
--     una sala activa.
--   · IDEMPOTENTE: si las 3 ya no existen, el DELETE no borra nada y la
--     verificación pasa igual.
--   · VERIFICACIÓN dentro de la transacción: 0 salas con marca touza, ninguna
--     con esos ids y las salas de Casa Tomás exactamente como estaban.
--   · lock_timeout de 5 s: un 55P03 significa que no se escribió nada; reintentar.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- Foto de las salas de Casa Tomás ANTES (para la verificación final).
create temp table _touza_04_ct_antes on commit drop as
  select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at
    from public.espacios_reserva
   where coalesce(caracteristicas->>'marca', 'casa_tomas') <> 'touza';

-- 0) Pre-comprobaciones.
do $pre$
declare
  c_salas constant uuid[] := array[
    '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',  -- Terraza (Touza)
    '1c976f78-0bd7-4d10-b7bf-5208c910d16d',  -- El Reservado
    '1d268991-ab58-49c6-b70e-10d9533595a7'   -- Interior
  ]::uuid[];
  v_touza        uuid[];
  v_ajenas       integer;
  v_activas      integer;
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
  -- a) Las salas con marca touza son exactamente las 3 esperadas, o ninguna
  --    (ya borradas: idempotente). Y esos ids no pueden ser de otro negocio.
  select coalesce(array_agg(e.id order by e.id), '{}'::uuid[]) into v_touza
    from public.espacios_reserva e
   where e.caracteristicas->>'marca' = 'touza';
  if v_touza <> '{}'::uuid[] and v_touza is distinct from c_salas then
    raise exception 'Las salas con marca touza no son las 3 esperadas ni ninguna (hay %: %). No se ha tocado nada: revisarlo antes.',
      cardinality(v_touza), v_touza;
  end if;
  select count(*) into v_ajenas
    from public.espacios_reserva e
   where e.id = any (c_salas)
     and coalesce(e.caracteristicas->>'marca', 'casa_tomas') <> 'touza';
  if v_ajenas > 0 then
    raise exception 'Alguno de los 3 ids de Touza ya no lleva la marca touza (% salas). No se ha tocado nada: revisarlo antes.', v_ajenas;
  end if;

  -- b) El 01 está aplicado: ninguna está activa.
  select count(*) into v_activas
    from public.espacios_reserva e
   where e.id = any (c_salas) and e.activa is distinct from false;
  if v_activas > 0 then
    raise exception 'Hay % salas de Touza todavía activas. Aplica antes 20261002_touza_cierre_01_desactivar_salas.sql. No se ha tocado nada.', v_activas;
  end if;

  -- c) Ninguna reserva (de ningún estado) apunta a esas salas: borrar la sala
  --    les pondría espacio_id / espacio_solicitado_id a NULL (ON DELETE SET NULL).
  select count(*), string_agg(r.id::text, ', ' order by r.fecha, r.hora)
    into v_n, v_ids
    from public.reservas r
   where r.espacio_id = any (c_salas) or r.espacio_solicitado_id = any (c_salas);
  if v_n > 0 then
    raise exception 'Hay % reservas que apuntan a salas de Touza (ids: %). Aplica antes 20261002_touza_cierre_02_borrar_reservas_demo.sql (si el dueño decide borrar el lote demo), o deja las salas desactivadas. No se ha tocado nada.',
      v_n, v_ids;
  end if;

  -- d) Nada depende de esas salas.
  select count(*) into v_mesas       from public.mesas                         where espacio_id = any (c_salas);
  select count(*) into v_planos      from public.planos_espacio                where espacio_id = any (c_salas);
  select count(*) into v_turnos      from public.configuracion_turnos          where espacio_id = any (c_salas);
  select count(*) into v_asig        from public.asignaciones_mesa             where espacio_id = any (c_salas);
  select count(*) into v_descartadas from public.asignaciones_mesa_descartadas where espacio_id = any (c_salas);
  select count(*) into v_solicitudes from public.solicitudes_pendientes        where espacio_propuesto_id = any (c_salas);
  select count(*) into v_excluidas   from public.configuracion_reservas        where asignacion_espacios_excluidos && c_salas;
  if v_mesas + v_planos + v_turnos + v_asig + v_descartadas + v_solicitudes + v_excluidas > 0 then
    raise exception 'Hay datos que dependen de las salas de Touza: mesas %, planos %, turnos %, asignaciones_mesa %, asignaciones descartadas %, solicitudes con propuesta %, exclusiones en configuracion_reservas %. El 03/10/2026 todo era 0: revisarlo antes. No se ha tocado nada.',
      v_mesas, v_planos, v_turnos, v_asig, v_descartadas, v_solicitudes, v_excluidas;
  end if;

  -- e) Casa Tomás conserva al menos una sala activa.
  if not exists (select 1 from public.espacios_reserva
                  where activa and coalesce(caracteristicas->>'marca', 'casa_tomas') = 'casa_tomas') then
    raise exception 'Casa Tomás no tiene ninguna sala activa: algo no cuadra. No se ha tocado nada.';
  end if;
end
$pre$;

-- 1) Borrar las 3 salas (doble cerrojo: marca Y id).
delete from public.espacios_reserva
 where caracteristicas->>'marca' = 'touza'
   and id = any (array[
         '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',
         '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
         '1d268991-ab58-49c6-b70e-10d9533595a7'
       ]::uuid[]);

-- 2) Verificación (dentro de la transacción: si falla, no queda nada escrito).
do $post$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.espacios_reserva
   where caracteristicas->>'marca' = 'touza'
      or id = any (array[
           '0ca1e7aa-d1bc-4c70-994a-4932db7e5c12',
           '1c976f78-0bd7-4d10-b7bf-5208c910d16d',
           '1d268991-ab58-49c6-b70e-10d9533595a7'
         ]::uuid[]);
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: siguen % salas de Touza. Se deshace todo.', v_n;
  end if;

  select count(*) into v_n from (
    (select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from _touza_04_ct_antes
     except
     select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from public.espacios_reserva)
    union all
    (select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from public.espacios_reserva
     except
     select id, nombre, descripcion, activa, capacidad_maxima, caracteristicas, created_at, updated_at from _touza_04_ct_antes)
  ) d;
  if v_n > 0 then
    raise exception 'VERIFICACIÓN: las salas de Casa Tomás han cambiado (% diferencias). Se deshace todo.', v_n;
  end if;
end
$post$;

commit;

-- 3) Salida (solo lectura): las salas que quedan. Esperado: 4 filas, todas de
--    Casa Tomás, activas, aforo 170, y ninguna de Touza.
select coalesce(e.caracteristicas->>'marca', 'casa_tomas') as negocio,
       e.nombre                                               as sala,
       e.id,
       e.activa,
       e.capacidad_maxima,
       coalesce(sum(e.capacidad_maxima) filter (where e.activa) over (), 0) as aforo_activo_total
  from public.espacios_reserva e
 order by 1, 2, 3;
