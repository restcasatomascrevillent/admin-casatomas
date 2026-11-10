-- ===========================================================================
--  CT-REM-FN-07b · reservas-web/disponibilidad: limitador persistente por IP.
--
--  Sin aplicar: la aplica el dueño (demo primero). A diferencia del limitador
--  de /crear (20261030150000), la FUNCIÓN usa este cupo FALLANDO EN ABIERTO:
--  disponibilidad es de solo lectura y el corazón del flujo de reserva, así
--  que si esta RPC no existe o falla, la consulta se SIRVE igual (no se
--  bloquea al visitante). Por eso esta migración puede aplicarse antes o
--  después de desplegar la función sin romper nada.
--
--  Motivación: /crear y chat-web ya tienen cupo; /disponibilidad no tenía
--  ninguno, así que se podía llamar en bucle (scraping / carga de BD). Límites
--  holgados: un visitante consulta unas pocas fechas; un bucle se frena.
--
--  Qué crea:
--   1. Dos columnas en public.configuracion_reservas (fila única):
--        limite_web_disponibilidad_ip_hora (120) — consultas por IP y hora.
--        limite_web_disponibilidad_dia     (5000) — consultas en el día
--                                                    natural de Madrid, todas
--                                                    las IP.
--   2. public.reservas_web_intentos_disponibilidad — una fila por consulta
--      ADMITIDA. Solo el HMAC de la IP (nunca la IP en claro). Retención 2
--      días (la limpia la RPC). Tabla separada de reservas_web_intentos para
--      no mezclar los contadores de /crear y /disponibilidad.
--   3. public.reservas_web_reservar_cupo_disponibilidad(p_ip_hash) — RPC
--      atómica con advisory lock de transacción GLOBAL (clave distinta a la
--      de /crear). Una consulta rechazada NO deja fila.
--
--  SECURITY DEFINER, search_path vacío, EXECUTE solo service_role.
--  Mismo patrón que reservas_web_reservar_cupo (20261030150000). Idempotente.
--  Deshacer: supabase/rollbacks/20261119110000_reservas_web_limitador_disponibilidad_ROLLBACK.sql
-- ===========================================================================

begin;

-- 1. Umbrales configurables (fila única existente) ---------------------------
alter table public.configuracion_reservas
  add column if not exists limite_web_disponibilidad_ip_hora integer not null default 120,
  add column if not exists limite_web_disponibilidad_dia      integer not null default 5000;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'configuracion_reservas_limite_web_disp_ip_hora_check') then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_limite_web_disp_ip_hora_check check (limite_web_disponibilidad_ip_hora > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'configuracion_reservas_limite_web_disp_dia_check') then
    alter table public.configuracion_reservas
      add constraint configuracion_reservas_limite_web_disp_dia_check check (limite_web_disponibilidad_dia > 0);
  end if;
end $$;

comment on column public.configuracion_reservas.limite_web_disponibilidad_ip_hora is
  'Máximo de consultas POST /reservas-web/disponibilidad por IP (HMAC) en la última hora. CT-REM-FN-07b.';
comment on column public.configuracion_reservas.limite_web_disponibilidad_dia is
  'Máximo de consultas POST /reservas-web/disponibilidad en el día natural de Madrid, todas las IP. CT-REM-FN-07b.';

-- 2. Registro de consultas admitidas -----------------------------------------
create table if not exists public.reservas_web_intentos_disponibilidad (
  id         bigint generated always as identity primary key,
  ip_hash    text        not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table public.reservas_web_intentos_disponibilidad is
  'Consultas de /reservas-web/disponibilidad admitidas por reservas_web_reservar_cupo_disponibilidad. ip_hash = HMAC-SHA256 hex de la IP (nunca la IP). Retención 2 días.';

create index if not exists idx_reservas_web_intentos_disp_ip_creado
  on public.reservas_web_intentos_disponibilidad (ip_hash, created_at);
create index if not exists idx_reservas_web_intentos_disp_creado
  on public.reservas_web_intentos_disponibilidad (created_at);

alter table public.reservas_web_intentos_disponibilidad enable row level security;
revoke all on public.reservas_web_intentos_disponibilidad from public, anon, authenticated;

-- 3. RPC del cupo -------------------------------------------------------------
--  Contrato (jsonb):
--    {permitido: true}
--    {permitido: false, motivo: 'max_ip_hora' | 'max_dia'}
create or replace function public.reservas_web_reservar_cupo_disponibilidad(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_ip     integer;
  v_max_dia    integer;
  v_inicio_dia timestamptz;
  v_n          bigint;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'p_ip_hash debe ser un HMAC-SHA256 en hex' using errcode = '22023';
  end if;

  -- Clave de lock DISTINTA a la de /crear: los dos cupos no se serializan entre sí.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservas_web_reservar_cupo_disponibilidad', 0));

  -- Retención (barata: índice por created_at, como mucho 2 días de filas).
  delete from public.reservas_web_intentos_disponibilidad where created_at < now() - interval '2 days';

  select c.limite_web_disponibilidad_ip_hora, c.limite_web_disponibilidad_dia
    into v_max_ip, v_max_dia
  from public.configuracion_reservas c
  limit 1;
  -- Sin fila de configuración: los valores por defecto documentados.
  v_max_ip  := coalesce(v_max_ip, 120);
  v_max_dia := coalesce(v_max_dia, 5000);

  v_inicio_dia := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';

  select count(*) into v_n from public.reservas_web_intentos_disponibilidad where created_at >= v_inicio_dia;
  if v_n >= v_max_dia then
    return jsonb_build_object('permitido', false, 'motivo', 'max_dia');
  end if;

  select count(*) into v_n
  from public.reservas_web_intentos_disponibilidad
  where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';
  if v_n >= v_max_ip then
    return jsonb_build_object('permitido', false, 'motivo', 'max_ip_hora');
  end if;

  insert into public.reservas_web_intentos_disponibilidad (ip_hash) values (p_ip_hash);
  return jsonb_build_object('permitido', true);
end;
$$;

revoke all on function public.reservas_web_reservar_cupo_disponibilidad(text) from public, anon, authenticated;
grant execute on function public.reservas_web_reservar_cupo_disponibilidad(text) to service_role;

commit;

-- COMPROBACIÓN POST-MIGRACIÓN (manual)
-- select limite_web_disponibilidad_ip_hora, limite_web_disponibilidad_dia from public.configuracion_reservas;
-- -- como service_role:
-- select public.reservas_web_reservar_cupo_disponibilidad(repeat('a', 64));
-- delete from public.reservas_web_intentos_disponibilidad where ip_hash = repeat('a', 64);
