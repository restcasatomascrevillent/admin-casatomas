-- ===========================================================================
-- ##                                                                       ##
-- ##                          PENDIENTE DE APLICAR                         ##
-- ##                                                                       ##
-- ##   Fase B de reservas-sin-salas. Requiere 20260930110000 (lee           ##
-- ##   asignacion_ventana_horas / asignacion_aviso_activo) y                ##
-- ##   20260926140000 (vista_asignacion_dia). Idempotente.                  ##
-- ##                                                                       ##
-- ===========================================================================
--
-- reservas-sin-salas (Fase B2): aviso en la campana del panel para reservas
-- que entran en la ventana de asignación sin sala o sin mesas.
--
-- Decisión del dueño (2026-09-29): el panel pone arriba las reservas de las
-- próximas N horas y AVISA de las que no están asignadas. Reglas cerradas por
-- la orquestadora (engram sdd/reservas-sin-salas/tasks, R2):
--   · Salta para grado <> 'con_mesa' (sin_sala o sin_mesa), en los DOS
--     negocios.
--   · Excluye datos de prueba: `[DEMO-SEED]` en reservas.notas_cliente o en
--     reservas.nombre (el seed lo escribe al principio de las notas, ver
--     supabase/seeds/gen_seed.js), o un email que acaba en @example.com (sin
--     distinguir mayúsculas).
--   · Respeta asignacion_aviso_activo y la ventana asignacion_ventana_horas.
--   · UNA sola vez por reserva, para siempre.
--
-- Por qué un libro de avisos aparte (avisos_reserva_enviados) y no un índice
-- único en notificaciones_dashboard: el personal puede BORRAR notificaciones
-- (CentroNotificaciones, eliminarNotificacion). Con el índice, un borrado
-- haría que el aviso volviera a saltar en la siguiente pasada del cron.
--
-- Qué crea (sin begin/commit propio: la CLI envuelve cada migración):
--   1. Tabla public.avisos_reserva_enviados(clave PK, reserva_id FK ON DELETE
--      CASCADE, creado_at). RLS activada SIN políticas y sin privilegios para
--      anon/authenticated: solo la escribe la función de abajo.
--   2. public.fn_avisar_reservas_sin_asignar() RETURNS integer (nº de avisos
--      nuevos). SECURITY DEFINER con search_path fijo; EXECUTE revocado de
--      public, anon y authenticated (solo la llama pg_cron como postgres).
--        a) Marca como leídos los avisos 'reserva_sin_asignar' cuya reserva ya
--           tiene mesas o ha dejado de estar activa (cancelada, no_show,
--           completada o borrada). Corre SIEMPRE, con el aviso activo o no:
--           solo limpia.
--        b) Si el aviso está apagado, termina devolviendo 0.
--        c) Reservas activas de vista_asignacion_dia con grado <> 'con_mesa'
--           cuya hora (Europe/Madrid) cae entre ahora y ahora + N horas, sin
--           datos de prueba -> INSERT en el libro ON CONFLICT DO NOTHING ->
--           solo las que entran por primera vez generan notificación.
--   3. Job pg_cron 'reservas-aviso-sin-asignar' cada 15 minutos.
--
-- `origen` de la notificación se deja NULL: el CHECK
-- notificaciones_dashboard_origen_valido solo admite tres valores de Edge
-- Functions y NULL; no hace falta tocarlo. `tipo` no tiene CHECK.
--
-- NO toca reservas, espacio_id ni asignaciones_mesa (solo los LEE).
-- Rollback: supabase/rollbacks/20260930120000_aviso_reservas_sin_asignar_ROLLBACK.sql
-- ===========================================================================

-- 1. Libro de avisos ya enviados ----------------------------------------------
create table if not exists public.avisos_reserva_enviados (
  clave      text primary key,
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  creado_at  timestamptz not null default now()
);

comment on table public.avisos_reserva_enviados is
  'Libro de avisos automáticos ya emitidos (clave = ''<tipo>:<reserva_id>''). Garantiza un aviso por reserva aunque el personal borre la notificación. Solo lo escribe fn_avisar_reservas_sin_asignar.';

-- La FK con ON DELETE CASCADE necesita índice por reserva_id para que borrar
-- una reserva no recorra la tabla entera.
create index if not exists idx_avisos_reserva_enviados_reserva
  on public.avisos_reserva_enviados (reserva_id);

alter table public.avisos_reserva_enviados enable row level security;
revoke all on table public.avisos_reserva_enviados from anon, authenticated;

-- 2. Función del aviso ---------------------------------------------------------
create or replace function public.fn_avisar_reservas_sin_asignar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_horas   integer;
  v_activo  boolean;
  v_hoy     date := (now() at time zone 'Europe/Madrid')::date;
  v_nuevos  integer := 0;
begin
  -- a) Limpieza: el aviso deja de estar pendiente cuando la reserva ya tiene
  --    mesas o ya no está activa. Corre aunque el aviso esté apagado.
  update public.notificaciones_dashboard n
     set leida = true
   where n.tipo = 'reserva_sin_asignar'
     and n.leida = false
     and n.referencia_tipo = 'reserva'
     and not exists (
       select 1 from public.vista_asignacion_dia v
       where v.reserva_id = n.referencia_id
         and v.grado <> 'con_mesa'
     );

  select c.asignacion_ventana_horas, c.asignacion_aviso_activo
    into v_horas, v_activo
    from public.configuracion_reservas c
   order by c.created_at
   limit 1;

  -- b) Apagado (o sin fila de configuración): no se avisa de nada.
  if not coalesce(v_activo, false) then
    return 0;
  end if;
  v_horas := coalesce(v_horas, 48);

  -- c) Avisos nuevos, una vez por reserva.
  with candidatas as (
    select v.reserva_id, v.fecha, v.hora, v.nombre, v.numero_comensales, v.marca, v.grado
      from public.vista_asignacion_dia v
      join public.reservas r on r.id = v.reserva_id
     where v.grado <> 'con_mesa'
       -- Rango de fechas grueso primero (usa idx_reservas_fecha_estado);
       -- el filtro fino por hora va debajo.
       and v.fecha between v_hoy and v_hoy + (ceil(v_horas / 24.0)::int + 1)
       and (v.fecha + v.hora) at time zone 'Europe/Madrid'
           between now() and now() + make_interval(hours => v_horas)
       -- Datos de prueba fuera (R2).
       and position('[DEMO-SEED]' in coalesce(r.notas_cliente, '')) = 0
       and position('[DEMO-SEED]' in coalesce(r.nombre::text, '')) = 0
       and lower(btrim(coalesce(r.email::text, ''))) not like '%@example.com'
  ),
  nuevas as (
    insert into public.avisos_reserva_enviados (clave, reserva_id)
    select 'sin_asignar:' || c.reserva_id::text, c.reserva_id
      from candidatas c
    on conflict (clave) do nothing
    returning reserva_id
  )
  insert into public.notificaciones_dashboard
    (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
  select 'reserva_sin_asignar',
         case when c.grado = 'sin_sala' then 'Reserva sin sala' else 'Reserva sin mesas' end,
         coalesce(nullif(btrim(c.nombre), ''), 'Cliente') || ' · ' ||
           to_char(c.fecha, 'DD/MM') || ' ' || to_char(c.hora, 'HH24:MI') || ', ' ||
           c.numero_comensales || ' pers.' ||
           case when c.marca = 'touza' then ' (Touza)' else '' end ||
           case when c.grado = 'sin_sala'
                then ': todavía no tiene sala ni mesas asignadas.'
                else ': tiene sala pero todavía no tiene mesas.' end,
         c.reserva_id,
         'reserva',
         'normal'
    from nuevas n
    join candidatas c on c.reserva_id = n.reserva_id;

  get diagnostics v_nuevos = row_count;
  return v_nuevos;
end;
$$;

comment on function public.fn_avisar_reservas_sin_asignar() is
  'pg_cron cada 15 min (reservas-aviso-sin-asignar). Crea UNA notificación reserva_sin_asignar por reserva activa sin mesas (grado <> con_mesa) cuya hora cae en las próximas asignacion_ventana_horas, si asignacion_aviso_activo. Excluye datos de prueba ([DEMO-SEED], @example.com). Dedupe en avisos_reserva_enviados. Marca como leídos los avisos de reservas ya asignadas o no activas. Devuelve el nº de avisos nuevos.';

revoke all on function public.fn_avisar_reservas_sin_asignar() from public, anon, authenticated;

-- 3. Programación (mismo patrón idempotente que 20260926121000) --------------
create extension if not exists pg_cron;

select cron.unschedule('reservas-aviso-sin-asignar') where exists (
  select 1 from cron.job where jobname = 'reservas-aviso-sin-asignar'
);

select cron.schedule(
  'reservas-aviso-sin-asignar',
  '*/15 * * * *',
  $$ select public.fn_avisar_reservas_sin_asignar(); $$
);

-- ===========================================================================
-- VERIFICACIÓN tras aplicar
-- ===========================================================================
--   select jobname, schedule, command, active from cron.job
--   where jobname = 'reservas-aviso-sin-asignar';
--   -- -> '*/15 * * * *', activo
--
--   select relrowsecurity from pg_class where oid = 'public.avisos_reserva_enviados'::regclass;
--   -- -> true
--   select has_function_privilege('authenticated', 'public.fn_avisar_reservas_sin_asignar()', 'execute');
--   -- -> false
--
--   -- Una notificación por reserva, aunque se ejecute dos veces (sin rastro):
--   begin;
--   select public.fn_avisar_reservas_sin_asignar();   -- N (>= 0)
--   select public.fn_avisar_reservas_sin_asignar();   -- 0
--   select referencia_id, count(*) from public.notificaciones_dashboard
--   where tipo = 'reserva_sin_asignar' group by 1 having count(*) > 1;   -- 0 filas
--   -- Ninguna de datos de prueba:
--   select count(*) from public.notificaciones_dashboard n
--   join public.reservas r on r.id = n.referencia_id
--   where n.tipo = 'reserva_sin_asignar'
--     and (position('[DEMO-SEED]' in coalesce(r.notas_cliente, '')) > 0
--          or position('[DEMO-SEED]' in coalesce(r.nombre, '')) > 0
--          or lower(r.email) like '%@example.com');                       -- 0
--   rollback;
--
--   -- Con el aviso apagado no crea ninguna (sin rastro):
--   begin;
--   update public.configuracion_reservas set asignacion_aviso_activo = false;
--   select public.fn_avisar_reservas_sin_asignar();   -- 0
--   rollback;
--
--   -- espacio_id intacto (mismo número antes y después de aplicar):
--   select count(*) from public.reservas where espacio_id is not null;
-- ===========================================================================
