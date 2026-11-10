-- ============================================================================
-- Jueves de tapas por la noche: DOS TURNOS FIJOS (20:30 y 22:00)
-- ----------------------------------------------------------------------------
-- Petición del dueño (10/11/2026): «jueves de tapas, que es por la tarde,
-- tenemos que poner dos turnos, uno 20:30 y otro 22:00 […] es solo ese día».
--
-- El sistema normal ofrece horas sueltas (escalera de horas / medias / cuartos
-- de `configuracion_turnos`). En vez de un «if jueves» repartido por el código,
-- se añade a los periodos de turno una opción de CONFIGURACIÓN:
--
--   configuracion_turnos.horas_fijas time[]  (NULL = como siempre)
--
-- Si un periodo tiene horas fijas, ese periodo ofrece EXACTAMENTE esas horas
-- (sin escalera) en el panel (alta, rejilla de cuartos) y en el motor común de
-- la web/bot (`_shared/disponibilidad.ts`). Y la mesa de una reserva de un
-- turno fijo queda libre a la hora del turno siguiente (20:30 → hasta las
-- 22:00), para que la misma mesa se pueda dar a los dos turnos:
-- `fn_franja_ocupacion_mesa` recorta la franja con
-- `fn_minutos_hasta_siguiente_turno_fijo`.
--
-- DATOS: la «Cena» general deja de aplicar al jueves y se crea el periodo
-- «Cena · Jueves de tapas» (jueves, 20:30-<fin de la cena>, horas fijas 20:30 y
-- 22:00). La comida del jueves no se toca. La web sigue sin reservas el jueves
-- (`dias_abiertos_sin_reserva_online`, 20261122103000): esto no la abre.
--
-- Idempotente: si ya hay un periodo de jueves con horas fijas, no toca datos.
-- Vuelta atrás: supabase/rollbacks/20261122200100_turnos_horas_fijas_jueves_tapas_ROLLBACK.sql
-- ============================================================================

-- 1. La columna -------------------------------------------------------------
alter table public.configuracion_turnos
  add column if not exists horas_fijas time[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'configuracion_turnos_horas_fijas_check'
      and conrelid = 'public.configuracion_turnos'::regclass
  ) then
    alter table public.configuracion_turnos
      add constraint configuracion_turnos_horas_fijas_check
      check (horas_fijas is null or (cardinality(horas_fijas) between 1 and 12 and array_position(horas_fijas, null) is null));
  end if;
end $$;

comment on column public.configuracion_turnos.horas_fijas is
  'Turnos de hora fija (p. ej. {20:30,22:00} el jueves de tapas). NULL = horas por la escalera de siempre. Con valor, el periodo ofrece SOLO esas horas y la mesa de un turno queda libre a la hora del siguiente. Migración 20261122200100.';

-- 2. Minutos hasta el turno fijo siguiente ----------------------------------
create or replace function public.fn_minutos_hasta_siguiente_turno_fijo(p_fecha date, p_hora time)
returns integer
language sql
stable
set search_path = public
as $$
  --  Turnos fijos de ese día de la semana (periodos generales activos). Solo
  --  recorta si la reserva cae dentro de la secuencia de turnos (desde el
  --  primero) y hay un turno después: 20:30 → 90 (las 22:00); 22:00 → NULL.
  with fijas as (
    select h
    from public.configuracion_turnos c
    cross join lateral unnest(c.horas_fijas) as h
    where c.horas_fijas is not null
      and c.activo is not false
      and c.espacio_id is null
      and (cardinality(c.dias_semana) = 0 or extract(dow from p_fecha)::int = any (c.dias_semana))
  )
  select (extract(epoch from (min(h) filter (where h > p_hora) - p_hora)) / 60)::integer
  from fijas
  having min(h) <= p_hora and min(h) filter (where h > p_hora) is not null;
$$;

comment on function public.fn_minutos_hasta_siguiente_turno_fijo(date, time) is
  'Minutos desde p_hora hasta el siguiente turno de hora fija de ese día (configuracion_turnos.horas_fijas), o NULL si no hay turnos fijos o no hay siguiente. Migración 20261122200100.';

revoke all on function public.fn_minutos_hasta_siguiente_turno_fijo(date, time) from public, anon;
grant execute on function public.fn_minutos_hasta_siguiente_turno_fijo(date, time) to authenticated, service_role;

-- 3. La franja de mesa respeta los turnos fijos -----------------------------
create or replace function public.fn_franja_ocupacion_mesa(p_fecha date, p_hora time)
returns tsrange
language sql
stable
set search_path = public
as $$
  select tsrange(p_fecha + p_hora,
                 p_fecha + p_hora + make_interval(mins => least(
                   public.fn_minutos_ocupacion_mesa(p_hora),
                   coalesce(public.fn_minutos_hasta_siguiente_turno_fijo(p_fecha, p_hora), 2147483647))),
                 '[)');
$$;

comment on function public.fn_franja_ocupacion_mesa(date, time) is
  'Franja [inicio, fin) en la que una reserva ocupa su mesa: de su hora a hora + fn_minutos_ocupacion_mesa, recortada en el siguiente turno de hora fija (20261122200100: jueves de tapas 20:30 → 22:00). Migración 20261005130000_mesas_ocupacion_por_tiempo.';

-- 4. Datos: el jueves por la noche, en dos turnos -----------------------------
do $$
declare
  v_cena public.configuracion_turnos%rowtype;
begin
  if exists (
    select 1 from public.configuracion_turnos
    where horas_fijas is not null and espacio_id is null and 4 = any (dias_semana)
  ) then
    raise notice 'Ya hay turnos fijos el jueves: no se tocan datos.';
    return;
  end if;

  -- La cena general que hoy aplica al jueves (la primera que empieza a partir de las 17:00).
  select * into v_cena
  from public.configuracion_turnos
  where espacio_id is null
    and activo is not false
    and hora_inicio >= time '17:00'
    and (cardinality(dias_semana) = 0 or 4 = any (dias_semana))
  order by hora_inicio
  limit 1;

  if not found then
    raise notice 'No hay cena general el jueves: se crea solo el periodo de tapas.';
  else
    update public.configuracion_turnos
       set dias_semana = case
             when cardinality(dias_semana) = 0 then array[0, 1, 2, 3, 5, 6]
             else array_remove(dias_semana, 4)
           end,
           updated_at = now()
     where id = v_cena.id;
  end if;

  insert into public.configuracion_turnos (
    nombre_periodo, hora_inicio, hora_fin, intervalo_base_minutos, umbral_apertura_secundario,
    dias_semana, activo, espacio_id, ocultar_primario_si_secundario, niveles_escalera,
    ocultar_nivel_anterior, base_umbral, horas_fijas
  ) values (
    'Cena · Jueves de tapas',
    time '20:30',
    coalesce(v_cena.hora_fin, time '23:30'),
    coalesce(v_cena.intervalo_base_minutos, 30),
    coalesce(v_cena.umbral_apertura_secundario, 70),
    array[4],
    true,
    null,
    coalesce(v_cena.ocultar_primario_si_secundario, false),
    v_cena.niveles_escalera,
    coalesce(v_cena.ocultar_nivel_anterior, false),
    coalesce(v_cena.base_umbral, 'reparto_nivel_base'),
    array[time '20:30', time '22:00']
  );
end $$;

-- 5. Comprobación ---------------------------------------------------------
do $$
begin
  -- Un jueves cualquiera (19/11/2026): la reserva de las 20:30 deja la mesa a las 22:00.
  if upper(public.fn_franja_ocupacion_mesa(date '2026-11-19', time '20:30')) <> timestamp '2026-11-19 22:00' then
    raise exception 'MIGRACIÓN ABORTADA: el turno de las 20:30 del jueves no termina a las 22:00.';
  end if;
  -- Un miércoles no cambia nada.
  if public.fn_minutos_hasta_siguiente_turno_fijo(date '2026-11-18', time '20:30') is not null then
    raise exception 'MIGRACIÓN ABORTADA: los turnos fijos se aplican fuera del jueves.';
  end if;
end $$;
