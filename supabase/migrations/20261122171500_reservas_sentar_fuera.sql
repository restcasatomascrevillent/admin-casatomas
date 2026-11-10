set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122171500_reservas_sentar_fuera — «Sentar fuera»: sentar una reserva
-- FUERA de las salas del plano (Touza, Terraza Touza u otro sitio) (10/11/2026)
-- ===========================================================================
-- Petición del dueño: «Añade un botón en hoy de reservas azul chillón que sea
-- sentar fuera y sean mesas que no cuenten en los espacios predefinidos pero sí
-- que se guarde esa info, por lo general se sientan en Touza o Terraza Touza».
--
-- Touza ya no es un espacio reservable (20261003120000_touza_retirar_espacios_
-- reserva): no hay sala ni mesas suyas en espacios_reserva/mesas. Por eso el
-- sitio de fuera se guarda como TEXTO en la propia reserva, no como sala.
--
-- QUÉ AÑADE (idempotente; se puede aplicar dos veces)
--   1. Columnas en public.reservas (nullable, sin DEFAULT: solo catálogo):
--        fuera_lugar             text   dónde («Touza», «Terraza Touza» u otro).
--                                       NULL = no está sentada fuera.
--        fuera_mesa              text   número de mesa o nota libre (opcional).
--        fuera_espacio_previo_id uuid   la sala que tenía antes de salir fuera,
--                                       para devolvérsela al deshacer.
--        fuera_at                timestamptz  cuándo se la sentó fuera.
--      CHECK de largo (60 / 120) y reservas_fuera_solo_llegada: fuera solo con
--      estado 'completada' («Llegó»).
--   2. Trigger BEFORE trg_reservas_sentada_fuera (fn_reservas_sentada_fuera)
--      que mantiene la regla «fuera NO cuenta en ninguna sala»:
--        · Al sentarla fuera: espacio_id := NULL (se guarda la sala en
--          fuera_espacio_previo_id), se le quitan las mesas (asignaciones_mesa)
--          y se reabre la sala si la tenía cerrada por evento. Así no ocupa
--          mesas ni plazas de ninguna sala en Hoy, plano, rejilla de salas,
--          Asignación ni modo servicio. La web y el aforo del trigger
--          validar_capacidad_reserva ya no cuentan 'completada'.
--        · Fuera solo con «Llegó»: sentar fuera ES sentar. Si la reserva deja de
--          estar 'completada' (el «Deshacer» del chip, «No vino»…) se borran los
--          datos de fuera y vuelve a su sala. Darle una sala estando fuera la
--          devuelve dentro. Poner fuera_lugar a NULL, también.
--        · Normaliza los textos (sin espacios de más; vacío = NULL).
--
-- PERMISOS: no cambian, y no hace falta función nueva. Sentar fuera es un UPDATE
-- de la reserva, como «Ha llegado»: lo deja reservas_update_seccion (exige
-- «Editar» en Reservas). El usuario tipo «Reservas» («Ver» + «Reservas ·
-- Crear») no puede actualizar reservas, y al crear no puede dejarla fuera: el
-- trigger trg_00_reservas_alta_solo_crear solo le deja altas 'pendiente' o
-- 'verificada', y este trigger exige 'completada' para estar fuera.
-- La función es SECURITY DEFINER solo para borrar las mesas y el cierre de sala
-- de ESA reserva (como reservas_sincronizar_asignaciones): solo se llega a ella
-- desde un INSERT/UPDATE que la RLS de reservas ya ha dejado pasar.
--
-- TIEMPO REAL: reservas ya está en supabase_realtime (20261001200000); un
-- cambio de estas columnas llega a las demás pantallas como cualquier otro.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con
-- el «sí» del dueño, ANTES de publicar el panel que pide estas columnas (el
-- panel aguanta sin ellas: si faltan, Hoy relee sin las columnas de fuera y el
-- botón avisa de que falta la migración):
--   supabase db query --linked -f supabase/migrations/20261122171500_reservas_sentar_fuera.sql
-- Tiene que terminar en «reservas_sentar_fuera: aplicada | …».
-- Deshacer: supabase/rollbacks/20261122171500_reservas_sentar_fuera_ROLLBACK.sql
-- Pruebas (PGlite): npm run test:sentar-fuera:db
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_col text;
begin
  if to_regclass('public.reservas') is null then
    raise exception 'reservas_sentar_fuera: MIGRACIÓN ABORTADA, falta public.reservas. No se ha cambiado nada.';
  end if;
  foreach v_col in array array['estado', 'espacio_id', 'llegada_at'] loop
    if not exists (select 1 from pg_attribute
                    where attrelid = 'public.reservas'::regclass and attname = v_col and attnum > 0 and not attisdropped) then
      v_faltan := v_faltan || format('public.reservas.%s', v_col);
    end if;
  end loop;
  if to_regclass('public.espacios_reserva') is null then
    v_faltan := v_faltan || 'public.espacios_reserva'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'reservas_sentar_fuera: MIGRACIÓN ABORTADA, falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
alter table public.reservas
  add column if not exists fuera_lugar text null,
  add column if not exists fuera_mesa text null,
  add column if not exists fuera_espacio_previo_id uuid null,
  add column if not exists fuera_at timestamptz null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reservas'::regclass and conname = 'reservas_fuera_espacio_previo_fkey') then
    alter table public.reservas
      add constraint reservas_fuera_espacio_previo_fkey
      foreign key (fuera_espacio_previo_id) references public.espacios_reserva(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reservas'::regclass and conname = 'reservas_fuera_lugar_largo') then
    alter table public.reservas
      add constraint reservas_fuera_lugar_largo check (fuera_lugar is null or char_length(fuera_lugar) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reservas'::regclass and conname = 'reservas_fuera_mesa_largo') then
    alter table public.reservas
      add constraint reservas_fuera_mesa_largo check (fuera_mesa is null or char_length(fuera_mesa) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reservas'::regclass and conname = 'reservas_fuera_solo_llegada') then
    alter table public.reservas
      add constraint reservas_fuera_solo_llegada check (fuera_lugar is null or estado = 'completada');
  end if;
end;
$$;

comment on column public.reservas.fuera_lugar is
  '«Sentar fuera» (20261122171500): dónde se sentó a la reserva FUERA de las salas del plano («Touza», «Terraza Touza» u otro). NULL = no está fuera. Solo con estado completada; mientras está fuera, espacio_id es NULL y no tiene mesas (no cuenta en ninguna sala).';
comment on column public.reservas.fuera_mesa is
  '«Sentar fuera»: número de mesa o nota libre del sitio de fuera (opcional).';
comment on column public.reservas.fuera_espacio_previo_id is
  '«Sentar fuera»: la sala que tenía la reserva antes de sentarla fuera; se le devuelve al deshacer (trg_reservas_sentada_fuera).';
comment on column public.reservas.fuera_at is
  '«Sentar fuera»: cuándo se la sentó fuera.';

-- ─── 2. La regla «fuera no cuenta en ninguna sala» ──────────────────────────
create or replace function public.fn_reservas_sentada_fuera()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
-- 20261122171500_reservas_sentar_fuera
declare
  v_era_fuera boolean := tg_op = 'UPDATE' and old.fuera_lugar is not null;
begin
  new.fuera_lugar := nullif(btrim(coalesce(new.fuera_lugar, '')), '');
  new.fuera_mesa := nullif(btrim(coalesce(new.fuera_mesa, '')), '');

  -- (a) No está fuera, o deja de estarlo: vuelve a su sala (si no le han dado otra).
  -- (b) Estaba fuera y deja de estar «Llegó» (Deshacer, «No vino», cancelar…): igual.
  -- (c) Estaba fuera y le dan una sala: vuelve dentro, a esa sala.
  if new.fuera_lugar is null
     or (v_era_fuera and new.estado is distinct from 'completada')
     or (v_era_fuera and new.espacio_id is not null and old.espacio_id is null) then
    if v_era_fuera then
      new.espacio_id := coalesce(new.espacio_id, old.fuera_espacio_previo_id);
    end if;
    new.fuera_lugar := null;
    new.fuera_mesa := null;
    new.fuera_espacio_previo_id := null;
    new.fuera_at := null;
    return new;
  end if;

  -- Sentar fuera ES sentar: solo con «Llegó».
  if new.estado is distinct from 'completada' then
    raise exception 'Sentar fuera es sentar: la reserva tiene que quedar «Llegó» (completada) para estar fuera.'
      using errcode = '23514';
  end if;

  if v_era_fuera then
    -- Sigue fuera (cambia el sitio o la mesa): la sala de antes y la hora no se tocan.
    new.fuera_espacio_previo_id := old.fuera_espacio_previo_id;
    new.fuera_at := old.fuera_at;
  else
    -- Sale fuera ahora: se guarda su sala y se le quitan las mesas y el cierre de sala por evento.
    new.fuera_espacio_previo_id := coalesce(
      new.espacio_id,
      case when tg_op = 'UPDATE' then old.espacio_id end,
      new.fuera_espacio_previo_id);
    new.fuera_at := now();
    if tg_op = 'UPDATE' then
      if to_regclass('public.asignaciones_mesa') is not null then
        execute 'delete from public.asignaciones_mesa where reserva_id = $1' using new.id;
      end if;
      if to_regclass('public.salas_cerradas_servicio') is not null then
        execute 'delete from public.salas_cerradas_servicio where reserva_id = $1' using new.id;
      end if;
    end if;
  end if;
  -- Fuera no está en ninguna sala.
  new.espacio_id := null;
  return new;
end;
$$;
comment on function public.fn_reservas_sentada_fuera() is
  'BEFORE INSERT/UPDATE en reservas («Sentar fuera», 20261122171500): fuera solo con completada; al salir fuera quita sala (la guarda en fuera_espacio_previo_id), mesas y cierre por evento; al dejar de estar fuera (o de estar completada) se la devuelve.';
revoke all on function public.fn_reservas_sentada_fuera() from public, anon, authenticated;

-- Después de trg_reservas_limpiar_llegada y antes de trg_validar_capacidad (orden alfabético de los BEFORE).
drop trigger if exists trg_reservas_sentada_fuera on public.reservas;
create trigger trg_reservas_sentada_fuera
  before insert or update of fuera_lugar, fuera_mesa, fuera_espacio_previo_id, estado, espacio_id on public.reservas
  for each row execute function public.fn_reservas_sentada_fuera();

-- ─── 3. Comprobación final ──────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.reservas'::regclass and tgname = 'trg_reservas_sentada_fuera') then
    raise exception 'reservas_sentar_fuera: comprobación final fallida (falta el trigger). No se ha aplicado nada.';
  end if;
  if exists (select 1 from public.reservas where fuera_lugar is not null and estado is distinct from 'completada') then
    raise exception 'reservas_sentar_fuera: comprobación final fallida (reservas fuera sin «Llegó»). No se ha aplicado nada.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

select 'reservas_sentar_fuera: aplicada'
       || ' | reservas sentadas fuera hoy ' || (select count(*) from public.reservas
                                               where fuera_lugar is not null and fecha = current_date)
       as resultado;
